import assert from 'node:assert/strict';
import { SqlRuntimeError } from '../lib/db/sqlserver-runtime-contract';
import type { ISqlServerTransaction, SqlParameter, SqlRow } from '../lib/db/sqlserver-runtime-contract';
import { SqlServerOperationalUserWriteRepository } from '../lib/db/operational/sqlserver-operational-user-write-repository';
import { OperationalUserWriteError } from '../lib/db/operational/operational-user-write-repository';

class FakeSqlServerTransaction implements ISqlServerTransaction {
  public queries: { sql: string, params: SqlParameter[] | undefined }[] = [];
  public executes: { sql: string, params: SqlParameter[] | undefined }[] = [];

  public nextQueryRows: SqlRow[][] = [];
  public nextExecuteRows: number[] = [];
  public forceQueryError: Error | null = null;
  public forceExecuteError: Error | null = null;

  async query(sql: string, params?: SqlParameter[]): Promise<SqlRow[]> {
    this.queries.push({ sql, params });
    if (this.forceQueryError) {
      throw this.forceQueryError;
    }
    const rs = this.nextQueryRows.shift() || [];
    return rs.map(row => ({ ...row }));
  }

  async execute(sql: string, params?: SqlParameter[]): Promise<number> {
    this.executes.push({ sql, params });
    if (this.forceExecuteError) {
      throw this.forceExecuteError;
    }
    const affected = this.nextExecuteRows.shift();
    if (affected === undefined) return 1;
    return affected;
  }
}

let passed = 0;
let failed = 0;
let total = 0;

