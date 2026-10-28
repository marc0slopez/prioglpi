import assert from 'node:assert/strict';
import { SqlServerOperationalTicketReadRepository } from '../lib/db/operational/sqlserver-operational-ticket-read-repository';
import { OperationalTicketReadError } from '../lib/db/operational/operational-ticket-read-repository';
import { buildOperationalUnrankedTicketResponse } from '../lib/db/operational/operational-unranked-ticket-response';
import { OperationalTicketDetailError } from '../lib/db/operational/operational-ticket-detail';
import { SqlRuntimeError } from '../lib/db/sqlserver-runtime-contract';
import type { ISqlServerSession, SqlRow, SqlParameter } from '../lib/db/sqlserver-runtime-contract';
import type { OperationalUnrankedTicketPage, OperationalTicket } from '../lib/db/operational/operational-ticket-types';

class FakeSession implements ISqlServerSession {
  public rows: SqlRow[] = [];
  public countRows: SqlRow[] = [{ total: 1 }];
  public forceError: Error | null = null;
  public queryLog: { sql: string, params: SqlParameter[] }[] = [];

  async query(sql: string, params?: SqlParameter[]): Promise<SqlRow[]> {
    if (this.forceError) throw this.forceError;
    this.queryLog.push({ sql, params: params || [] });
    if (sql.toLowerCase().includes('count(')) return this.countRows;
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

function makeJoinedRow(overrides?: Record<string, unknown>): SqlRow {
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
    detected_sector_group_id: 10,
    detected_sector_name: null,
    sector_source: null,
    category_id: null,
    entity_id: null,
    location_id: null,
    request_type_id: null,
    urgency: null,
    impact: null,
    glpi_priority: null,

    coordination_id: null,
    coordination_ticket_id: null,
    coordination_progress_percent: null,
    coordination_comment: null,
    coordination_estimated_delivery_date: null,
    coordination_updated_by_user_id: null,
    coordination_updated_at: null,
    ...overrides
  };
}

function makeOperationalTicket(overrides?: Partial<OperationalTicket>): OperationalTicket {
  return {
    ticketId: 100,
    title: 'test title',
    contentPlain: 'test content',
    status: 1,
    statusLabel: 'test status',
    type: 1,
    typeLabel: 'test type',
    priority: 1,
    priorityLabel: 'test priority',
    openedAt: '2023',
    updatedAtGlpi: '2023',
    solvedAt: null,
    closedAt: null,
    requesterName: 'req',
    requesterGroup: 'req g',
    assignedTechnician: 'tech',
    assignedGroupIds: '[]',
    assignedGroupNames: '[]',
    detectedSector: 's1',
    isSistemasScope: true,
    isTecnologiaScope: false,
    webUrl: 'http',
    syncedAt: new Date('2023-01-01T00:00:00Z'),
    requesterUserId: null,
    requesterGroupId: null,
    detectedSectorGroupId: 10,
    detectedSectorName: null,
    sectorSource: null,
    categoryId: null,
    entityId: null,
    locationId: null,
    requestTypeId: null,
    urgency: null,
    impact: null,
    glpiPriority: null,
    ...overrides
  };
}

async function assertCorruptData(fn: () => Promise<unknown>) {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    if (err instanceof OperationalTicketReadError) caught = err;
  }
  assert.ok(caught instanceof OperationalTicketReadError);
  assert.equal(caught.code, 'corrupt_data');
}

async function assertInvalidInput(fn: () => Promise<unknown>) {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    if (err instanceof OperationalTicketReadError) caught = err;
  }
  assert.ok(caught instanceof OperationalTicketReadError);
  assert.equal(caught.code, 'invalid_input');
}

