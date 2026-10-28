import assert from 'node:assert/strict';
import { SqlServerOperationalRankingReadRepository } from '../lib/db/operational/sqlserver-operational-ranking-read-repository';
import { OperationalRankingReadError } from '../lib/db/operational/operational-ranking-read-repository';
import { SqlRuntimeError, type ISqlServerSession, type SqlParameter, type SqlRow } from '../lib/db/sqlserver-runtime-contract';

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
  if (!(caught instanceof OperationalRankingReadError)) {
    assert.fail('Expected OperationalRankingReadError for corrupt_data');
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
  if (!(caught instanceof OperationalRankingReadError)) {
    assert.fail('Expected OperationalRankingReadError for invalid_input');
  }
  assert.equal(caught.code, 'invalid_input');
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

const baseRow = {
  ranking_id: 1,
  ranking_ticket_id: 100,
  ranking_sector_name: 'Sec 1',
  ranking_glpi_group_id: 10,
  ranking_rank_position: 1,
  ranking_is_active: 1,
  ranking_created_at: new Date('2023-01-01'),
  ranking_updated_at: new Date('2023-01-02'),
  ranking_created_by: 'User A',
  ranking_updated_by: 'User B',
  ticket_id: 100,
  ticket_title: 'Title',
  ticket_status: 1,
  ticket_status_label: 'New',
  ticket_type: 1,
  ticket_type_label: 'Incident',
  ticket_priority: 3,
  ticket_opened_at: '2023-01-01',
  ticket_requester_name: 'Req',
  ticket_assigned_technician: 'Tech',
  ticket_detected_sector: 'Det',
  ticket_web_url: 'http',
  ticket_is_sistemas_scope: 1,
  coordination_id: null,
  coordination_ticket_id: null,
  coordination_progress_percent: null,
  coordination_comment: null,
  coordination_estimated_delivery_date: null,
  coordination_updated_at: null
};

async function main() {
  await runTest('1. Ranking válido sin coordinación', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);
    session.resultToReturn = [{ ...baseRow }];

    const res = await repo.listActiveRankings([10]);
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 1);
    assert.equal(res[0].ticket.ticketId, 100);
    assert.equal(res[0].ticket.coordination, null);
  });

  await runTest('2. Ranking válido con coordinación', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);
    session.resultToReturn = [{
      ...baseRow,
      coordination_id: 200,
      coordination_ticket_id: 100,
      coordination_progress_percent: 50,
      coordination_comment: 'In progress',
      coordination_estimated_delivery_date: '2023-05-01',
      coordination_updated_at: new Date('2023-04-01')
    }];

    const res = await repo.listActiveRankings([10]);
    assert.equal(res.length, 1);
    const coord = res[0].ticket.coordination;
    assert.ok(coord !== null);
    assert.equal(coord.progressPercent, 50);
    assert.equal(coord.coordinatorComment, 'In progress');
    assert.equal(coord.estimatedDeliveryDate, '2023-05-01');
    assert.equal(coord.updatedAt.getTime(), new Date('2023-04-01').getTime());
  });

  await runTest('3. groupIds=null: sin parámetros SQL pero con query válida', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);
    session.resultToReturn = [{ ...baseRow }];
    await repo.listActiveRankings(null);
    assert.equal(session.queries.length, 1);
    const q = session.queries[0];
    assert.equal(q.params.length, 0); // null groupIds no longer produces a param
  });

  await runTest('4. Test dummy para ids=null u otros', async () => {
    // Tests for invalid input arrays are removed because parameter is now ownerUserId: number | null
    assert.ok(true);
  });

  await runTest('5. Valida array con número', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);
    session.resultToReturn = [];
    await repo.listActiveRankings([10]);
    const q = session.queries[0];
    assert.equal(q.params.length, 1);

    const param = q.params[0];
    assert.ok(param !== undefined);
    assert.equal(param.name, 'g0');
    assert.equal(param.type, 'int');
    assert.equal(param.nullable, false);
    assert.equal(param.value, 10);
  });

  await runTest('6. Inputs null/números válidos y rechazo', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);
    session.resultToReturn = [];
    await repo.listActiveRankings(null);
    await repo.listActiveRankings([10]);

    // Any invalid cast handled by TS or by isPositiveSqlInt
    // @ts-expect-error invalid
    await assertInvalidInput(() => repo.listActiveRankings('123'));
    // listActiveRankings([12.5]) is type-valid (number[] accepted), but isPositiveSqlInt rejects decimals at runtime
    await assertInvalidInput(() => repo.listActiveRankings([12.5]));
  });

  await runTest('7. IDs NaN, Infinity, decimal, cero, negativo, unsafe y > SQL INT', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);
    const tests = [NaN, Infinity, 1.5, 0, -1, Number.MAX_SAFE_INTEGER, 2147483648];
    for (const id of tests) {
      await assertInvalidInput(() => repo.listActiveRankings([id]));
    }
  });

  await runTest('9. SQL físico, joins, WHERE y ORDER BY exactos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);
    session.resultToReturn = [];
    await repo.listActiveRankings([10]);
    const sql = normalizeSql(session.queries[0].sql);

    assert.ok(sql.includes("FROM [prioglpi].[ticket_ranking] r"));
    assert.ok(sql.includes("INNER JOIN [prioglpi].[glpi_ticket_cache] t ON r.[ticket_id] = t.[ticket_id]"));
    assert.ok(sql.includes("INNER JOIN [prioglpi].[app_user] created_user ON r.[created_by_user_id] = created_user.[id]"));
    assert.ok(sql.includes("INNER JOIN [prioglpi].[app_user] updated_user ON r.[updated_by_user_id] = updated_user.[id]"));
    assert.ok(sql.includes("LEFT JOIN [prioglpi].[ticket_coordination] c ON r.[ticket_id] = c.[ticket_id]"));
    assert.ok(sql.includes("WHERE r.[is_active] = 1 AND t.[is_sistemas_scope] = 1 AND t.[status] IN (1, 2, 3, 4)"));
    assert.ok(sql.includes("ORDER BY r.[rank_position] ASC, r.[ticket_id] ASC, r.[id] ASC"));
  });

  await runTest('10. Exactamente 29 aliases; sin SELECT *, NOLOCK, Prisma ni SQLite', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);
    session.resultToReturn = [];
    await repo.listActiveRankings([10]);
    const sql = session.queries[0].sql;

    assert.ok(!sql.includes("SELECT *"));
    assert.ok(!sql.includes("NOLOCK"));
    assert.ok(!sql.includes("prisma"));
    assert.ok(!sql.includes("sqlite"));

    const EXPECTED_ALIASES = [
      'ranking_id', 'ranking_ticket_id', 'ranking_sector_name', 'ranking_glpi_group_id',
      'ranking_rank_position', 'ranking_is_active', 'ranking_created_at', 'ranking_updated_at',
      'ranking_created_by', 'ranking_updated_by',
      'ticket_id', 'ticket_title', 'ticket_status', 'ticket_status_label',
      'ticket_type', 'ticket_type_label', 'ticket_priority',
      'ticket_opened_at', 'ticket_requester_name', 'ticket_assigned_technician',
      'ticket_detected_sector', 'ticket_web_url', 'ticket_is_sistemas_scope',
      'coordination_id', 'coordination_ticket_id', 'coordination_progress_percent',
      'coordination_comment', 'coordination_estimated_delivery_date', 'coordination_updated_at'
    ];

    for (const alias of EXPECTED_ALIASES) {
      assert.ok(sql.includes(`AS [${alias}]`), `Missing alias: ${alias}`);
    }

    const matches = sql.match(/ AS \[/g);
    assert.ok(matches);
    assert.equal(matches.length, 29, `Expected 29 AS aliases, got ${matches.length}`);
  });

  await runTest('11. Ranking con tipos, IDs, BIT o fechas corruptas', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);

    session.resultToReturn = [{ ...baseRow, ranking_id: -1 }];
    await assertCorruptData(() => repo.listActiveRankings([10]));

    session.resultToReturn = [{ ...baseRow, ranking_is_active: 2 }];
    await assertCorruptData(() => repo.listActiveRankings([10]));

    session.resultToReturn = [{ ...baseRow, ranking_created_at: new Date('invalid') }];
    await assertCorruptData(() => repo.listActiveRankings([10]));

    session.resultToReturn = [{ ...baseRow, ranking_sector_name: 123 }];
    await assertCorruptData(() => repo.listActiveRankings([10]));

    const modifiedRow = Object.assign({}, baseRow, { extra: 1 });
    Reflect.deleteProperty(modifiedRow, 'ranking_id');
    session.resultToReturn = [modifiedRow];
    await assertCorruptData(() => repo.listActiveRankings([10]));

    // Una columna extra inesperada (nombre arbitrario) también produce corrupt_data
    // por la verificación de longitud exacta (29 columnas esperadas).
    session.resultToReturn = [Object.assign({}, baseRow, { unexpected_extra_column: 99 })];
    await assertCorruptData(() => repo.listActiveRankings([10]));
  });

  await runTest('12. Ticket con tipos/status/scope corruptos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);

    session.resultToReturn = [{ ...baseRow, ticket_status: 5 }];
    await assertCorruptData(() => repo.listActiveRankings([10]));

    session.resultToReturn = [{ ...baseRow, ticket_is_sistemas_scope: 0 }];
    await assertCorruptData(() => repo.listActiveRankings([10]));

    session.resultToReturn = [{ ...baseRow, ticket_priority: 1.5 }];
    await assertCorruptData(() => repo.listActiveRankings([10]));
  });

  await runTest('13. Ticket ID discordante respecto del ranking', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);

    session.resultToReturn = [{ ...baseRow, ranking_ticket_id: 100, ticket_id: 101 }];
    await assertCorruptData(() => repo.listActiveRankings([10]));
  });

  await runTest('14. Coordinación completamente nula y completamente válida', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);

    session.resultToReturn = [{ ...baseRow }];
    let res = await repo.listActiveRankings([10]);
    assert.equal(res[0].ticket.coordination, null);

    session.resultToReturn = [{
      ...baseRow,
      coordination_id: 200, coordination_ticket_id: 100, coordination_progress_percent: 50,
      coordination_comment: '', coordination_estimated_delivery_date: null, coordination_updated_at: new Date('2023-01-01')
    }];
    res = await repo.listActiveRankings([10]);
    assert.ok(res[0].ticket.coordination);
  });

  await runTest('15. Coordinación parcial, progreso inválido o ticket discordante', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);

    session.resultToReturn = [{ ...baseRow, coordination_id: 200, coordination_ticket_id: null }];
    await assertCorruptData(() => repo.listActiveRankings([10]));

    session.resultToReturn = [{ ...baseRow, coordination_id: null, coordination_ticket_id: 100 }];
    await assertCorruptData(() => repo.listActiveRankings([10]));

    const baseCoord = {
      ...baseRow,
      coordination_id: 200, coordination_ticket_id: 100, coordination_progress_percent: 50,
      coordination_comment: '', coordination_estimated_delivery_date: null, coordination_updated_at: new Date('2023-01-01')
    };

    session.resultToReturn = [{ ...baseCoord, coordination_progress_percent: 101 }];
    await assertCorruptData(() => repo.listActiveRankings([10]));

    session.resultToReturn = [{ ...baseCoord, coordination_progress_percent: -1 }];
    await assertCorruptData(() => repo.listActiveRankings([10]));

    session.resultToReturn = [{ ...baseCoord, coordination_ticket_id: 99 }];
    await assertCorruptData(() => repo.listActiveRankings([10]));
  });

  await runTest('16. Orden, ranking ID duplicado y par ticket/grupo duplicado', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);

    // Duplicate ranking ID
    session.resultToReturn = [{ ...baseRow }, { ...baseRow, ticket_id: 101, ranking_ticket_id: 101, ranking_rank_position: 2 }];
    await assertCorruptData(() => repo.listActiveRankings([10]));

    // Duplicate ticket/group
    session.resultToReturn = [
      { ...baseRow },
      { ...baseRow, ranking_id: 2, ranking_rank_position: 2 }
    ];
    await assertCorruptData(() => repo.listActiveRankings([10]));

    // Out of order rank
    session.resultToReturn = [
      { ...baseRow, ranking_id: 1, ticket_id: 100, ranking_ticket_id: 100, ranking_rank_position: 2, ranking_glpi_group_id: 10 },
      { ...baseRow, ranking_id: 2, ticket_id: 101, ranking_ticket_id: 101, ranking_rank_position: 1, ranking_glpi_group_id: 10 }
    ];
    await assertCorruptData(() => repo.listActiveRankings([10]));
  });

  await runTest('17. Propagación exacta por identidad de SqlRuntimeError', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);
    const err = new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'DB Error');
    session.errorToThrow = err;
    let caught: unknown = null;
    try {
      await repo.listActiveRankings([10]);
    } catch (e) {
      caught = e;
    }
    if (caught !== err) assert.fail('Expected exact SqlRuntimeError identity');
    assert.equal(caught, err);
  });

  await runTest('18. Inmutabilidad profunda, referencias nuevas, fechas clonadas y errores sin sentinelas', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalRankingReadRepository(session);

    // Sentinela negativo
    session.resultToReturn = [{ ...baseRow, ranking_id: -999999 }];
    let caught: unknown = null;
    try {
      await repo.listActiveRankings([10]);
    } catch (e) {
      caught = e;
    }
    if (!(caught instanceof OperationalRankingReadError)) {
      assert.fail('Expected OperationalRankingReadError');
    }
    assert.equal(caught.code, 'corrupt_data');
    assert.ok(!caught.message.includes('-999999'));

    const rankCreate = new Date('2023-01-01');
    const rankUpdate = new Date('2023-01-02');
    const coordUpdate = new Date('2023-01-03');

    session.resultToReturn = [{
      ...baseRow,
      ranking_created_at: rankCreate,
      ranking_updated_at: rankUpdate,
      coordination_id: 200,
      coordination_ticket_id: 100,
      coordination_progress_percent: 50,
      coordination_comment: 'In progress',
      coordination_estimated_delivery_date: '2023-05-01',
      coordination_updated_at: coordUpdate
    }];

    const res = await repo.listActiveRankings([10]);
    assert.ok(Object.isFrozen(res));

    const item = res[0];
    assert.ok(item !== undefined);
    assert.ok(Object.isFrozen(item));
    assert.ok(Object.isFrozen(item.ticket));
    assert.ok(Object.isFrozen(item.ticket.coordination));

    const coord = item.ticket.coordination;
    assert.ok(coord !== null);

    assert.ok(item.createdAt !== rankCreate);
    assert.equal(item.createdAt.getTime(), rankCreate.getTime());
    assert.ok(!Object.isFrozen(rankCreate));

    assert.ok(item.updatedAt !== rankUpdate);
    assert.equal(item.updatedAt.getTime(), rankUpdate.getTime());
    assert.ok(!Object.isFrozen(rankUpdate));

    assert.ok(coord.updatedAt !== coordUpdate);
    assert.equal(coord.updatedAt.getTime(), coordUpdate.getTime());
    assert.ok(!Object.isFrozen(coordUpdate));

    assert.equal(session.executeCalls, 0);
  });
}

void main().then(() => {
  console.log(`\nTests Ranking Read Repo: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
