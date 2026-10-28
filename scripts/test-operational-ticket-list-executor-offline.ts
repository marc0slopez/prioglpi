import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { executeOperationalTicketList } from '../lib/db/operational/operational-ticket-list-executor';
import { OperationalTicketListExecutionError } from '../lib/db/operational/operational-ticket-list-execution-types';
import { OperationalTicketListSqlError } from '../lib/db/operational/operational-ticket-list-sql-types';
import type { OperationalTicketListExecutionPlan } from '../lib/db/operational/operational-ticket-list-plan-types';
import type { OperationalTicketListQuery } from '../lib/db/operational/operational-ticket-list-types';
import type { ISqlServerRuntime, ISqlServerTransaction, SqlRow, SqlParameter, TransactionOptions } from '../lib/db/sqlserver-runtime-contract';
import { SqlRuntimeError } from '../lib/db/sqlserver-runtime-contract';

function countResponse(total: unknown): SqlRow[] {
  return [{ total }];
}

function rowResponse(...rows: Record<string, unknown>[]): SqlRow[] {
  return rows;
}

function createBasePlan(): OperationalTicketListExecutionPlan {
  const query: OperationalTicketListQuery = {
    actor: { role: 'admin', sectorGroupIds: Object.freeze([30]) },
    view: 'open', priority: 'ranked', page: 1, limit: 10, offset: 0,
    status: null, referentUserId: null, ticketId: null, technicianId: null,
    requesterId: null, categoryId: null, entityId: null, locationId: null,
    type: null, glpiPriority: null, sectorGroupId: null, sector: { type: 'all' },
    from: null, to: null, toExclusive: null, updatedFrom: null, updatedTo: null,
    search: null, title: null, description: null, notes: null, comments: null,
    isActiveRanking: false, isUnranked: false, hasTPR: false, tprVencida: false,
    unassignedTechnician: false, soporteDycosFilter: false, canSeePrivate: true, isDrillDown: false
  };
  return { query, referent: null, includeTicketIds: null, excludeTicketIds: [], activityTextTicketIds: null };
}

function createValidRowRaw(ticketId: number, isRanked: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {
    ticket_id: ticketId, title: 'Test', content_plain: 'Test', status: 1, status_label: 'New',
    type: 1, type_label: 'Incident', priority: 1, priority_label: 'Low',
    opened_at: '2026-08-01T10:00:00Z', updated_at_glpi: '2026-08-01T10:00:00Z',
    solved_at: null, closed_at: null, requester_name: 'Req', requester_group: 'Grp',
    assigned_technician: 'Tech', assigned_group_ids: '[]', assigned_group_names: '[]',
    detected_sector: 'Test', is_sistemas_scope: true, is_tecnologia_scope: true,
    web_url: 'http://test', synced_at: new Date('2026-08-01T10:00:00Z'),
    requester_user_id: null, requester_group_id: null, detected_sector_group_id: null,
    detected_sector_name: null, sector_source: null, category_id: null, entity_id: 1,
    location_id: null, request_type_id: 1, urgency: 1, impact: 1, glpi_priority: 1,

    ranking_id: null, ranking_ticket_id: null, ranking_sector_name: null, ranking_glpi_group_id: null,
    ranking_rank_position: null, ranking_created_by_user_id: null, ranking_updated_by_user_id: null,
    ranking_created_at: null, ranking_updated_at: null, ranking_is_active: null,

    coordination_id: null, coordination_ticket_id: null, coordination_progress_percent: null,
    coordination_comment: null, coordination_estimated_delivery_date: null,
    coordination_updated_by_user_id: null, coordination_updated_at: null
  };
  if (isRanked) {
    row.ranking_id = 100 + ticketId; row.ranking_ticket_id = ticketId;
    row.ranking_sector_name = 'Sec'; row.ranking_glpi_group_id = 10;
    row.ranking_rank_position = ticketId; row.ranking_created_by_user_id = 1;
    row.ranking_updated_by_user_id = 1; row.ranking_created_at = new Date('2026-08-01T10:00:00Z');
    row.ranking_updated_at = new Date('2026-08-01T10:00:00Z'); row.ranking_is_active = true;
  }
  return row;
}