async function runTest(name: string, testFn: (tx: FakeSqlServerTransaction, repo: SqlServerOperationalUserWriteRepository) => Promise<void>) {
  total++;
  const tx = new FakeSqlServerTransaction();
  const repo = new SqlServerOperationalUserWriteRepository(tx);
  try {
    await testFn(tx, repo);
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] ${name}`);
    throw err;
  }
}

function isInvalidInput(err: unknown): boolean {
  return err instanceof OperationalUserWriteError && err.code === 'invalid_input';
}

function isUnexpectedResult(err: unknown): boolean {
  return err instanceof OperationalUserWriteError && err.code === 'unexpected_result';
}

const baseCreateInput = {
  username: 'testuser',
  passwordHash: 'hash',
  displayName: 'Test User',
  role: 'admin',
  isActive: true,
  glpiUserId: 100,
  adObjectId: 'uuid',
  email: 'test@test.com',
  authSource: 'local',
  directoryActive: true,
  directoryStatusCheckedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date()
};

async function main() {
  await runTest('createUser valida tipos, restringe controles y clona fechas', async (tx, repo) => {
    tx.nextQueryRows.push([{ id: 10 }]);

    const inputDate = new Date();
    const input = { ...baseCreateInput, createdAt: inputDate, username: ' sentinel ' };
    const id = await repo.createUser(input);

    assert.equal(id, 10);
    assert.equal(tx.queries.length, 1);

    const q = tx.queries[0];
    assert.ok(!q.sql.includes('SELECT *'));
    assert.ok(!q.sql.includes('prioglpi_user_access'));
    assert.ok(!q.sql.includes('sqlite'));
    assert.ok(!q.sql.includes('sentinel')); // sentinel only in params

    const uParam = q.params?.find(p => p.name === 'username');
    assert.ok(uParam && uParam.type === 'nvarchar');
    assert.equal(uParam.value, 'sentinel');
    assert.equal(uParam.length, 255);

    const dParam = q.params?.find(p => p.name === 'createdAt');
    assert.ok(dParam);
    assert.equal(dParam.type, 'datetime2');
    assert.ok(dParam.value instanceof Date);
    assert.notEqual(dParam.value, inputDate); // Different reference
    assert.equal(dParam.value.getTime(), inputDate.getTime());
  });

  await runTest('createUser caracteres de control son rechazados sin query', async (tx, repo) => {
    const controls = ['\x00', '\x1F', '\x7F'];
    for (const char of controls) {
      const input = { ...baseCreateInput, username: `t${char}est` };
      await assert.rejects(repo.createUser(input), isInvalidInput);
    }
    assert.equal(tx.queries.length, 0);
  });

  await runTest('createUser cantidad de filas invalida lanza unexpected_result', async (tx, repo) => {
    tx.nextQueryRows.push([]);
    await assert.rejects(repo.createUser(baseCreateInput), isUnexpectedResult);

    tx.nextQueryRows.push([{ id: 1 }, { id: 2 }]);
    await assert.rejects(repo.createUser(baseCreateInput), isUnexpectedResult);
  });

  await runTest('createUser acepta ID string decimal valido y retorna number', async (tx, repo) => {
    tx.nextQueryRows.push([{ id: '10' }]);
    const id1 = await repo.createUser(baseCreateInput);
    assert.equal(id1, 10);
    assert.equal(typeof id1, 'number');

    tx.nextQueryRows.push([{ id: '1' }]);
    const id2 = await repo.createUser(baseCreateInput);
    assert.equal(id2, 1);
    assert.equal(typeof id2, 'number');

    tx.nextQueryRows.push([{ id: '2147483647' }]);
    const id3 = await repo.createUser(baseCreateInput);
    assert.equal(id3, 2147483647);
    assert.equal(typeof id3, 'number');
  });

  await runTest('createUser rechaza formatos de ID invalidos y lanza unexpected_result', async (tx, repo) => {
    const invalidIds: unknown[] = [
      '01', '007', '0', 0, '+1', '-1', '+10', -5,
      '1.5', 1.5, '1e5', '1E5', ' 1', '1 ', ' 1 ',
      2147483648, '2147483648', null, undefined, true, false, {}, []
    ];

    for (const invId of invalidIds) {
      tx.nextQueryRows.push([{ id: invId }]);
      await assert.rejects(repo.createUser(baseCreateInput), isUnexpectedResult);
    }
  });

  await runTest('createUser rechaza inputs fisicos invalidos', async (tx, repo) => {
    const invalidInputs: unknown[] = [
      { ...baseCreateInput, username: '' },
      { ...baseCreateInput, username: 'a'.repeat(256) },
      { ...baseCreateInput, role: 'invalid' },
      { ...baseCreateInput, glpiUserId: -1 },
      { ...baseCreateInput, createdAt: '2023-01-01' },
      { ...baseCreateInput, authSource: 'unknown' },
      { ...baseCreateInput, isActive: 1 },
      { ...baseCreateInput, extraProp: 'test' } // Unknown property
    ];

    for (const inv of invalidInputs) {
      await assert.rejects(repo.createUser(inv), isInvalidInput);
    }
    assert.equal(tx.queries.length, 0);
  });

  await runTest('updateUser acepta subconjunto exacto, omite ausentes y exige updatedAt exactamente una vez', async (tx, repo) => {
    tx.nextExecuteRows.push(1);
    const result = await repo.updateUser(10, {
      displayName: ' sentinel2 ',
      passwordHash: null,
      updatedAt: new Date()
    });
    assert.equal(result, 'updated');
    assert.equal(tx.executes.length, 1);

    const q = tx.executes[0];

    // Check exact matches individually, independent of order
    assert.ok(q.sql.includes('[display_name] = @displayName'));
    assert.ok(q.sql.includes('[password_hash] = @passwordHash'));

    // Verify absent property does not generate a SET clause
    assert.ok(!q.sql.includes('[role] ='));

    // Verify updated_at appears exactly once in the entire SQL
    const match = q.sql.match(/\[updated_at\]/g);
    assert.equal(match?.length, 1);

    // Verify sentinel2 is only in params
    assert.ok(!q.sql.includes('sentinel2'));
    assert.ok(!q.sql.includes('SELECT *'));
    assert.ok(!q.sql.includes('prioglpi_user_access'));
    assert.ok(!q.sql.includes('sqlite'));
    const dpParam = q.params?.find(p => p.name === 'displayName');
    assert.equal(dpParam?.value, 'sentinel2');
  });

  await runTest('updateUser update sin mutable, invalidacion y rechazo antes de query', async (tx, repo) => {
    await assert.rejects(repo.updateUser(1, { updatedAt: new Date() }), isInvalidInput);
    assert.equal(tx.executes.length, 0); // No queries executed

    await assert.rejects(repo.updateUser(-1, { displayName: 'a', updatedAt: new Date() }), isInvalidInput);
    await assert.rejects(repo.updateUser(1, { displayName: 'a', updatedAt: 'invalid' }), isInvalidInput);
    await assert.rejects(repo.updateUser(1, { displayName: 'a', extra: 'bad', updatedAt: new Date() }), isInvalidInput);
  });

  await runTest('rowsAffected validacion estricta NaN Infinity malformados', async (tx, repo) => {
    tx.nextExecuteRows.push(NaN);
    await assert.rejects(repo.updateUser(1, { displayName: 'a', updatedAt: new Date() }), isUnexpectedResult);

    tx.nextExecuteRows.push(Infinity);
    await assert.rejects(repo.updateUser(1, { displayName: 'a', updatedAt: new Date() }), isUnexpectedResult);

    tx.nextExecuteRows.push(1.5);
    await assert.rejects(repo.updateUser(1, { displayName: 'a', updatedAt: new Date() }), isUnexpectedResult);
  });

  await runTest('updateUser resultado normal 0 o 2 afectados', async (tx, repo) => {
    tx.nextExecuteRows.push(0);
    const res0 = await repo.updateUser(1, { displayName: 'a', updatedAt: new Date() });
    assert.equal(res0, 'not_found');

    tx.nextExecuteRows.push(2);
    await assert.rejects(repo.updateUser(1, { displayName: 'a', updatedAt: new Date() }), isUnexpectedResult);
  });

  await runTest('SqlRuntimeError propagacion limpia sin conversion', async (tx, repo) => {
    const queryError = new SqlRuntimeError('SQL_CONNECTION_ERROR', 'Sanitized connection error');
    tx.forceQueryError = queryError;
    await assert.rejects(repo.createUser(baseCreateInput), (err: unknown) => {
      return err === queryError && err instanceof SqlRuntimeError && err.code === 'SQL_CONNECTION_ERROR';
    });

    tx.forceQueryError = null;
    const executeError = new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'Sanitized execution error');
    tx.forceExecuteError = executeError;
    await assert.rejects(repo.updateUser(1, { displayName: 'a', updatedAt: new Date() }), (err: unknown) => {
      return err === executeError && err instanceof SqlRuntimeError && err.code === 'SQL_QUERY_EXECUTION_ERROR';
    });
  });

  await runTest('replaceScopes array vacio, array con duplicados y case-insensitive', async (tx, repo) => {
    tx.nextExecuteRows.push(1); // For delete
    await repo.replaceScopes(1, []);
    assert.equal(tx.executes.length, 1);
    assert.ok(tx.executes[0].sql.startsWith('DELETE FROM'));

    tx.executes = [];
    tx.nextExecuteRows.push(1, 1, 1); // delete + 2 inserts
    await repo.replaceScopes(1, [
      { sectorName: ' sentinel3 ', glpiGroupId: 100 },
      { sectorName: 'S2', glpiGroupId: null } // glpiGroupId null nullable int
    ]);
    assert.equal(tx.executes.length, 3);
    assert.ok(tx.executes[0].sql.startsWith('DELETE FROM'));
    assert.ok(tx.executes[1].sql.startsWith('INSERT INTO'));
    assert.ok(tx.executes[2].sql.startsWith('INSERT INTO'));

    // Sentinel check
    assert.ok(!tx.executes[1].sql.includes('sentinel3'));
    assert.ok(!tx.executes[1].sql.includes('SELECT *'));
    assert.ok(!tx.executes[1].sql.includes('prioglpi_user_access'));
    assert.ok(!tx.executes[1].sql.includes('sqlite'));
    const pSector = tx.executes[1].params?.find(p => p.name === 'sectorName');
    assert.equal(pSector?.value, 'sentinel3');

    const p1 = tx.executes[2].params?.find(p => p.name === 'glpiGroupId');
    assert.equal(p1?.value, null);
    assert.equal(p1?.type, 'int');

    tx.executes = [];
    await assert.rejects(repo.replaceScopes(1, [
      { sectorName: 's1', glpiGroupId: 100 },
      { sectorName: 'S1  ', glpiGroupId: 200 } // duplicate by case/trim
    ]), isInvalidInput);
    assert.equal(tx.executes.length, 0); // Validated before DELETE

    await assert.rejects(repo.replaceScopes(1, [
      { sectorName: 's1', glpiGroupId: 100 },
      { sectorName: 's2', glpiGroupId: 100 } // duplicate group
    ]), isInvalidInput);
  });

  await runTest('replaceScopes input parcial invalido rechaza total', async (tx, repo) => {
    await assert.rejects(repo.replaceScopes(1, [
      { sectorName: 's1', glpiGroupId: 100 },
      { sectorName: '', glpiGroupId: 200 } // partial invalid
    ]), isInvalidInput);
    assert.equal(tx.executes.length, 0);
  });

  await runTest('replaceScopes resultados execute inesperados', async (tx, repo) => {
    tx.nextExecuteRows.push(-1);
    await assert.rejects(repo.replaceScopes(1, []), isUnexpectedResult);

    tx.nextExecuteRows.push(1, 0); // DELETE ok, INSERT 0
    await assert.rejects(repo.replaceScopes(1, [{ sectorName: 'S1', glpiGroupId: 100 }]), isUnexpectedResult);

    tx.nextExecuteRows.push(1, 2); // DELETE ok, INSERT 2
    await assert.rejects(repo.replaceScopes(1, [{ sectorName: 'S1', glpiGroupId: 100 }]), isUnexpectedResult);
  });
}

void main().then(() => {
  console.log(`Tests Operational User Write Repository: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
