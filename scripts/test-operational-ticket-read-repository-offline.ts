import assert from 'node:assert/strict';
import { SqlServerOperationalTicketReadRepository } from '../lib/db/operational/sqlserver-operational-ticket-read-repository';
import { OperationalTicketReadError } from '../lib/db/operational/operational-ticket-read-repository';
import { SqlRuntimeError } from '../lib/db/sqlserver-runtime-contract';
import type { ISqlServerSession, SqlRow, SqlParameter } from '../lib/db/sqlserver-runtime-contract';

class FakeSession implements ISqlServerSession {
  public rows: SqlRow[] = [];
  public forceError: Error | null = null;
  public lastSql = '';
  public lastParams: SqlParameter[] = [];

  async query(sql: string, params?: SqlParameter[]): Promise<SqlRow[]> {
    this.lastSql = sql;
    this.lastParams = params || [];
    if (this.forceError) throw this.forceError;
    return this.rows;
  }

  async execute(sql: string, params?: SqlParameter[]): Promise<number> {
    void sql;
    void params;
    return 0;
  }
}

let passed = 0;
let failed = 0;
let total = 0;

async function runTest(name: string, fn: () => Promise<void>) {
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

function makeTicketRow(overrides?: Record<string, unknown>): SqlRow {
  return {
    ticket_id: 100,
    title: 'test title',
    content_plain: 'test content',
    status: 1,
    status_label: 'test status',
    type: 1,
    type_label: 'test type',
    priority: 1,
    priority_label: 'test priority',
    opened_at: '2023',
    updated_at_glpi: '2023',
    solved_at: null,
    closed_at: null,
    requester_name: 'req',
    requester_group: 'req g',
    assigned_technician: 'tech',
    assigned_group_ids: '[]',
    assigned_group_names: '[]',
    detected_sector: 's1',
    is_sistemas_scope: true,
    is_tecnologia_scope: false,
    web_url: 'http',
    synced_at: new Date('2023-01-01T00:00:00Z'),
    requester_user_id: null,
    requester_group_id: null,
    detected_sector_group_id: null,
    detected_sector_name: null,
    sector_source: null,
    category_id: null,
    entity_id: null,
    location_id: null,
    request_type_id: null,
    urgency: null,
    impact: null,
    glpi_priority: null,
    ...overrides
  };
}

function makeRankingRow(overrides?: Record<string, unknown>): SqlRow {
  return {
    id: 1,
    ticket_id: 100,
    sector_name: 's1',
    glpi_group_id: 10,
    rank_position: 1,
    created_by_user_id: 1,
    updated_by_user_id: 1,
    created_at: new Date('2023-01-01T00:00:00Z'),
    updated_at: new Date('2023-01-01T00:00:00Z'),
    is_active: true,
    ...overrides
  };
}

function makeCoordinationRow(overrides?: Record<string, unknown>): SqlRow {
  return {
    id: 1,
    ticket_id: 100,
    progress_percent: 50,
    coordinator_comment: 'test',
    estimated_delivery_date: null,
    updated_by_user_id: 1,
    updated_at: new Date(),
    ...overrides
  };
}

function makeFollowupRow(overrides?: Record<string, unknown>): SqlRow {
  return {
    followup_id: 1,
    ticket_id: 100,
    author: null,
    content_plain: 'f',
    is_private: false,
    created_at: new Date('2023-01-01T00:00:00Z'),
    updated_at: new Date('2023-01-01T00:00:00Z'),
    ...overrides
  };
}

function makeTaskRow(overrides?: Record<string, unknown>): SqlRow {
  return {
    task_id: 1,
    ticket_id: 100,
    author: null,
    technician: null,
    tech_group: null,
    content_plain: 't',
    is_private: false,
    state: 1,
    created_at: new Date('2023-01-01T00:00:00Z'),
    updated_at: new Date('2023-01-01T00:00:00Z'),
    ...overrides
  };
}

async function assertCorruptData(fn: () => Promise<unknown>) {
  let caught: OperationalTicketReadError | null = null;
  try {
    await fn();
  } catch (err) {
    if (err instanceof OperationalTicketReadError) caught = err;
  }
  assert.ok(caught, 'Expected error but none was thrown');
  assert.equal(caught.code, 'corrupt_data');
}

function assertSafeTicketQuery(session: FakeSession, expectedTicketId: number): void {
  assert.equal(session.lastParams.length, 1, 'Exactly one parameter expected');
  const param = session.lastParams[0];
  assert.ok(param !== undefined, 'Parameter must be defined');
  assert.equal(param.type, 'int', 'Parameter type must be int');
  if (param.type === 'int') {
    assert.equal(param.name, 'ticketId', "Parameter name must be 'ticketId'");
    assert.equal(param.nullable, false, 'Parameter must not be nullable');
    assert.equal(param.value, expectedTicketId, 'Parameter value mismatch');
  }

  const sqlLower = session.lastSql.toLowerCase();
  assert.equal(session.lastSql.includes(String(expectedTicketId)), false, 'Sentinel injected as plain string in SQL');
  assert.equal(/select\s+\*/i.test(session.lastSql), false, 'Contiene SELECT *');
  assert.equal(sqlLower.includes('sqlite'), false, 'Contiene sqlite');
  assert.equal(sqlLower.includes('prioglpi_user_access'), false, 'Contiene prioglpi_user_access');
}

async function main() {
  await runTest('1. Ticket valido, ausente y ambiguo', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);

    session.rows = [makeTicketRow()];
    const t1 = await repo.findTicketById(100);
    assert.ok(t1);

    session.rows = [];
    const t2 = await repo.findTicketById(100);
    assert.equal(t2, null);

    session.rows = [makeTicketRow(), makeTicketRow()];
    let caught: OperationalTicketReadError | null = null;
    try { await repo.findTicketById(100); } catch (e) { if (e instanceof OperationalTicketReadError) caught = e; }
    assert.ok(caught);
    assert.equal(caught.code, 'ambiguous_result');
  });

  await runTest('2. Coordinacion valida, ausente y ambigua', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);

    session.rows = [makeCoordinationRow()];
    const c1 = await repo.findCoordinationByTicketId(100);
    assert.ok(c1);

    session.rows = [];
    const c2 = await repo.findCoordinationByTicketId(100);
    assert.equal(c2, null);

    session.rows = [makeCoordinationRow(), makeCoordinationRow()];
    let caught: OperationalTicketReadError | null = null;
    try { await repo.findCoordinationByTicketId(100); } catch (e) { if (e instanceof OperationalTicketReadError) caught = e; }
    assert.ok(caught);
    assert.equal(caught.code, 'ambiguous_result');
  });

  await runTest('3. Ranking ordenado y unicamente activo (Validacion inicial)', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);

    session.rows = [makeRankingRow()];
    const r1 = await repo.listActiveRankingsByTicketId(100);
    assert.equal(r1.length, 1);
  });

  await runTest('4. Followups y Tasks ordenados (Validacion inicial)', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);

    session.rows = [makeFollowupRow()];
    const f1 = await repo.listFollowupsByTicketId(100);
    assert.equal(f1.length, 1);

    session.rows = [makeTaskRow()];
    const t1 = await repo.listTasksByTicketId(100);
    assert.equal(t1.length, 1);
  });

  await runTest('5. Rechazo de IDs invalidos antes de ejecutar query', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const badIds: any[] = [NaN, Infinity, 1.5, 0, -1, Number.MAX_SAFE_INTEGER + 1, 2147483648];
    for (const bad of badIds) {
      let caught: OperationalTicketReadError | null = null;
      try { await repo.findTicketById(bad); } catch (e) { if (e instanceof OperationalTicketReadError) caught = e; }
      assert.ok(caught);
      assert.equal(caught.code, 'invalid_input');
    }
  });

  await runTest('6. Rechazo de fechas invalidas', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    const badDates = [null, '2023-01-01', new Date('invalid'), 123];
    for (const dt of badDates) {
      session.rows = [makeTicketRow({ synced_at: dt })];
      await assertCorruptData(() => repo.findTicketById(100));
    }
  });

  await runTest('7. Rechazo de null en campos obligatorios', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    session.rows = [makeTicketRow({ title: null })];
    await assertCorruptData(() => repo.findTicketById(100));
  });

  await runTest('8. Rechazo de tipos incorrectos en cada familia', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    session.rows = [makeTicketRow({ status: '1' })];
    await assertCorruptData(() => repo.findTicketById(100));
    session.rows = [makeTicketRow({ title: 123 })];
    await assertCorruptData(() => repo.findTicketById(100));
  });

  await runTest('9. Clonacion de Date e inmutabilidad de row', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    const originalDate = new Date('2023-01-01T00:00:00Z');
    const row = makeTicketRow({ synced_at: originalDate });
    session.rows = [row];
    const t = await repo.findTicketById(100);
    assert.ok(t);
    assert.notEqual(t.syncedAt, originalDate);
    assert.equal(t.syncedAt.getTime(), originalDate.getTime());
  });

  await runTest('10. Propagacion exacta de SqlRuntimeError', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    const err = new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'test');
    session.forceError = err;
    let caught: unknown = null;
    try { await repo.findTicketById(100); } catch (e) { caught = e; }
    assert.equal(caught, err);
  });

  await runTest('11. Tests de Seguridad SQL y pureza de consultas', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    const sentinelTicketId = 987654321;

    session.rows = [makeTicketRow({ ticket_id: sentinelTicketId })];
    await repo.findTicketById(sentinelTicketId);
    assertSafeTicketQuery(session, sentinelTicketId);

    session.rows = [makeRankingRow({ ticket_id: sentinelTicketId })];
    await repo.listActiveRankingsByTicketId(sentinelTicketId);
    assertSafeTicketQuery(session, sentinelTicketId);

    session.rows = [makeCoordinationRow({ ticket_id: sentinelTicketId })];
    await repo.findCoordinationByTicketId(sentinelTicketId);
    assertSafeTicketQuery(session, sentinelTicketId);

    session.rows = [makeFollowupRow({ ticket_id: sentinelTicketId })];
    await repo.listFollowupsByTicketId(sentinelTicketId);
    assertSafeTicketQuery(session, sentinelTicketId);

    session.rows = [makeTaskRow({ ticket_id: sentinelTicketId })];
    await repo.listTasksByTicketId(sentinelTicketId);
    assertSafeTicketQuery(session, sentinelTicketId);
  });

  await runTest('12. Tests BIT: tolerancias y rechazos estrictos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);

    // Tickets valid bits
    session.rows = [makeTicketRow({ is_sistemas_scope: true, is_tecnologia_scope: 1 })];
    const t1 = await repo.findTicketById(100);
    assert.equal(t1?.isSistemasScope, true);
    assert.equal(t1?.isTecnologiaScope, true);

    session.rows = [makeTicketRow({ is_sistemas_scope: false, is_tecnologia_scope: 0 })];
    const t2 = await repo.findTicketById(100);
    assert.equal(t2?.isSistemasScope, false);
    assert.equal(t2?.isTecnologiaScope, false);

    // Reject bad bits
    const badBits = [null, 'true', '1', 2, -1, undefined];
    for (const bit of badBits) {
      session.rows = [makeTicketRow({ is_sistemas_scope: bit })];
      await assertCorruptData(() => repo.findTicketById(100));
    }

    // Ranking is_active must be exactly true
    session.rows = [makeRankingRow({ is_active: false })];
    await assertCorruptData(() => repo.listActiveRankingsByTicketId(100));

    session.rows = [makeRankingRow({ is_active: 0 })];
    await assertCorruptData(() => repo.listActiveRankingsByTicketId(100));
  });

  await runTest('13. Tests de Postcondiciones de Ticket ID', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);

    session.rows = [makeTicketRow({ ticket_id: 999 })];
    await assertCorruptData(() => repo.findTicketById(100));

    session.rows = [makeRankingRow({ ticket_id: 999 })];
    await assertCorruptData(() => repo.listActiveRankingsByTicketId(100));

    session.rows = [makeCoordinationRow({ ticket_id: 999 })];
    await assertCorruptData(() => repo.findCoordinationByTicketId(100));

    session.rows = [makeFollowupRow({ ticket_id: 999 })];
    await assertCorruptData(() => repo.listFollowupsByTicketId(100));

    session.rows = [makeTaskRow({ ticket_id: 999 })];
    await assertCorruptData(() => repo.listTasksByTicketId(100));
  });

  await runTest('14. Tests de Checks del DDL: positividad y rangos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);

    // IDs cero o negativos en ticket
    session.rows = [makeTicketRow({ requester_user_id: 0 })];
    await assertCorruptData(() => repo.findTicketById(100));
    session.rows = [makeTicketRow({ requester_group_id: -1 })];
    await assertCorruptData(() => repo.findTicketById(100));
    session.rows = [makeTicketRow({ detected_sector_group_id: 0 })];
    await assertCorruptData(() => repo.findTicketById(100));

    // Validar que los no forzados pasan (ej. category_id)
    session.rows = [makeTicketRow({ category_id: 0, entity_id: -1, location_id: -5, request_type_id: 0, urgency: -1, impact: -1, glpi_priority: 0 })];
    const t1 = await repo.findTicketById(100);
    assert.ok(t1);

    // Ranking
    session.rows = [makeRankingRow({ id: 0 })];
    await assertCorruptData(() => repo.listActiveRankingsByTicketId(100));
    session.rows = [makeRankingRow({ rank_position: 0 })];
    await assertCorruptData(() => repo.listActiveRankingsByTicketId(100));
    session.rows = [makeRankingRow({ glpi_group_id: -1 })];
    await assertCorruptData(() => repo.listActiveRankingsByTicketId(100));
    session.rows = [makeRankingRow({ created_by_user_id: 0 })];
    await assertCorruptData(() => repo.listActiveRankingsByTicketId(100));

    // Coordinacion
    session.rows = [makeCoordinationRow({ updated_by_user_id: 0 })];
    await assertCorruptData(() => repo.findCoordinationByTicketId(100));
    session.rows = [makeCoordinationRow({ progress_percent: -1 })];
    await assertCorruptData(() => repo.findCoordinationByTicketId(100));
    session.rows = [makeCoordinationRow({ progress_percent: 101 })];
    await assertCorruptData(() => repo.findCoordinationByTicketId(100));

    // Followup
    session.rows = [makeFollowupRow({ followup_id: 0 })];
    await assertCorruptData(() => repo.listFollowupsByTicketId(100));

    // Task
    session.rows = [makeTaskRow({ task_id: -1 })];
    await assertCorruptData(() => repo.listTasksByTicketId(100));
    session.rows = [makeTaskRow({ state: 0 })]; // state puede ser cero
    const ts1 = await repo.listTasksByTicketId(100);
    assert.equal(ts1.length, 1);
  });

  await runTest('15. Tests de Orden de Colecciones', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);

    // Rankings desordenados (rankPosition)
    session.rows = [
      makeRankingRow({ id: 1, rank_position: 2 }),
      makeRankingRow({ id: 2, rank_position: 1 })
    ];
    await assertCorruptData(() => repo.listActiveRankingsByTicketId(100));

    // Rankings desordenados (id en empate de rank)
    session.rows = [
      makeRankingRow({ id: 2, rank_position: 1 }),
      makeRankingRow({ id: 1, rank_position: 1 })
    ];
    await assertCorruptData(() => repo.listActiveRankingsByTicketId(100));

    // Followups desordenados (createdAt)
    session.rows = [
      makeFollowupRow({ followup_id: 1, created_at: new Date('2023-01-02') }),
      makeFollowupRow({ followup_id: 2, created_at: new Date('2023-01-01') })
    ];
    await assertCorruptData(() => repo.listFollowupsByTicketId(100));

    // Followups desordenados (followupId en empate de createdAt)
    session.rows = [
      makeFollowupRow({ followup_id: 2, created_at: new Date('2023-01-01') }),
      makeFollowupRow({ followup_id: 1, created_at: new Date('2023-01-01') })
    ];
    await assertCorruptData(() => repo.listFollowupsByTicketId(100));

    // Tasks desordenados (createdAt)
    session.rows = [
      makeTaskRow({ task_id: 1, created_at: new Date('2023-01-02') }),
      makeTaskRow({ task_id: 2, created_at: new Date('2023-01-01') })
    ];
    await assertCorruptData(() => repo.listTasksByTicketId(100));

    // Tasks desordenados (taskId en empate de createdAt)
    session.rows = [
      makeTaskRow({ task_id: 2, created_at: new Date('2023-01-01') }),
      makeTaskRow({ task_id: 1, created_at: new Date('2023-01-01') })
    ];
    await assertCorruptData(() => repo.listTasksByTicketId(100));
  });
}

void main().then(() => {
  console.log(`\nTests Operational Ticket Read Repo: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