class FakeTransaction implements ISqlServerTransaction {
  public queries: { sql: string; params: readonly SqlParameter[] }[] = [];
  constructor(private responses: SqlRow[][], private indexRef: { index: number }) {}
  async query(sql: string, params: readonly SqlParameter[] = []): Promise<SqlRow[]> {
    void params;
    this.queries.push({ sql, params });
    if (this.indexRef.index >= this.responses.length) {
      return [];
    }
    return this.responses[this.indexRef.index++];
  }
  async execute(sql: string, params: readonly SqlParameter[] = []): Promise<number> {
    void sql; void params;
    throw new Error('execute called');
  }
}

class FakeRuntime implements ISqlServerRuntime {
  public globalQueryCount = 0;
  public globalExecuteCount = 0;
  public commitCount = 0;
  public rollbackCount = 0;
  public isolationReceived: string | undefined;
  public txUsed: FakeTransaction | null = null;
  public indexRef = { index: 0 };
  public injectedError: SqlRuntimeError | null = null;

  constructor(public readonly queryResponses: SqlRow[][]) {}

  async query(sql: string, params: readonly SqlParameter[] = []): Promise<SqlRow[]> {
    void sql; void params;
    this.globalQueryCount++;
    return [];
  }
  async execute(sql: string, params: readonly SqlParameter[] = []): Promise<number> {
    void sql; void params;
    this.globalExecuteCount++;
    throw new Error('execute called');
  }
  async close(): Promise<void> {}
  async withTransaction<T>(options: TransactionOptions | undefined, fn: (tx: ISqlServerTransaction) => Promise<T>): Promise<T> {
    this.isolationReceived = options?.isolation;
    this.txUsed = new FakeTransaction(this.queryResponses, this.indexRef);
    try {
      if (this.injectedError !== null) {
        throw this.injectedError;
      }
      const res = await fn(this.txUsed);
      this.commitCount++;
      return res;
    } catch (err) {
      this.rollbackCount++;
      throw err;
    }
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

async function assertExecutionError(promise: Promise<unknown>, expectedCode: string) {
  try {
    await promise;
    assert.fail('Should have failed');
  } catch (err: unknown) {
    assert.ok(err instanceof OperationalTicketListExecutionError);
    assert.equal(err.code, expectedCode);
  }
}

async function main() {
  await runTest('1. ranked válido', async () => {
    const plan = createBasePlan();
    plan.query.priority = 'ranked';
    plan.query.page = 1; plan.query.limit = 2; plan.query.offset = 0;
    const r1 = createValidRowRaw(1, true);
    const r2 = createValidRowRaw(2, true);
    const rt = new FakeRuntime([
      countResponse(5),
      rowResponse(r1, r2)
    ]);
    const res = await executeOperationalTicketList(rt, plan, '2026-08-01');
    assert.equal(res.total, 5);
    assert.equal(res.tickets.length, 2);
    const ticket0 = res.tickets[0];
    assert.ok(ticket0 !== undefined);
    assert.equal(ticket0.ticketId, 1);
    const ranking0 = ticket0.rankings[0];
    assert.ok(ranking0 !== undefined);
    assert.equal(rt.txUsed?.queries.length, 2);
  });

  await runTest('2. unranked válido', async () => {
    const plan = createBasePlan();
    plan.query.priority = 'unranked';
    plan.query.page = 1; plan.query.limit = 2; plan.query.offset = 0;
    const r1 = createValidRowRaw(10, false); r1.opened_at = '2026-08-02T10:00:00Z';
    const r2 = createValidRowRaw(5, false);
    const rt = new FakeRuntime([
      countResponse(3),
      rowResponse(r1, r2)
    ]);
    const res = await executeOperationalTicketList(rt, plan, '2026-08-01');
    assert.equal(res.total, 3);
    assert.equal(res.tickets.length, 2);
    const ticket0 = res.tickets[0];
    assert.ok(ticket0 !== undefined);
    assert.ok(ticket0.rankings.length === 0);
    assert.equal(rt.txUsed?.queries.length, 2);
  });

  await runTest('3. all dividido entre ambas ramas', async () => {
    const plan = createBasePlan();
    plan.query.priority = 'all';
    plan.query.page = 2; plan.query.limit = 2; plan.query.offset = 2;
    // rankedCount=3, unrankedCount>=1
    const rRanked = createValidRowRaw(2, true);
    const rUnranked = createValidRowRaw(3, false);
    const rt = new FakeRuntime([
      countResponse(3), // ranked COUNT
      countResponse(5), // unranked COUNT
      rowResponse(rRanked),                   // ranked PAGE (limit 2, offset 2, rankedCount 3 = take 1)
      rowResponse(rUnranked)                  // unranked PAGE (rem 1, offset 0 = take 1)
    ]);
    const res = await executeOperationalTicketList(rt, plan, '2026-08-01');
    assert.equal(res.total, 8);
    assert.equal(res.tickets.length, 2);
    const ticket0 = res.tickets[0];
    assert.ok(ticket0 !== undefined);
    const ranking0 = ticket0.rankings[0];
    assert.ok(ranking0 !== undefined);
    const ticket1 = res.tickets[1];
    assert.ok(ticket1 !== undefined);
    assert.ok(ticket1.rankings.length === 0);
    assert.equal(rt.txUsed?.queries.length, 4);
  });

  await runTest('4. all con offset dentro de unranked', async () => {
    const plan = createBasePlan();
    plan.query.priority = 'all';
    plan.query.page = 3; plan.query.limit = 2; plan.query.offset = 4;
    // rankedCount=2, unrankedCount=4. offset relativo unranked=2
    const rt = new FakeRuntime([
      countResponse(2), // ranked COUNT
      countResponse(4), // unranked COUNT
      rowResponse(createValidRowRaw(5, false), createValidRowRaw(4, false)) // unranked PAGE
    ]);
    const res = await executeOperationalTicketList(rt, plan, '2026-08-01');
    assert.equal(res.total, 6);
    assert.equal(res.tickets.length, 2);
    const ticket0 = res.tickets[0];
    assert.ok(ticket0 !== undefined);
    assert.equal(ticket0.ticketId, 5); // Primero ticketId 5
    const ticket1 = res.tickets[1];
    assert.ok(ticket1 !== undefined);
    assert.equal(ticket1.ticketId, 4); // Despues ticketId 4
    assert.ok(ticket0.rankings.length === 0);
    assert.equal(rt.txUsed?.queries.length, 3);
  });

  await runTest('5. boundary offset === rankedCount', async () => {
    const plan = createBasePlan();
    plan.query.priority = 'all';
    plan.query.page = 2; plan.query.limit = 2; plan.query.offset = 2;
    // rankedCount=2. offset relativo unranked=0
    const rt = new FakeRuntime([
      countResponse(2),
      countResponse(5),
      rowResponse(createValidRowRaw(2, false), createValidRowRaw(1, false))
    ]);
    const res = await executeOperationalTicketList(rt, plan, '2026-08-01');
    assert.equal(res.total, 7);
    assert.equal(res.tickets.length, 2);
    const ticket0 = res.tickets[0];
    assert.ok(ticket0 !== undefined);
    assert.equal(ticket0.ticketId, 2);
    const ticket1 = res.tickets[1];
    assert.ok(ticket1 !== undefined);
    assert.equal(ticket1.ticketId, 1);
    assert.ok(ticket0.rankings.length === 0);
    assert.equal(rt.txUsed?.queries.length, 3);
  });

  await runTest('6. total cero y página fuera de rango sin PAGE query', async () => {
    const plan = createBasePlan();
    plan.query.priority = 'all';
    plan.query.page = 1; plan.query.limit = 10; plan.query.offset = 0;

    // A. rankedCount=0, unrankedCount=0 -> total=0
    let rt = new FakeRuntime([
      countResponse(0), // ranked COUNT
      countResponse(0)  // unranked COUNT
    ]);
    let res = await executeOperationalTicketList(rt, plan, '2026-08-01');
    assert.equal(res.total, 0);
    assert.equal(res.tickets.length, 0);
    assert.equal(rt.txUsed?.queries.length, 2);

    // B. total=5, offset=10 -> fuera de rango
    plan.query.page = 2;
    plan.query.limit = 10;
    plan.query.offset = 10;
    rt = new FakeRuntime([
      countResponse(2),
      countResponse(3)
    ]);
    res = await executeOperationalTicketList(rt, plan, '2026-08-01');
    assert.equal(res.total, 5);
    assert.equal(res.tickets.length, 0);
    assert.equal(rt.txUsed?.queries.length, 2);
  });

  await runTest('7. COUNT ausente, múltiple o corrupto', async () => {
    const plan = createBasePlan();
    await assertExecutionError(executeOperationalTicketList(new FakeRuntime([]), plan, '2026-08-01'), 'corrupt_data');
    await assertExecutionError(executeOperationalTicketList(new FakeRuntime([rowResponse({ total: 1 }, { total: 2 })]), plan, '2026-08-01'), 'corrupt_data');
    await assertExecutionError(executeOperationalTicketList(new FakeRuntime([rowResponse({ total: '5' })]), plan, '2026-08-01'), 'corrupt_data');
    await assertExecutionError(executeOperationalTicketList(new FakeRuntime([rowResponse({ total: 1, extra: 2 })]), plan, '2026-08-01'), 'corrupt_data');
  });

  await runTest('8. overflow de total combinado', async () => {
    const plan = createBasePlan();
    plan.query.priority = 'all';
    const rt = new FakeRuntime([
      countResponse(2000000000),
      countResponse(1000000000)
    ]);
    await assertExecutionError(executeOperationalTicketList(rt, plan, '2026-08-01'), 'corrupt_data');
  });

  await runTest('9. familias físicas corruptas del ticket', async () => {
    const plan = createBasePlan();
    const tests = [
      (r: Record<string, unknown>) => { r.ticket_id = -1; },
      (r: Record<string, unknown>) => { r.status = 99; },
      (r: Record<string, unknown>) => { r.opened_at = 2026; },
      (r: Record<string, unknown>) => { r.assigned_group_ids = '1,2,x'; },
      (r: Record<string, unknown>) => { r.sector_source = 123; }
    ];
    for (const mutate of tests) {
      const r = createValidRowRaw(1, true);
      mutate(r);
      const rt = new FakeRuntime([
        countResponse(1),
        rowResponse(r)
      ]);
      await assertExecutionError(executeOperationalTicketList(rt, plan, '2026-08-01'), 'corrupt_data');
    }

    const rValid = createValidRowRaw(1, true);
    rValid.entity_id = null;
    rValid.request_type_id = null;
    rValid.urgency = null;
    rValid.impact = null;
    rValid.glpi_priority = null;
    const rtValid = new FakeRuntime([
      countResponse(1),
      rowResponse(rValid)
    ]);
    const res = await executeOperationalTicketList(rtValid, plan, '2026-08-01');
    assert.equal(res.tickets.length, 1);
    const ticket0 = res.tickets[0];
    assert.ok(ticket0 !== undefined);
    assert.equal(ticket0.entityId, null);
    assert.equal(ticket0.requestTypeId, null);
    assert.equal(ticket0.urgency, null);
    assert.equal(ticket0.impact, null);
    assert.equal(ticket0.glpiPriority, null);
  });

  await runTest('10. ranking completo, nulo parcial y branch incorrecto', async () => {
    const plan = createBasePlan();
    let r = createValidRowRaw(1, true); r.ranking_id = null;
    let rt = new FakeRuntime([
      countResponse(1),
      rowResponse(r)
    ]);
    await assertExecutionError(executeOperationalTicketList(rt, plan, '2026-08-01'), 'corrupt_data');

    plan.query.priority = 'unranked';
    r = createValidRowRaw(1, true);
    rt = new FakeRuntime([
      countResponse(1),
      rowResponse(r)
    ]);
    await assertExecutionError(executeOperationalTicketList(rt, plan, '2026-08-01'), 'corrupt_data');
  });

  await runTest('11. ranking ticketId/estado/view discordantes', async () => {
    // subcase 1: ranking_ticket_id distinto de ticket_id
    const plan1 = createBasePlan();
    const r1 = createValidRowRaw(1, true);
    r1.ranking_ticket_id = 999;
    const rt1 = new FakeRuntime([countResponse(1), rowResponse(r1)]);
    await assertExecutionError(executeOperationalTicketList(rt1, plan1, '2026-08-01'), 'corrupt_data');

    // subcase 2: ranked history con ranking activo
    const plan2 = createBasePlan();
    plan2.query.view = 'history';
    const r2 = createValidRowRaw(1, true);
    r2.ranking_is_active = true;
    r2.status = 5;
    const rt2 = new FakeRuntime([countResponse(1), rowResponse(r2)]);
    await assertExecutionError(executeOperationalTicketList(rt2, plan2, '2026-08-01'), 'corrupt_data');

    // subcase 3: unranked view=open con status=5
    const plan3 = createBasePlan();
    plan3.query.view = 'open';
    plan3.query.priority = 'unranked';
    const r3 = createValidRowRaw(1, false);
    r3.status = 5;
    const rt3 = new FakeRuntime([countResponse(1), rowResponse(r3)]);
    await assertExecutionError(executeOperationalTicketList(rt3, plan3, '2026-08-01'), 'corrupt_data');

    // subcase 4: unranked view=history con status=1
    const plan4 = createBasePlan();
    plan4.query.view = 'history';
    plan4.query.priority = 'unranked';
    const r4 = createValidRowRaw(1, false);
    r4.status = 1;
    const rt4 = new FakeRuntime([countResponse(1), rowResponse(r4)]);
    await assertExecutionError(executeOperationalTicketList(rt4, plan4, '2026-08-01'), 'corrupt_data');
  });

  await runTest('12. coordinación completa, nula, parcial y discordante', async () => {
    const plan = createBasePlan();
    let r = createValidRowRaw(1, true);
    r.coordination_id = 1; r.coordination_ticket_id = 1; r.coordination_progress_percent = 50;
    r.coordination_comment = 'ok'; r.coordination_updated_by_user_id = 1; r.coordination_updated_at = new Date();
    let rt = new FakeRuntime([
      countResponse(1),
      rowResponse(r)
    ]);
    const res = await executeOperationalTicketList(rt, plan, '2026-08-01');
    const ticket0 = res.tickets[0];
    assert.ok(ticket0 !== undefined);
    const coordination = ticket0.coordination;
    assert.ok(coordination !== null);
    assert.ok(Object.isFrozen(coordination));

    r = createValidRowRaw(1, true);
    r.coordination_id = 1; r.coordination_ticket_id = null;
    rt = new FakeRuntime([
      countResponse(1),
      rowResponse(r)
    ]);
    await assertExecutionError(executeOperationalTicketList(rt, plan, '2026-08-01'), 'corrupt_data');

    r = createValidRowRaw(1, true);
    r.coordination_id = 1; r.coordination_ticket_id = 2; r.coordination_progress_percent = 50;
    r.coordination_comment = 'ok'; r.coordination_updated_by_user_id = 1; r.coordination_updated_at = new Date();
    rt = new FakeRuntime([
      countResponse(1),
      rowResponse(r)
    ]);
    await assertExecutionError(executeOperationalTicketList(rt, plan, '2026-08-01'), 'corrupt_data');
  });

  await runTest('13. ticketIds duplicados dentro/entre ramas', async () => {
    const plan = createBasePlan();
    let rt = new FakeRuntime([
      countResponse(2),
      rowResponse(createValidRowRaw(1, true), createValidRowRaw(1, true))
    ]);
    await assertExecutionError(executeOperationalTicketList(rt, plan, '2026-08-01'), 'corrupt_data');

    const planAll = createBasePlan();
    planAll.query.priority = 'all';
    planAll.query.page = 1; planAll.query.limit = 2; planAll.query.offset = 0;
    rt = new FakeRuntime([
      countResponse(1),
      countResponse(1),
      rowResponse(createValidRowRaw(1, true)),
      rowResponse(createValidRowRaw(1, false))
    ]);
    await assertExecutionError(executeOperationalTicketList(rt, planAll, '2026-08-01'), 'corrupt_data');
  });

  await runTest('14. orden ranked corrupto', async () => {
    const plan = createBasePlan();
    const rt = new FakeRuntime([
      countResponse(2),
      rowResponse(createValidRowRaw(2, true), createValidRowRaw(1, true))
    ]);
    await assertExecutionError(executeOperationalTicketList(rt, plan, '2026-08-01'), 'corrupt_data');
  });

  await runTest('15. orden unranked corrupto', async () => {
    const plan = createBasePlan();
    plan.query.priority = 'unranked';
    const r1 = createValidRowRaw(1, false);
    const r2 = createValidRowRaw(2, false);
    r2.opened_at = '2026-08-02T10:00:00Z';
    const rt = new FakeRuntime([
      countResponse(2),
      rowResponse(r1, r2)
    ]);
    await assertExecutionError(executeOperationalTicketList(rt, plan, '2026-08-01'), 'corrupt_data');
  });

  await runTest('16. cantidad PAGE distinta de la esperada', async () => {
    const plan = createBasePlan();
    plan.query.page = 1; plan.query.limit = 5; plan.query.offset = 0;

    // underfetch
    let rt = new FakeRuntime([
      countResponse(5),
      rowResponse(createValidRowRaw(1, true))
    ]);
    await assertExecutionError(executeOperationalTicketList(rt, plan, '2026-08-01'), 'corrupt_data');

    // overfetch
    plan.query.limit = 1;
    rt = new FakeRuntime([
      countResponse(5),
      rowResponse(createValidRowRaw(1, true), createValidRowRaw(2, true))
    ]);
    await assertExecutionError(executeOperationalTicketList(rt, plan, '2026-08-01'), 'corrupt_data');
  });

  await runTest('17. transacción serializable, cero query global y propagación exacta de errores', async () => {
    const plan = createBasePlan();
    plan.query.offset = 0; plan.query.page = 1; plan.query.limit = 10;

    const rtA = new FakeRuntime([countResponse(0)]);
    await executeOperationalTicketList(rtA, plan, '2026-08-01');
    assert.equal(rtA.commitCount, 1);
    assert.equal(rtA.rollbackCount, 0);
    assert.equal(rtA.globalQueryCount, 0);
    assert.equal(rtA.globalExecuteCount, 0);
    assert.equal(rtA.isolationReceived, 'serializable');

    const rtB = new FakeRuntime([]);
    const injectedError = new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'sanitized');
    rtB.injectedError = injectedError;
    try {
      await executeOperationalTicketList(rtB, plan, '2026-08-01');
      assert.fail();
    } catch (err: unknown) {
      assert.ok(err === injectedError);
    }
    assert.equal(rtB.commitCount, 0);
    assert.equal(rtB.rollbackCount, 1);

    const rtC = new FakeRuntime([]);
    plan.query.offset = 1;
    try {
      await executeOperationalTicketList(rtC, plan, '2026-08-01');
      assert.fail();
    } catch (err: unknown) {
      assert.ok(err instanceof OperationalTicketListSqlError);
    }
    assert.equal(rtC.commitCount, 0);
    assert.equal(rtC.rollbackCount, 0);
    assert.equal(rtC.isolationReceived, undefined);
  });

  await runTest('18. inmutabilidad profunda, fechas clonadas y prueba arquitectónica estática', async () => {
    const plan = createBasePlan();
    const holder: { original: Date | null } = { original: null };
    const r = createValidRowRaw(1, true);
    const syncedAt = r.synced_at;
    assert.ok(syncedAt instanceof Date);
    holder.original = syncedAt;

    const rt = new FakeRuntime([
      countResponse(1),
      rowResponse(r)
    ]);
    const res = await executeOperationalTicketList(rt, plan, '2026-08-01');
    assert.ok(Object.isFrozen(res));
    assert.ok(Object.isFrozen(res.tickets));
    const ticket0 = res.tickets[0];
    assert.ok(ticket0 !== undefined);
    assert.ok(Object.isFrozen(ticket0));
    assert.ok(Object.isFrozen(ticket0.assignedGroupIds));
    assert.ok(Object.isFrozen(ticket0.assignedGroupNames));
    assert.ok(Object.isFrozen(ticket0.rankings));
    const ranking0 = ticket0.rankings[0];
    assert.ok(ranking0 !== undefined);
    assert.ok(Object.isFrozen(ranking0));

    assert.notEqual(ticket0.syncedAt, holder.original);
    assert.equal(ticket0.syncedAt.getTime(), holder.original.getTime());

    const execFile = await readFile(path.join(process.cwd(), 'lib/db/operational/operational-ticket-list-executor.ts'), 'utf8');
    const mapFile = await readFile(path.join(process.cwd(), 'lib/db/operational/operational-ticket-list-row-mapper.ts'), 'utf8');
    assert.ok(!execFile.includes('Prisma'));
    assert.ok(!mapFile.includes('Prisma'));
    assert.ok(!/['"]next['"]/.test(execFile));
    assert.ok(!/['"]next['"]/.test(mapFile));
    assert.ok(!execFile.includes('process.env'));
    assert.ok(!mapFile.includes('process.env'));
    assert.ok(!execFile.includes('SELECT'));
    assert.ok(!mapFile.includes('SELECT'));
    assert.ok(!execFile.includes('[prioglpi]'));
    assert.ok(!mapFile.includes('[prioglpi]'));
    assert.ok(execFile.includes('buildOperationalTicketListCountProgram'));
    assert.ok(execFile.includes('buildOperationalTicketListPageStatement'));
  });
}

void main().then(() => {
  console.log(`\nTests Operational Ticket List Executor: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
