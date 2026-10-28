import assert from 'node:assert/strict';
import type { ISqlServerSession, SqlParameter, SqlRow } from '../lib/db/sqlserver-runtime-contract';
import { SqlServerOperationalUserReadRepository, validateOperationalUserRoles } from '../lib/db/operational/sqlserver-operational-user-read-repository';
import { OperationalUserReadError } from '../lib/db/operational/operational-user-read-repository';

class FakeSqlServerSession implements ISqlServerSession {
  public queries: { sql: string, params: SqlParameter[] | undefined }[] = [];
  public nextRecordsets: SqlRow[][] = [];

  async query(sql: string, params?: SqlParameter[]): Promise<SqlRow[]> {
    this.queries.push({ sql, params });
    const rs = this.nextRecordsets.shift() || [];
    return rs.map(row => ({ ...row }));
  }

  async execute(sql: string, params?: SqlParameter[]): Promise<number> {
    void sql;
    void params;
    throw new Error('Not implemented for read repository');
  }
}

let passed = 0;
let failed = 0;
let total = 0;

async function runTest(name: string, testFn: (session: FakeSqlServerSession, repo: SqlServerOperationalUserReadRepository) => Promise<void>) {
  total++;
  const session = new FakeSqlServerSession();
  const repo = new SqlServerOperationalUserReadRepository(session);
  try {
    await testFn(session, repo);
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] ${name}`);
    throw err;
  }
}

const validRow: SqlRow = {
  id: 1,
  username: 'testuser',
  password_hash: 'hash',
  display_name: 'Test User',
  role: 'admin',
  is_active: 1,
  glpi_user_id: 100,
  ad_object_id: 'uuid',
  email: 'test@test.com',
  auth_source: 'local',
  directory_active: true,
  directory_status_checked_at: new Date('2023-01-01T00:00:00Z'),
  created_at: new Date('2023-01-01T00:00:00Z'),
  updated_at: new Date('2023-01-01T00:00:00Z')
};

function isInvalidInputError(err: unknown): boolean {
  return err instanceof OperationalUserReadError && err.code === 'invalid_input';
}

function isAmbiguousResultError(err: unknown): boolean {
  return err instanceof OperationalUserReadError && err.code === 'ambiguous_result';
}

function isCorruptDataError(err: unknown): boolean {
  return err instanceof OperationalUserReadError && err.code === 'corrupt_data';
}

async function main() {
  await runTest('IDs NaN, Infinity, decimal, unsafe integer, cero, negativo y mayor a INT', async (session, repo) => {
    const invalidIds = [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER, 0, -1, 2147483648, '1', null, undefined];
    for (const id of invalidIds) {
      await assert.rejects(repo.findById(id as unknown as number), isInvalidInputError);
      await assert.rejects(repo.findByGlpiUserId(id as unknown as number), isInvalidInputError);
      await assert.rejects(repo.findByIdWithScopes(id as unknown as number), isInvalidInputError);
    }
    assert.equal(session.queries.length, 0); // No query executed
  });

  await runTest('username y adObjectId validaciones', async (session, repo) => {
    const invalidStrings = [
      '', '   ', 'a'.repeat(256), 'test\x00user', 'test\x1Fuser', 'test\x7Fuser', null, undefined, 123
    ];
    for (const s of invalidStrings) {
      await assert.rejects(repo.findByUsername(s as unknown as string), isInvalidInputError);
      await assert.rejects(repo.findCandidatesByUsernameOrAdObjectId(s as unknown as string, 'valid'), isInvalidInputError);
      await assert.rejects(repo.findCandidatesByUsernameOrAdObjectId('valid', s as unknown as string), isInvalidInputError);
    }
    assert.equal(session.queries.length, 0);
  });

  await runTest('findById encontrado, ausente y ambiguo', async (session, repo) => {
    session.nextRecordsets.push([validRow]);
    const user = await repo.findById(1);
    assert.ok(user);
    assert.equal(user.id, 1);
    assert.equal(session.queries.length, 1);
    const sql = session.queries[0].sql;
    assert.ok(!sql.includes('SELECT *'));
    assert.ok(!sql.includes('prioglpi_user_access'));
    assert.ok(!sql.includes('sqlite'));
    assert.ok(sql.includes('u.[id] = @id'));
    assert.ok(!sql.includes(' = 1')); // Sentinel absent from SQL

    session.nextRecordsets.push([]);
    const none = await repo.findById(1);
    assert.equal(none, null);

    session.nextRecordsets.push([validRow, validRow]);
    await assert.rejects(repo.findById(1), isAmbiguousResultError);
  });

  await runTest('findByUsername encontrado, ausente y ambiguo', async (session, repo) => {
    session.nextRecordsets.push([validRow]);
    const user = await repo.findByUsername('testuser');
    assert.ok(user);

    session.nextRecordsets.push([]);
    assert.equal(await repo.findByUsername('nobody'), null);

    session.nextRecordsets.push([validRow, validRow]);
    await assert.rejects(repo.findByUsername('duplicate'), isAmbiguousResultError);
  });

  await runTest('findByGlpiUserId encontrado, ausente y ambiguo', async (session, repo) => {
    session.nextRecordsets.push([validRow]);
    const user = await repo.findByGlpiUserId(100);
    assert.ok(user);

    session.nextRecordsets.push([]);
    assert.equal(await repo.findByGlpiUserId(999), null);

    session.nextRecordsets.push([validRow, validRow]);
    await assert.rejects(repo.findByGlpiUserId(100), isAmbiguousResultError);
  });

  await runTest('candidato con 2 coincidencias validas y con 3 filas rechazado', async (session, repo) => {
    session.nextRecordsets.push([validRow, { ...validRow, id: 2 }]);
    const candidates = await repo.findCandidatesByUsernameOrAdObjectId('testuser', 'uuid');
    assert.equal(candidates.length, 2);
    const paramAd = session.queries[0].params?.find(p => p.name === 'adObjectId');
    assert.equal(paramAd?.type, 'nvarchar'); // adObjectId must be nvarchar

    session.nextRecordsets.push([validRow, { ...validRow, id: 2 }, { ...validRow, id: 3 }]);
    await assert.rejects(repo.findCandidatesByUsernameOrAdObjectId('t', 'u'), isCorruptDataError);
  });

  await runTest('LEFT JOIN sin scope y alias parcialmente nulos', async (session, repo) => {
    // Valid: completely null
    session.nextRecordsets.push([{
      ...validRow,
      scope_id: null, scope_user_id: null, scope_sector_name: null, scope_glpi_group_id: null
    }]);
    const user = await repo.findByIdWithScopes(1);
    assert.equal(user?.sectorScopes.length, 0);

    // Invalid: partial nulls
    session.nextRecordsets.push([{ ...validRow, scope_id: null, scope_user_id: 1, scope_sector_name: null, scope_glpi_group_id: null }]);
    await assert.rejects(repo.findByIdWithScopes(1), isCorruptDataError);

    session.nextRecordsets.push([{ ...validRow, scope_id: 10, scope_user_id: null, scope_sector_name: 'S', scope_glpi_group_id: null }]);
    await assert.rejects(repo.findByIdWithScopes(1), isCorruptDataError);
  });

  await runTest('LEFT JOIN validaciones de scopes (desorden, duplicados, discrepancia user)', async (session, repo) => {
    const scope1 = { scope_id: 10, scope_user_id: 1, scope_sector_name: 'S1', scope_glpi_group_id: 100 };
    const scope2 = { scope_id: 20, scope_user_id: 1, scope_sector_name: 'S2', scope_glpi_group_id: 200 };

    // Valid ordered
    session.nextRecordsets.push([{ ...validRow, ...scope1 }, { ...validRow, ...scope2 }]);
    const u = await repo.findByIdWithScopes(1);
    assert.equal(u?.sectorScopes.length, 2);

    // Invalid order
    session.nextRecordsets.push([{ ...validRow, ...scope2 }, { ...validRow, ...scope1 }]);
    await assert.rejects(repo.findByIdWithScopes(1), isCorruptDataError);

    // Duplicate scope_id
    session.nextRecordsets.push([{ ...validRow, ...scope1 }, { ...validRow, ...scope1 }]);
    await assert.rejects(repo.findByIdWithScopes(1), isCorruptDataError);

    // Duplicate sector case-insensitive
    const scopeCase = { scope_id: 20, scope_user_id: 1, scope_sector_name: 's1  ', scope_glpi_group_id: 200 };
    session.nextRecordsets.push([{ ...validRow, ...scope1 }, { ...validRow, ...scopeCase }]);
    await assert.rejects(repo.findByIdWithScopes(1), isCorruptDataError);

    // Duplicate glpi_group_id
    const scopeDupGroup = { scope_id: 20, scope_user_id: 1, scope_sector_name: 'S2', scope_glpi_group_id: 100 };
    session.nextRecordsets.push([{ ...validRow, ...scope1 }, { ...validRow, ...scopeDupGroup }]);
    await assert.rejects(repo.findByIdWithScopes(1), isCorruptDataError);

    // Differing user fields across rows
    session.nextRecordsets.push([{ ...validRow, ...scope1 }, { ...validRow, display_name: 'Different', ...scope2 }]);
    await assert.rejects(repo.findByIdWithScopes(1), isCorruptDataError);
  });

  await runTest('Date devuelto como nueva instancia y mutar no altera result', async (session, repo) => {
    session.nextRecordsets.push([validRow]);
    const u1 = await repo.findById(1);
    assert.ok(u1);
    const originalTime = u1.createdAt.getTime();

    // Mutate returned date
    u1.createdAt.setTime(0);

    // DB original should not be affected, new fetches should return the original
    session.nextRecordsets.push([validRow]);
    const u2 = await repo.findById(1);
    assert.ok(u2);
    assert.equal(u2.createdAt.getTime(), originalTime);
    assert.notEqual(u1.createdAt, u2.createdAt);
  });

  await runTest('listActiveByRoles y validador', async (session, repo) => {
    // Using exported validator explicitly
    assert.deepEqual(validateOperationalUserRoles(['admin']), ['admin']);
    assert.throws(() => validateOperationalUserRoles([]), isInvalidInputError);
    assert.throws(() => validateOperationalUserRoles(['admin', 'admin']), isInvalidInputError);
    assert.throws(() => validateOperationalUserRoles(['invalid']), isInvalidInputError);

    // Testing repo behavior (no query on invalid)
    await assert.rejects(repo.listActiveByRoles([] as unknown), isInvalidInputError);
    await assert.rejects(repo.listActiveByRoles(['invalid'] as unknown), isInvalidInputError);
    assert.equal(session.queries.length, 0);

    session.nextRecordsets.push([validRow]);
    const users = await repo.listActiveByRoles(['admin', 'referente']);
    assert.equal(users.length, 1);
  });

  await runTest('parsePositiveInt acepta string decimal valido en usuario y scope', async (session, repo) => {
    session.nextRecordsets.push([{
      ...validRow,
      id: '1',
      glpi_user_id: '100'
    }]);
    const user = await repo.findById(1);
    assert.ok(user);
    assert.equal(user.id, 1);
    assert.equal(typeof user.id, 'number');
    assert.equal(user.glpiUserId, 100);
    assert.equal(typeof user.glpiUserId, 'number');

    const scopeStringRow = {
      ...validRow,
      id: '1',
      scope_id: '10',
      scope_user_id: '1',
      scope_sector_name: 'S1',
      scope_glpi_group_id: '200'
    };
    session.nextRecordsets.push([scopeStringRow]);
    const userWithScopes = await repo.findByIdWithScopes(1);
    assert.ok(userWithScopes);
    assert.equal(userWithScopes.sectorScopes[0].id, 10);
    assert.equal(typeof userWithScopes.sectorScopes[0].id, 'number');
    assert.equal(userWithScopes.sectorScopes[0].userId, 1);
    assert.equal(typeof userWithScopes.sectorScopes[0].userId, 'number');
    assert.equal(userWithScopes.sectorScopes[0].glpiGroupId, 200);
    assert.equal(typeof userWithScopes.sectorScopes[0].glpiGroupId, 'number');
  });

  await runTest('filas con datos malformados rechazadas como corrupt_data', async (session, repo) => {
    const testCorrupt = async (override: Partial<SqlRow>) => {
      session.nextRecordsets.push([{ ...validRow, ...override }]);
      await assert.rejects(repo.findById(1), isCorruptDataError);
    };

    await testCorrupt({ id: '01' }); // Leading zero invalid
    await testCorrupt({ id: 0 }); // Invalid int
    await testCorrupt({ username: null }); // string required
    await testCorrupt({ username: '   ' }); // empty after trim
    await testCorrupt({ username: 'a\x00b' }); // control char
    await testCorrupt({ is_active: 2 }); // invalid bit
    await testCorrupt({ created_at: '2023-01-01' }); // invalid date (string)
    await testCorrupt({ role: 'unknown' }); // invalid role
    await testCorrupt({ auth_source: 'unknown' }); // invalid auth source
  });

  await runTest('parsePositiveInt rechaza formatos de ID invalidos como corrupt_data', async (session, repo) => {
    const invalidIds: unknown[] = [
      '01', '007', '0', 0, '+1', '-1', '+10', -5,
      '1.5', 1.5, '1e5', '1E5', ' 1', '1 ', ' 1 ',
      2147483648, '2147483648', null, undefined, true, false, {}, []
    ];

    for (const invId of invalidIds) {
      session.nextRecordsets.push([{ ...validRow, id: invId }]);
      await assert.rejects(repo.findById(1), isCorruptDataError);
    }
  });
}

void main().then(() => {
  console.log(`Tests Operational User Read Repository: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
