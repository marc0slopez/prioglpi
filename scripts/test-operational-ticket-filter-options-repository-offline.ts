import assert from 'node:assert/strict';
import { SqlServerOperationalTicketFilterOptionsRepository } from '../lib/db/operational/sqlserver-operational-ticket-filter-options-repository';
import { SqlRuntimeError, type ISqlServerSession, type SqlParameter, type SqlRow } from '../lib/db/sqlserver-runtime-contract';
import { OperationalTicketFilterOptionsError } from '../lib/db/operational/operational-ticket-filter-options-repository';

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

class FakeSession implements ISqlServerSession {
  public queries: { sql: string; params: readonly SqlParameter[] }[] = [];
  public executeCalls = 0;
  public resultToReturn: SqlRow[] = [];
  public errorToThrow: Error | null = null;

  async query(sql: string, params: SqlParameter[] = []): Promise<SqlRow[]> {
    this.queries.push({ sql, params });
    if (this.errorToThrow) throw this.errorToThrow;
    return this.resultToReturn;
  }

  async execute(sql: string, params: SqlParameter[] = []): Promise<number> {
    this.executeCalls++;
    this.queries.push({ sql, params });
    if (this.errorToThrow) throw this.errorToThrow;
    return 0;
  }
}

let passed = 0, failed = 0, total = 0;
async function runTest(name: string, fn: () => void | Promise<void>) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] ${name}`);
    throw err;
  }
}

async function assertCorruptData(fn: () => Promise<unknown>): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof OperationalTicketFilterOptionsError)) {
    assert.fail('Expected OperationalTicketFilterOptionsError for corrupt_data');
  }
  assert.equal(caught.code, 'corrupt_data');
}

async function assertInvalidInput(fn: () => Promise<unknown>): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof OperationalTicketFilterOptionsError)) {
    assert.fail('Expected OperationalTicketFilterOptionsError for invalid_input');
  }
  assert.equal(caught.code, 'invalid_input');
}

async function main() {
  await runTest('1. Técnicos válidos y ordenados', async () => {
    const session = new FakeSession();
    session.resultToReturn = [
      { id: 1, name: 'A', row_order: 1 },
      { id: 2, name: 'B', row_order: 2 }
    ];
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);
    const res = await repo.listTechnicians();
    assert.equal(res.length, 2);
    assert.equal(res[0].id, 1);
    assert.equal(res[1].name, 'B');
  });

  await runTest('2. Técnicos vacíos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);
    const res = await repo.listTechnicians();
    assert.equal(res.length, 0);
  });

  await runTest('3. Técnicos con filas corruptas o duplicadas', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);

    // Duplicados
    session.resultToReturn = [{ id: 1, name: 'A', row_order: 1 }, { id: 1, name: 'B', row_order: 2 }];
    await assertCorruptData(() => repo.listTechnicians());

    // Columna adicional
    session.resultToReturn = [{ id: 1, name: 'A', row_order: 1, extra: 123 }];
    await assertCorruptData(() => repo.listTechnicians());

    // Nombre solo espacios
    session.resultToReturn = [{ id: 1, name: '   ', row_order: 1 }];
    await assertCorruptData(() => repo.listTechnicians());

    // row_order ausente
    session.resultToReturn = [{ id: 1, name: 'A' }];
    await assertCorruptData(() => repo.listTechnicians());

    // row_order duplicado
    session.resultToReturn = [{ id: 1, name: 'A', row_order: 1 }, { id: 2, name: 'B', row_order: 1 }];
    await assertCorruptData(() => repo.listTechnicians());

    // row_order cero
    session.resultToReturn = [{ id: 1, name: 'A', row_order: 0 }];
    await assertCorruptData(() => repo.listTechnicians());

    // row_order desordenado
    session.resultToReturn = [{ id: 1, name: 'A', row_order: 2 }];
    await assertCorruptData(() => repo.listTechnicians());
  });

  await runTest('4. SQL y parámetros exactos de técnicos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);
    await repo.listTechnicians();
    assert.equal(session.queries.length, 1);
    const q = session.queries[0];
    assert.ok(q.sql.includes('FROM [prioglpi].[glpi_user_cache]'));
    assert.ok(q.sql.includes('@technicalGroupId'));
    assert.ok(q.sql.includes('@excludedTechId'));
    assert.equal(q.params.length, 2);
    assert.equal(q.params[0].name, 'technicalGroupId');
    assert.equal(q.params[0].value, 30);
    assert.equal(q.params[1].name, 'excludedTechId');
    assert.equal(q.params[1].value, 231);

    // SQL rules
    assert.ok(q.sql.includes("NOT LIKE N'%julián cancio%'"));
    assert.ok(q.sql.includes("NOT LIKE N'%julian cancio%'"));
    assert.ok(q.sql.includes("NOT LIKE N'%joel lugo%'"));
    assert.ok(q.sql.includes("NOT LIKE N'%guillermo kunz%'"));
    assert.ok(!q.sql.includes('NOT IN ('));

    assert.ok(normalizeSql(q.sql).includes('FROM Options ORDER BY [name] ASC, [id] ASC'));
  });

  await runTest('5. Sectores Sistemas válidos y fallback ya materializado', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);
    session.resultToReturn = [
      { id: 10, name: 'Sector 10', row_order: 1 },
      { id: 20, name: 'Sector 20', row_order: 2 }
    ];
    const res = await repo.listSistemasSectors();
    assert.equal(res.length, 2);
    const q = session.queries[0];
    assert.ok(q.sql.includes("N'Sector ' + CAST("));
    assert.ok(normalizeSql(q.sql).includes('FROM Options ORDER BY [name] ASC, [id] ASC'));
  });

  await runTest('6. Sectores duplicados, inválidos o desordenados', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);

    session.resultToReturn = [{ id: 1, name: 'A', row_order: 1 }, { id: 1, name: 'B', row_order: 2 }];
    await assertCorruptData(() => repo.listSistemasSectors());

    session.resultToReturn = [{ id: 1, name: 'B', row_order: 2 }];
    await assertCorruptData(() => repo.listSistemasSectors());
  });

  await runTest('7. Solicitantes Sistemas válidos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);
    session.resultToReturn = [
      { id: 100, name: 'John Doe', row_order: 1 }
    ];
    const res = await repo.listSistemasRequesters();
    assert.equal(res.length, 1);

    const q = session.queries[0];
    assert.ok(normalizeSql(q.sql).includes('FROM Options ORDER BY [name] ASC, [id] ASC'));
  });

  await runTest('8. Solicitantes Sistemas corruptos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);

    session.resultToReturn = [{ id: -1, name: 'John Doe', row_order: 1 }];
    await assertCorruptData(() => repo.listSistemasRequesters());
  });

  await runTest('9. Referente activo sin scopes', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);
    session.resultToReturn = [
      {
        user_id: 1, display_name: 'Ref 1', glpi_user_id: 100, is_active: 1,
        scope_id: null, scope_glpi_group_id: null, scope_sector_name: null,
        row_order: 1
      }
    ];
    const res = await repo.listActiveReferentOptions();
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 1);
    assert.equal(res[0].groups.length, 0);

    const q = session.queries[0];
    assert.ok(normalizeSql(q.sql).includes('FROM Options ORDER BY [display_name] ASC, [user_id] ASC, [scope_id] ASC'));
  });

  await runTest('10. Referente activo con múltiples scopes', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);
    session.resultToReturn = [
      {
        user_id: 1, display_name: 'Ref 1', glpi_user_id: 100, is_active: true,
        scope_id: 10, scope_glpi_group_id: 200, scope_sector_name: 'Sector A', row_order: 1
      },
      {
        user_id: 1, display_name: 'Ref 1', glpi_user_id: 100, is_active: true,
        scope_id: 11, scope_glpi_group_id: 201, scope_sector_name: 'Sector B', row_order: 2
      }
    ];
    const res = await repo.listActiveReferentOptions();
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 1);
    assert.equal(res[0].groups.length, 2);
    assert.equal(res[0].groups[0].glpiGroupId, 200);
    assert.equal(res[0].groups[1].sectorName, 'Sector B');
  });

  await runTest('11. LEFT JOIN parcial, múltiples nulls y filas discordantes', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);

    session.resultToReturn = [
      {
        user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1,
        scope_id: null, scope_glpi_group_id: 200, scope_sector_name: null, row_order: 1
      }
    ];
    await assertCorruptData(() => repo.listActiveReferentOptions());

    session.resultToReturn = [
      {
        user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1,
        scope_id: null, scope_glpi_group_id: null, scope_sector_name: null, row_order: 1
      },
      {
        user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1,
        scope_id: null, scope_glpi_group_id: null, scope_sector_name: null, row_order: 2
      }
    ];
    await assertCorruptData(() => repo.listActiveReferentOptions());

    session.resultToReturn = [
      {
        user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1,
        scope_id: 10, scope_glpi_group_id: 200, scope_sector_name: 'S', row_order: 1
      },
      {
        user_id: 2, display_name: 'B', glpi_user_id: null, is_active: 1,
        scope_id: 11, scope_glpi_group_id: 201, scope_sector_name: 'T', row_order: 2
      },
      {
        user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1,
        scope_id: 12, scope_glpi_group_id: 202, scope_sector_name: 'U', row_order: 3
      }
    ];
    await assertCorruptData(() => repo.listActiveReferentOptions());
  });

  await runTest('12. Duplicados y orden corrupto en referentes/scopes', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);

    // scope duplicate glpiGroupId
    session.resultToReturn = [
      { user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1, scope_id: 10, scope_glpi_group_id: 200, scope_sector_name: 'S', row_order: 1 },
      { user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1, scope_id: 11, scope_glpi_group_id: 200, scope_sector_name: 'T', row_order: 2 }
    ];
    await assertCorruptData(() => repo.listActiveReferentOptions());

    // scope out of order id
    session.resultToReturn = [
      { user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1, scope_id: 11, scope_glpi_group_id: 200, scope_sector_name: 'S', row_order: 1 },
      { user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1, scope_id: 10, scope_glpi_group_id: 201, scope_sector_name: 'T', row_order: 2 }
    ];
    await assertCorruptData(() => repo.listActiveReferentOptions());

    // metadata cambiante
    session.resultToReturn = [
      { user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1, scope_id: 10, scope_glpi_group_id: 200, scope_sector_name: 'S', row_order: 1 },
      { user_id: 1, display_name: 'A', glpi_user_id: 100, is_active: 1, scope_id: 11, scope_glpi_group_id: 201, scope_sector_name: 'T', row_order: 2 }
    ];
    await assertCorruptData(() => repo.listActiveReferentOptions());

    // NULL scope seguido por scope válido
    session.resultToReturn = [
      { user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1, scope_id: null, scope_glpi_group_id: null, scope_sector_name: null, row_order: 1 },
      { user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1, scope_id: 11, scope_glpi_group_id: 201, scope_sector_name: 'T', row_order: 2 }
    ];
    await assertCorruptData(() => repo.listActiveReferentOptions());

    // scope válido seguido por NULL
    session.resultToReturn = [
      { user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1, scope_id: 10, scope_glpi_group_id: 200, scope_sector_name: 'S', row_order: 1 },
      { user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1, scope_id: null, scope_glpi_group_id: null, scope_sector_name: null, row_order: 2 }
    ];
    await assertCorruptData(() => repo.listActiveReferentOptions());
  });

  await runTest('13. Scoped requesters con array vacío y cero queries', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);
    const res = await repo.listScopedRequesters([]);
    assert.equal(res.length, 0);
    assert.equal(session.queries.length, 0);
  });

  await runTest('14. Validación de groupIds: tipo, cero, negativos, decimal, unsafe, overflow, repetidos y más de 200', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);

    await assertInvalidInput(() => repo.listScopedRequesters({}));
    await assertInvalidInput(() => repo.listScopedRequesters([0]));
    await assertInvalidInput(() => repo.listScopedRequesters([-1]));
    await assertInvalidInput(() => repo.listScopedRequesters([1.5]));
    await assertInvalidInput(() => repo.listScopedRequesters([9007199254740992]));
    await assertInvalidInput(() => repo.listScopedRequesters([2147483648]));
    await assertInvalidInput(() => repo.listScopedRequesters([Number.MAX_SAFE_INTEGER]));
    await assertInvalidInput(() => repo.listScopedRequesters([1, 1]));

    const bigArray = Array.from({ length: 201 }, (_, i) => i + 1);
    await assertInvalidInput(() => repo.listScopedRequesters(bigArray));

    // 2147483647 is valid
    session.resultToReturn = [];
    await repo.listScopedRequesters([2147483647]);
  });

  await runTest('15. JSON paramétrico exacto, orden canónico e inmutabilidad del input', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);
    const input = [30, 10, 20];
    Object.freeze(input);
    session.resultToReturn = [];

    await repo.listScopedRequesters(input);
    assert.equal(session.queries.length, 1);
    const q = session.queries[0];
    assert.equal(q.params.length, 1);
    assert.equal(q.params[0].name, 'groupIdsJson');
    assert.equal(q.params[0].value, '[10,20,30]');
    assert.equal(input[0], 30);

    assert.ok(normalizeSql(q.sql).includes('FROM Options ORDER BY [name] ASC, [id] ASC'));
  });

  await runTest('16. Scoped requesters válidos, vacíos y corruptos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);

    session.resultToReturn = [{ id: 1, name: 'A', row_order: 1 }];
    const res = await repo.listScopedRequesters([10]);
    assert.equal(res.length, 1);

    session.resultToReturn = [{ id: 1, name: 'A', row_order: 1 }, { id: 1, name: 'B', row_order: 2 }];
    await assertCorruptData(() => repo.listScopedRequesters([10]));
  });

  await runTest('17. Propagación por identidad de SqlRuntimeError', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);

    const sqlError = new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'DB Error');
    session.errorToThrow = sqlError;

    let caught: unknown = null;
    try {
      await repo.listTechnicians();
    } catch (err) {
      caught = err;
    }

    if (!(caught instanceof SqlRuntimeError)) {
      assert.fail('Expected SqlRuntimeError');
    }
    assert.equal(caught.code, 'SQL_QUERY_EXECUTION_ERROR');
    assert.equal(caught, sqlError);
  });

  await runTest('18. Higiene SQL, redaccion de errores e inmutabilidad profunda', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketFilterOptionsRepository(session);

    session.resultToReturn = [
      { user_id: 1, display_name: 'A', glpi_user_id: null, is_active: 1, scope_id: 10, scope_glpi_group_id: 200, scope_sector_name: 'S', row_order: 1 }
    ];

    const res = await repo.listActiveReferentOptions();
    assert.ok(Object.isFrozen(res));
    assert.ok(Object.isFrozen(res[0]));
    assert.ok(Object.isFrozen(res[0].groups));
    assert.ok(Object.isFrozen(res[0].groups[0]));

    const q = session.queries[0];
    const sql = q.sql.toUpperCase();
    assert.ok(!sql.includes('SELECT *'));
    assert.ok(!sql.includes('NOLOCK'));
    assert.ok(sql.includes('[PRIOGLPI].[APP_USER]'));

    assert.ok(!sql.includes('OPENJSON'));

    session.queries = [];
    session.resultToReturn = [];
    await repo.listScopedRequesters([10]);
    const sql2 = session.queries[0].sql.toUpperCase();
    assert.ok(sql2.includes('OPENJSON'));

    // Fail-closed test for error messages
    let errorCaught: unknown = null;
    try {
      session.resultToReturn = [{ id: 999999, name: 'A', row_order: 0 }];
      await repo.listTechnicians();
    } catch (err: unknown) {
      errorCaught = err;
    }

    if (!(errorCaught instanceof OperationalTicketFilterOptionsError)) {
      assert.fail('Expected OperationalTicketFilterOptionsError');
    }
    assert.equal(errorCaught.code, 'corrupt_data');
    assert.ok(!errorCaught.message.includes('999999'));

    assert.equal(session.executeCalls, 0);
  });
}

void main().then(() => {
  console.log(`\nTests Operational Ticket Filter Options Repository: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