async function main() {
  await runTest('1. Pagina valida con coordinacion', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    session.countRows = [{ total: 1 }];
    session.rows = [makeJoinedRow({
      coordination_id: 1,
      coordination_ticket_id: 100,
      coordination_progress_percent: 50,
      coordination_comment: 'test',
      coordination_estimated_delivery_date: null,
      coordination_updated_by_user_id: 1,
      coordination_updated_at: new Date()
    })];
    const page = await repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 });
    assert.equal(page.items.length, 1);
    assert.ok(page.items[0].coordination);
  });

  await runTest('2. Pagina valida sin coordinacion', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    session.countRows = [{ total: 1 }];
    session.rows = [makeJoinedRow()];
    const page = await repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].coordination, null);
  });

  await runTest('3. Pagina vacia con total cero ejecuta ambas queries', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    session.countRows = [{ total: 0 }];
    session.rows = []; // Vacia
    const page = await repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 });
    assert.equal(page.items.length, 0);
    assert.equal(session.queryLog.length, 2);
  });

  await runTest('4. Validacion de groupId, page y limit', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);

    // Entradas invalidas de input
    const totallyInvalid: unknown[] = [null, undefined, 'string', 123, [], {}];
    for (const bad of totallyInvalid) {
      await assertInvalidInput(() => repo.listUnrankedTicketsPage(bad));
    }

    // Faltan propiedades
    await assertInvalidInput(() => repo.listUnrankedTicketsPage({ page: 1, limit: 10 }));
    await assertInvalidInput(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, limit: 10 }));
    await assertInvalidInput(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1 }));

    // Numeros invalidos
    const badNums: unknown[] = [0, -1, 1.5, NaN, Infinity, '1', null, undefined];
    for (const bad of badNums) {
      await assertInvalidInput(() => repo.listUnrankedTicketsPage({ glpiGroupId: bad, page: 1, limit: 10 }));
      await assertInvalidInput(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: bad, limit: 10 }));
      await assertInvalidInput(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: bad }));
    }
    await assertInvalidInput(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 201 }));
    assert.equal(session.queryLog.length, 0); // Comprobar cero queries
  });

  await runTest('5. Rechazo de offset desbordado antes de query', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    await assertInvalidInput(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 2147483647, limit: 200 }));
    assert.equal(session.queryLog.length, 0);
  });

  await runTest('6. Parametros SQL exactos y sql logico', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    const sentinelId = 987654321;
    session.countRows = [{ total: 1 }];
    session.rows = [makeJoinedRow({ detected_sector_group_id: sentinelId })];
    await repo.listUnrankedTicketsPage({ glpiGroupId: sentinelId, page: 3, limit: 10 });

    assert.equal(session.queryLog.length, 2);

    const countQuery = session.queryLog[0];
    assert.equal(countQuery.params.length, 1);
    const p1 = countQuery.params[0];
    assert.equal(p1.name, 'glpiGroupId');
    assert.equal(p1.type, 'int');
    assert.equal(p1.nullable, false);
    assert.equal(p1.value, sentinelId);

    const countSql = countQuery.sql.toLowerCase();
    assert.ok(!countSql.includes(String(sentinelId)), 'Contiene sentinel textualmente en count');
    assert.ok(!/select\s+\*/i.test(countSql), 'Contiene select * en count');
    assert.ok(!countSql.includes('sqlite'), 'Contiene sqlite en count');
    assert.ok(!countSql.includes('prisma'), 'Contiene prisma en count');
    assert.ok(!countSql.includes('prioglpi_user_access'), 'Contiene prioglpi_user_access en count');
    assert.ok(countSql.includes('not exists'), 'Falta NOT EXISTS en count');
    assert.ok(countSql.includes('is_sistemas_scope] = 1'), 'Falta is_sistemas_scope = 1 en count');
    assert.ok(countSql.includes('status] in (1, 2, 3, 4)'), 'Falta status IN en count');
    assert.ok(countSql.includes('detected_sector_group_id] = @glpigroupid'), 'Falta detected_sector_group_id en count');

    const dataQuery = session.queryLog[1];
    assert.equal(dataQuery.params.length, 3);
    const dataSql = dataQuery.sql.toLowerCase();
    assert.ok(!dataSql.includes(String(sentinelId)), 'Contiene sentinel textualmente en data');
    assert.ok(!/select\s+\*/i.test(dataSql), 'Contiene select * en data');
    assert.ok(!dataSql.includes('sqlite'), 'Contiene sqlite en data');
    assert.ok(!dataSql.includes('prisma'), 'Contiene prisma en data');
    assert.ok(!dataSql.includes('prioglpi_user_access'), 'Contiene prioglpi_user_access en data');
    assert.ok(dataSql.includes('not exists'), 'Falta NOT EXISTS en data');
    assert.ok(dataSql.includes('is_sistemas_scope] = 1'), 'Falta is_sistemas_scope = 1 en data');
    assert.ok(dataSql.includes('status] in (1, 2, 3, 4)'), 'Falta status IN en data');
    assert.ok(dataSql.includes('detected_sector_group_id] = @glpigroupid'), 'Falta detected_sector_group_id en data');

    assert.ok(dataSql.includes('left join'), 'Falta LEFT JOIN');
    assert.ok(dataSql.includes('order by t.[opened_at] desc, t.[ticket_id] asc'), 'Falta ORDER BY exacto');
    assert.ok(dataSql.includes('offset @offset rows'), 'Falta OFFSET');
    assert.ok(dataSql.includes('fetch next @limit rows only'), 'Falta FETCH');

    const pg1 = dataQuery.params.find(p => p.name === 'glpiGroupId');
    const pg2 = dataQuery.params.find(p => p.name === 'offset');
    const pg3 = dataQuery.params.find(p => p.name === 'limit');
    assert.ok(pg1 && pg1.type === 'int' && pg1.nullable === false && pg1.value === sentinelId);
    assert.ok(pg2 && pg2.type === 'int' && pg2.nullable === false && pg2.value === 20); // offset = (3-1)*10 = 20
    assert.ok(pg3 && pg3.type === 'int' && pg3.nullable === false && pg3.value === 10);
  });

  await runTest('7. Conteo malicioso de total', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);

    session.countRows = [];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));

    session.countRows = [{ total: 1 }, { total: 2 }];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));

    session.countRows = [{ total: -1 }];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));

    session.countRows = [{ total: 1.5 }];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));

    session.countRows = [{ total: NaN }];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));

    session.countRows = [{ total: Infinity }];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));

    session.countRows = [{ total: '1' }];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));

    session.countRows = [{ total: null }];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));

    // Cero total pero retorna items
    session.countRows = [{ total: 0 }];
    session.rows = [makeJoinedRow()];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));
  });

  await runTest('8. Ticket con grupo, scope o status discordante', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);

    session.countRows = [{ total: 1 }];
    session.rows = [makeJoinedRow({ detected_sector_group_id: 99 })];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));

    session.rows = [makeJoinedRow({ is_sistemas_scope: false })];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));

    session.rows = [makeJoinedRow({ status: 5 })];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));
  });

  await runTest('9. Coordinacion parcialmente nula o discordante', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    session.countRows = [{ total: 1 }];

    session.rows = [makeJoinedRow({
      coordination_id: null,
      coordination_ticket_id: 100 // Parcial
    })];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));

    session.rows = [makeJoinedRow({
      coordination_id: 1,
      coordination_ticket_id: 999, // mismatch
      coordination_progress_percent: 50,
      coordination_comment: 'test',
      coordination_estimated_delivery_date: null,
      coordination_updated_by_user_id: 1,
      coordination_updated_at: new Date()
    })];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));
  });

  await runTest('10. Tickets duplicados', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    session.countRows = [{ total: 2 }];
    session.rows = [makeJoinedRow({ ticket_id: 100 }), makeJoinedRow({ ticket_id: 100 })];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));
  });

  await runTest('11. Mas filas que limit', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    session.countRows = [{ total: 2 }];
    // limit 1, pero sql devuelve 2
    session.rows = [makeJoinedRow({ ticket_id: 100 }), makeJoinedRow({ ticket_id: 101 })];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 1 }));
  });

  await runTest('12. Total menor que items', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    session.countRows = [{ total: 1 }];
    // limit 10, pero total es 1 y devuelve 2
    session.rows = [makeJoinedRow({ ticket_id: 100 }), makeJoinedRow({ ticket_id: 101 })];
    await assertCorruptData(() => repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }));
  });

  await runTest('13. Propagacion exacta de SqlRuntimeError', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketReadRepository(session);
    const err = new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'test');
    session.forceError = err;
    let caught: unknown = null;
    try { await repo.listUnrankedTicketsPage({ glpiGroupId: 10, page: 1, limit: 10 }); } catch (e) { caught = e; }
    assert.equal(caught, err);
  });

  await runTest('14. Response builder con JSON valido e Inmutabilidad', async () => {
    const originalDate = new Date('2023-01-01T00:00:00Z');
    const originalAssignedIdsJson = '[1]';
    const originalAssignedNamesJson = '["A"]';
    const originalTicket = makeOperationalTicket({
      assignedGroupIds: originalAssignedIdsJson,
      assignedGroupNames: originalAssignedNamesJson,
      syncedAt: originalDate
    });

    const coordDate = new Date('2023-02-01T00:00:00Z');
    const originalCoordination = {
      id: 1,
      ticketId: 100,
      progressPercent: 50,
      coordinatorComment: 'test',
      estimatedDeliveryDate: null,
      updatedByUserId: 2,
      updatedAt: coordDate
    };

    const itemsArr = [{
      ticket: originalTicket,
      coordination: originalCoordination
    }];
    const pageData: OperationalUnrankedTicketPage = {
      items: itemsArr,
      total: 1, page: 1, limit: 10
    };

    const res = buildOperationalUnrankedTicketResponse(pageData);

    assert.equal(res.tickets.length, 1);
    assert.deepEqual(res.tickets[0].assignedGroupIds, [1]);
    assert.deepEqual(res.tickets[0].assignedGroupNames, ['A']);
    assert.equal(res.tickets[0].coordination, originalCoordination);
    assert.equal(res.total, 1);
    assert.equal(res.page, 1);
    assert.equal(res.pages, 1);

    // Inmutabilidad
    assert.equal(pageData.items, itemsArr);
    assert.equal(pageData.items[0].ticket, originalTicket);
    assert.equal(pageData.items[0].ticket.assignedGroupIds, originalAssignedIdsJson);
    assert.equal(pageData.items[0].ticket.assignedGroupNames, originalAssignedNamesJson);
    assert.equal(pageData.items[0].ticket.syncedAt, originalDate);
    assert.equal(pageData.items[0].ticket.syncedAt.getTime(), new Date('2023-01-01T00:00:00Z').getTime());

    assert.equal(pageData.items[0].coordination, originalCoordination);
    assert.equal(pageData.items[0].coordination?.id, 1);
    assert.equal(pageData.items[0].coordination?.progressPercent, 50);
    assert.equal(pageData.items[0].coordination?.coordinatorComment, 'test');
    assert.equal(pageData.items[0].coordination?.updatedAt, coordDate);
    assert.equal(pageData.items[0].coordination?.updatedAt.getTime(), new Date('2023-02-01T00:00:00Z').getTime());
  });

  await runTest('15. Response builder JSON malformado y redaccion de sentinelas', async () => {
    const invalidId = '-9999';
    const pageData: OperationalUnrankedTicketPage = {
      items: [{
        ticket: makeOperationalTicket({ assignedGroupIds: `[${invalidId}]` }),
        coordination: null
      }],
      total: 1, page: 1, limit: 10
    };

    let caught: unknown = null;
    try {
      buildOperationalUnrankedTicketResponse(pageData);
    } catch(err) {
      caught = err;
    }
    assert.ok(caught instanceof OperationalTicketDetailError);
    assert.equal(caught.code, 'corrupt_data');
    assert.ok(!caught.message.includes(invalidId));
  });

  await runTest('16. Prueba arquitectonica estatica de la ruta', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const routePath = path.join(process.cwd(), 'app', 'api', 'tickets', 'unranked', 'route.ts');
    const content = await fs.readFile(routePath, 'utf8');

    assert.ok(!content.includes("import { prisma }"), 'Importa prisma');
    assert.ok(!content.includes("prisma."), 'Usa ORM prisma');
    assert.ok(!content.includes("as any"), 'Contiene as any');
    assert.ok(!content.includes("parseInt"), 'Usa parseInt');
    assert.ok(!content.includes("console.error"), 'Usa console.error');
    assert.ok(content.includes("getSharedSqlServerRuntime"), 'No usa runtime factory');
    assert.ok(content.includes("SqlServerOperationalTicketReadRepository"), 'No usa repositorio SQL Server');

    const runtimeCallIdx = content.indexOf('const runtime = getSharedSqlServerRuntime()');
    assert.ok(runtimeCallIdx > -1, 'Llamada al runtime no encontrada');
    const instantiateIdx = content.indexOf('new SqlServerOperationalTicketReadRepository');
    assert.ok(instantiateIdx > -1, 'Llamada al constructor del repo no encontrada');

    const checks = [
      content.indexOf('await getAuthUser()'),
      content.indexOf('!user'),
      content.indexOf("!['admin', 'referente'].includes"),
      content.indexOf('/^[1-9]\\d*$/.test(pageStr)'),
      content.indexOf('/^[1-9]\\d*$/.test(limitStr)'),
      content.indexOf('/^[1-9]\\d*$/.test(sectorGroupIdStr)'),
      content.indexOf('Number.isSafeInteger(glpiGroupId)'),
      content.indexOf('user.sectorGroupIds.includes(glpiGroupId)'),
      content.indexOf('Number.isSafeInteger(offset)')
    ];

    for (const checkIdx of checks) {
      assert.ok(checkIdx > -1, 'Check estatico no encontrado');
      assert.ok(checkIdx < runtimeCallIdx, 'Check ocurre despues de llamada a runtime');
    }

    assert.ok(runtimeCallIdx < instantiateIdx, 'Instancia repo antes de runtime call');
  });
}

void main().then(() => {
  console.log(`\nTests Operational Unranked Tickets: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
