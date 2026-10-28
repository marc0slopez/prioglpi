import assert from 'node:assert/strict';
import {
  buildOperationalTicketListCountProgram,
  buildOperationalTicketListPageStatement
} from '../lib/db/operational/operational-ticket-list-sql-builder';
import { OperationalTicketListSqlError } from '../lib/db/operational/operational-ticket-list-sql-types';
import type { OperationalTicketListExecutionPlan } from '../lib/db/operational/operational-ticket-list-plan-types';
import type { OperationalTicketListQuery } from '../lib/db/operational/operational-ticket-list-types';
function createBasePlan(): OperationalTicketListExecutionPlan {
  const query: OperationalTicketListQuery = {
    actor: {
      role: 'admin',
      sectorGroupIds: Object.freeze([30])
    },
    view: 'open',
    priority: 'ranked',
    page: 1,
    limit: 50,
    offset: 0,
    status: null,
    referentUserId: null,
    ticketId: null,
    technicianId: null,
    requesterId: null,
    categoryId: null,
    entityId: null,
    locationId: null,
    type: null,
    glpiPriority: null,
    sectorGroupId: null,
    sector: { type: 'all' },
    from: null,
    to: null,
    toExclusive: null,
    updatedFrom: null,
    updatedTo: null,
    search: null,
    title: null,
    description: null,
    notes: null,
    comments: null,
    isActiveRanking: false,
    isUnranked: false,
    hasTPR: false,
    tprVencida: false,
    unassignedTechnician: false,
    soporteDycosFilter: false,
    canSeePrivate: true,
    isDrillDown: false
  };
  return {
    query,
    referent: null,
    includeTicketIds: null,
    excludeTicketIds: [],
    activityTextTicketIds: null
  };
}

let passed = 0;
let failed = 0;
let total = 0;

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

async function main() {
  await runTest('1. Conteos según priority (ranked/unranked/all)', () => {
    const plan = createBasePlan();
    plan.query.priority = 'ranked';
    let p = buildOperationalTicketListCountProgram(plan, '2026-08-01');
    assert.ok(p.rankedCount !== null);
    assert.equal(p.unrankedCount, null);
    plan.query.priority = 'unranked';
    p = buildOperationalTicketListCountProgram(plan, '2026-08-01');
    assert.equal(p.rankedCount, null);
    assert.ok(p.unrankedCount !== null);
    plan.query.priority = 'all';
    p = buildOperationalTicketListCountProgram(plan, '2026-08-01');
    assert.ok(p.rankedCount !== null);
    assert.ok(p.unrankedCount !== null);
  });

  await runTest('2. Scope admin (sin is_sistemas_scope = 1)', () => {
    const plan = createBasePlan();
    plan.query.actor.role = 'admin';
    const stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(!stmt.sql.includes('t.[is_sistemas_scope] = 1'));
    assert.ok(stmt.sql.includes('t.[is_sistemas_scope]'));
  });

  await runTest('3. Scope coordinador y fechas legacy (con is_sistemas_scope)', () => {
    const plan = createBasePlan();
    plan.query.actor.role = 'coordinador_sistemas';
    plan.query.from = '2026-08-01T00:00:00.000Z';
    const stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('t.[is_sistemas_scope] = 1'));
    assert.ok(stmt.sql.includes('t.[status] IN (1,2,3,4) AND t.[opened_at] >= @'));
    assert.ok(stmt.sql.includes('t.[status] = 5 AND t.[solved_at] >= @'));
    assert.ok(stmt.sql.includes('t.[status] = 6 AND t.[closed_at] >= @'));
  });

  await runTest('4. Scope priorizador/referente con grupos vacíos (1 = 0)', () => {
    const plan = createBasePlan();
    plan.query.actor.role = 'referente';
    plan.query.canSeePrivate = false;
    plan.query.actor.sectorGroupIds = [];
    const stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('1 = 0'));
  });

  await runTest('5. Precedencia sectorGroupId sobre sector', () => {
    const plan = createBasePlan();
    plan.query.sectorGroupId = 99;
    plan.query.sector = { type: 'name', name: 'Ignorado' };
    const stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('t.[detected_sector_group_id] = @'));
    assert.equal(stmt.params.filter(p => p.value === 99).length, 1);
    assert.equal(stmt.params.filter(p => p.value === 'Ignorado').length, 0);
  });

  await runTest('6. Filtros escalares exactos (reales)', () => {
    const plan = createBasePlan();
    plan.query.ticketId = 1000;
    plan.query.categoryId = 5;
    plan.query.entityId = 1;
    plan.query.locationId = 2;
    plan.query.type = 1;
    plan.query.glpiPriority = 3;
    const stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('t.[ticket_id] = @'));
    assert.ok(stmt.sql.includes('t.[category_id] = @'));
    assert.ok(stmt.sql.includes('t.[entity_id] = @'));
    assert.ok(stmt.sql.includes('t.[location_id] = @'));
    assert.ok(stmt.sql.includes('t.[type] = @'));
    assert.ok(stmt.sql.includes('t.[glpi_priority] = @'));
  });

  await runTest('7. View states: open, history, all', () => {
    const plan = createBasePlan();
    plan.query.priority = 'unranked';
    plan.query.view = 'open';
    let stmt = buildOperationalTicketListPageStatement(plan, 'unranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('t.[status] IN (1,2,3,4)'));
    plan.query.view = 'history';
    stmt = buildOperationalTicketListPageStatement(plan, 'unranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('t.[status] IN (5,6)'));
    plan.query.view = 'all';
    stmt = buildOperationalTicketListPageStatement(plan, 'unranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('t.[status] IN (1,2,3,4)'));
    assert.ok(stmt.sql.includes('t.[status] IN (5,6)'));
    const whereMatch = stmt.sql.match(/WHERE(.*)ORDER BY/s);
    assert.ok(whereMatch);
    assert.ok(!whereMatch[1].includes('t.[status] IN (1,2,3,4,5,6)'));
  });

  await runTest('8. Drill-down full logic con [ticket_ranking] y [ticket_coordination]', () => {
    const plan = createBasePlan();
    plan.query.isDrillDown = true;
    plan.query.status = 3;
    plan.query.isActiveRanking = true;
    plan.query.hasTPR = true;
    plan.query.tprVencida = true;
    const stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('t.[status] = @'));
    assert.ok(stmt.sql.includes('[prioglpi].[ticket_ranking] r WHERE r.[ticket_id] = t.[ticket_id] AND r.[is_active] = 1'));
    assert.ok(stmt.sql.includes('[prioglpi].[ticket_coordination] c WHERE c.[ticket_id] = t.[ticket_id] AND c.[estimated_delivery_date] IS NOT NULL'));
    assert.ok(stmt.sql.includes('c.[estimated_delivery_date] < @'));
  });

  await runTest('9. Referente matrix (9 combinaciones)', () => {
    const plan = createBasePlan();
    plan.query.referentUserId = 5;
    plan.referent = {
      userId: 5,
      activeGroupIds: [10],
      historicalTicketIds: [100, 200]
    };
    plan.query.priority = 'ranked';
    plan.query.view = 'open';
    let stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('val = t.[detected_sector_group_id]'));
    assert.ok(!stmt.sql.includes('val = t.[ticket_id]'));
    plan.query.view = 'history';
    stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('val = t.[ticket_id]'));
    plan.query.view = 'all';
    stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('val = t.[detected_sector_group_id]'));
    assert.ok(stmt.sql.includes('val = t.[ticket_id]'));
    plan.query.priority = 'unranked';
    plan.query.view = 'open';
    stmt = buildOperationalTicketListPageStatement(plan, 'unranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('val = t.[detected_sector_group_id]'));
    assert.ok(!stmt.sql.includes('val = t.[ticket_id]'));
    plan.query.view = 'history';
    stmt = buildOperationalTicketListPageStatement(plan, 'unranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('val = t.[detected_sector_group_id]'));
    assert.ok(!stmt.sql.includes('val = t.[ticket_id]'));
    plan.query.view = 'all';
    stmt = buildOperationalTicketListPageStatement(plan, 'unranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('val = t.[detected_sector_group_id]'));
    assert.ok(!stmt.sql.includes('val = t.[ticket_id]'));
    plan.query.priority = 'all';
    plan.query.view = 'open';
    stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('val = t.[detected_sector_group_id]'));
    assert.ok(!stmt.sql.includes('val = t.[ticket_id]'));
    plan.query.view = 'history';
    stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('val = t.[ticket_id]'));
    plan.query.view = 'all';
    stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('val = t.[detected_sector_group_id]'));
    assert.ok(stmt.sql.includes('val = t.[ticket_id]'));
  });

  await runTest('10. Ranked APPLY filtra mismo estado y autor (sin EXISTS global de active)', () => {
    const plan = createBasePlan();
    plan.query.referentUserId = 7;
    plan.referent = { userId: 7, activeGroupIds: [1], historicalTicketIds: [9] };
    plan.query.view = 'history';
    const stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    const applyMatch = stmt.sql.match(/OUTER APPLY \((.*?)\) r/s);
    assert.ok(applyMatch, 'Debe contener OUTER APPLY');
    const applyBody = applyMatch[1];
    assert.ok(applyBody.includes('r.[is_active] = 0'), 'El apply debe filtrar is_active = 0 para history');
    assert.ok(applyBody.includes('r.[updated_by_user_id] = @'), 'El apply debe filtrar el autor histórico');
    assert.ok(!applyBody.includes('EXISTS'));
  });

  await runTest('11. Unranked condition (sin author check)', () => {
    const plan = createBasePlan();
    plan.query.priority = 'unranked';
    plan.query.referentUserId = 8;
    plan.referent = { userId: 8, activeGroupIds: [5], historicalTicketIds: [10] };
    plan.query.view = 'history';
    const stmt = buildOperationalTicketListPageStatement(plan, 'unranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('NOT EXISTS (SELECT 1 FROM [prioglpi].[ticket_ranking] r'));
    assert.ok(stmt.sql.includes('r.[is_active] = 0'));
    assert.ok(stmt.sql.includes('val = t.[detected_sector_group_id]'));
    assert.ok(!stmt.sql.includes('val = t.[ticket_id]'));
  });

  await runTest('12. Include arrays', () => {
    const plan = createBasePlan();
    plan.includeTicketIds = null;
    let stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.match(/OPENJSON/g) === null || stmt.sql.match(/OPENJSON/g)?.length === 1);
    plan.includeTicketIds = [];
    stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('1 = 0'));
    plan.includeTicketIds = [5, 6];
    stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('EXISTS (SELECT 1 FROM OPENJSON(@'));
  });

  await runTest('13. Exclude arrays', () => {
    const plan = createBasePlan();
    plan.excludeTicketIds = [];
    let stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(!stmt.sql.includes('NOT EXISTS (SELECT 1 FROM OPENJSON(@'));
    plan.excludeTicketIds = [10, 20];
    stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    assert.ok(stmt.sql.includes('NOT EXISTS (SELECT 1 FROM OPENJSON(@'));
  });

  await runTest('14. Construcción paramétrica exacta (JSON, nvarchar exacto, int, today)', () => {
    const plan = createBasePlan();
    plan.query.search = 'query1000';
    plan.activityTextTicketIds = [50];
    plan.query.updatedFrom = '2026-08-01T00:00:00';
    const stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 100, 200, '2026-08-01');
    const jsonParam = stmt.params.find(p => p.type === 'nvarchar' && p.value === '[50]');
    assert.ok(jsonParam);
    if (jsonParam.type === 'nvarchar') {
      assert.equal(jsonParam.length, 'MAX');
      assert.equal(jsonParam.nullable, false);
      assert.equal(jsonParam.value, '[50]');
    } else {
      assert.fail('Expected nvarchar');
    }
    const searchParam = stmt.params.find(p => p.type === 'nvarchar' && p.value === 'query1000');
    assert.ok(searchParam);
    if (searchParam.type === 'nvarchar') {
      assert.equal(searchParam.length, 2000);
      assert.equal(searchParam.nullable, false);
      assert.equal(searchParam.value, 'query1000');
    } else {
      assert.fail('Expected nvarchar');
    }
    const updatedParam = stmt.params.find(p => p.type === 'nvarchar' && p.value === '2026-08-01T00:00:00');
    assert.ok(updatedParam);
    if (updatedParam.type === 'nvarchar') {
      assert.equal(updatedParam.length, 50);
      assert.equal(updatedParam.nullable, false);
      assert.equal(updatedParam.value, '2026-08-01T00:00:00');
    } else {
      assert.fail('Expected nvarchar');
    }
    const offsetParam = stmt.params.find(p => p.type === 'int' && p.value === 100);
    assert.ok(offsetParam);
    if (offsetParam.type === 'int') {
      assert.equal(offsetParam.nullable, false);
      assert.equal(offsetParam.value, 100);
    } else {
      assert.fail('Expected int');
    }
    const limitParam = stmt.params.find(p => p.type === 'int' && p.value === 200);
    assert.ok(limitParam);
    if (limitParam.type === 'int') {
      assert.equal(limitParam.nullable, false);
      assert.equal(limitParam.value, 200);
    } else {
      assert.fail('Expected int');
    }

    const plan2 = createBasePlan();
    plan2.query.isDrillDown = true;
    plan2.query.tprVencida = true;
    const stmt2 = buildOperationalTicketListPageStatement(plan2, 'ranked', 0, 50, '2026-08-01');
    const todayParams = stmt2.params.filter(p => p.type === 'nvarchar' && p.value === '2026-08-01');
    assert.equal(todayParams.length, 1);
    const todayParam = todayParams[0];
    assert.ok(todayParam !== undefined);
    if (todayParam.type === 'nvarchar') {
      assert.equal(todayParam.length, 10);
      assert.equal(todayParam.nullable, false);
      assert.equal(todayParam.value, '2026-08-01');
    } else {
      assert.fail('Expected nvarchar');
    }
  });

  await runTest('15. Escape LIKE, controles y 1000 char limit', () => {
    const plan = createBasePlan();
    plan.query.title = 'a%b_c[d~e';
    const stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    const param = stmt.params.find(p => p.type === 'nvarchar' && typeof p.value === 'string' && p.value.includes('~%'));
    assert.ok(param);
    assert.equal(param.value, 'a~%b~_c~[d~~e');
    plan.query.title = 'x'.repeat(1001);
    assert.throws(() => buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01'), OperationalTicketListSqlError);
    plan.query.title = 'abc\x00def';
    assert.throws(() => buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01'), OperationalTicketListSqlError);
  });

  await runTest('16. Fechas reales explícitas y Paginación/Branch validations', () => {
    const plan = createBasePlan();
    assert.throws(() => buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01T'), OperationalTicketListSqlError);
    assert.throws(() => buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-13-01'), OperationalTicketListSqlError);
    assert.throws(() => buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-02-30'), OperationalTicketListSqlError);
    assert.doesNotThrow(() => buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-02-28'));

    const checkErr = (fn: () => void, expectedCode: string) => {
      try {
        fn();
        assert.fail('Should have thrown');
      } catch (err: unknown) {
        if (err instanceof OperationalTicketListSqlError) {
          assert.equal(err.code, expectedCode);
        } else {
          assert.fail('Unexpected error type');
        }
      }
    };
    checkErr(() => buildOperationalTicketListPageStatement(plan, 'ranked', -1, 50, '2026-08-01'), 'invalid_pagination');
    checkErr(() => buildOperationalTicketListPageStatement(plan, 'ranked', 2147483648, 50, '2026-08-01'), 'invalid_pagination');
    checkErr(() => buildOperationalTicketListPageStatement(plan, 'ranked', 0, 0, '2026-08-01'), 'invalid_pagination');
    checkErr(() => buildOperationalTicketListPageStatement(plan, 'ranked', 0, 201, '2026-08-01'), 'invalid_pagination');
    checkErr(() => buildOperationalTicketListPageStatement(plan, 'unranked', 0, 50, '2026-08-01'), 'unsupported_branch');

    plan.query.page = 2;
    plan.query.limit = 50;
    plan.query.offset = 0;
    checkErr(() => buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01'), 'invalid_plan');
  });

  await runTest('17. Inventario literal, aliases de corchetes, cero wilds, tipos estrictos', () => {
    const plan = createBasePlan();
    const stmt = buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    const sql = stmt.sql;
    assert.ok(sql.includes('[prioglpi].[glpi_ticket_cache] t'));
    assert.ok(sql.includes('[prioglpi].[ticket_ranking] r'));
    assert.ok(sql.includes('[prioglpi].[ticket_coordination] c'));
    assert.ok(!sql.includes('glpi_ticket_ranking'));
    assert.ok(!sql.includes('glpi_ticket_ranking_coordination'));
    const tCols = [
      't.[ticket_id]', 't.[title]', 't.[content_plain]', 't.[status]', 't.[status_label]',
      't.[type]', 't.[type_label]', 't.[priority]', 't.[priority_label]',
      't.[opened_at]', 't.[updated_at_glpi]', 't.[solved_at]', 't.[closed_at]',
      't.[requester_name]', 't.[requester_group]', 't.[assigned_technician]',
      't.[assigned_group_ids]', 't.[assigned_group_names]', 't.[detected_sector]',
      't.[is_sistemas_scope]', 't.[is_tecnologia_scope]', 't.[web_url]', 't.[synced_at]',
      't.[requester_user_id]', 't.[requester_group_id]', 't.[detected_sector_group_id]',
      't.[detected_sector_name]', 't.[sector_source]', 't.[category_id]', 't.[entity_id]',
      't.[location_id]', 't.[request_type_id]', 't.[urgency]', 't.[impact]', 't.[glpi_priority]'
    ];
    for (const c of tCols) {
      assert.ok(sql.includes(c), `Falta ${c}`);
    }
    const rCols = [
      'r.[id] AS [ranking_id]', 'r.[ticket_id] AS [ranking_ticket_id]',
      'r.[sector_name] AS [ranking_sector_name]', 'r.[glpi_group_id] AS [ranking_glpi_group_id]',
      'r.[rank_position] AS [ranking_rank_position]', 'r.[created_by_user_id] AS [ranking_created_by_user_id]',
      'r.[updated_by_user_id] AS [ranking_updated_by_user_id]', 'r.[created_at] AS [ranking_created_at]',
      'r.[updated_at] AS [ranking_updated_at]', 'r.[is_active] AS [ranking_is_active]'
    ];
    for (const c of rCols) {
      assert.ok(sql.includes(c), `Falta ${c}`);
    }
    const cCols = [
      'c.[id] AS [coordination_id]', 'c.[ticket_id] AS [coordination_ticket_id]',
      'c.[progress_percent] AS [coordination_progress_percent]', 'c.[coordinator_comment] AS [coordination_comment]',
      'c.[estimated_delivery_date] AS [coordination_estimated_delivery_date]', 'c.[updated_by_user_id] AS [coordination_updated_by_user_id]',
      'c.[updated_at] AS [coordination_updated_at]'
    ];
    for (const c of cCols) {
      assert.ok(sql.includes(c), `Falta ${c}`);
    }
    assert.ok(!sql.includes('r.[id AS'));
    assert.ok(!sql.includes('c.[id AS'));
    assert.ok(!sql.includes('r.*'));
    assert.ok(!sql.includes('c.*'));
    assert.ok(!sql.includes('SELECT *'));
  });

  await runTest('18. Validaciones Coherencia, Determinismo, Inmutabilidad y Sentinelas', () => {
    const plan = createBasePlan();
    plan.excludeTicketIds = [10, 5, 10];
    assert.throws(() => {
      buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01');
    }, OperationalTicketListSqlError, 'Debe rechazar array inválido');

    const checkErr = (fn: () => void, expectedCode: string) => {
      try {
        fn();
        assert.fail('Should have thrown');
      } catch (err: unknown) {
        if (err instanceof OperationalTicketListSqlError) {
          assert.equal(err.code, expectedCode);
        } else {
          assert.fail('Unexpected error type');
        }
      }
    };

    plan.excludeTicketIds = [];
    plan.query.search = null;
    plan.activityTextTicketIds = [];
    checkErr(() => buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01'), 'invalid_plan');

    plan.query.search = 'query1000';
    plan.activityTextTicketIds = null;
    checkErr(() => buildOperationalTicketListPageStatement(plan, 'ranked', 0, 50, '2026-08-01'), 'invalid_plan');

    const planV = createBasePlan();
    planV.query.actor.role = 'referente';
    planV.query.canSeePrivate = false;
    planV.query.actor.sectorGroupIds = [30, 10];
    const sentinel = 'SECRETSENTINEL987654321';
    planV.query.search = sentinel;
    planV.activityTextTicketIds = [];
    planV.query.priority = 'all';

    const countProgram = buildOperationalTicketListCountProgram(planV, '2026-08-01');
    const stmt1 = buildOperationalTicketListPageStatement(planV, 'ranked', 0, 50, '2026-08-01');
    const stmt2 = buildOperationalTicketListPageStatement(planV, 'ranked', 0, 50, '2026-08-01');

    assert.equal(planV.query.actor.sectorGroupIds[0], 30);
    assert.equal(planV.query.actor.sectorGroupIds[1], 10);
    const jsonParam = stmt1.params.find(p => typeof p.value === 'string' && p.value === '[10,30]');
    assert.ok(jsonParam);

    assert.equal(stmt1.sql, stmt2.sql);
    assert.deepEqual(stmt1.params, stmt2.params);
    assert.ok(stmt1.params !== stmt2.params);

    assert.ok(Object.isFrozen(stmt1));
    assert.ok(Object.isFrozen(stmt1.params));
    stmt1.params.forEach(p => assert.ok(Object.isFrozen(p)));

    assert.ok(Object.isFrozen(countProgram));
    const rankedCount = countProgram.rankedCount;
    const unrankedCount = countProgram.unrankedCount;
    assert.ok(rankedCount !== null);
    assert.ok(unrankedCount !== null);

    assert.ok(Object.isFrozen(rankedCount));
    assert.ok(Object.isFrozen(rankedCount.params));
    rankedCount.params.forEach(p => assert.ok(Object.isFrozen(p)));

    assert.ok(Object.isFrozen(unrankedCount));
    assert.ok(Object.isFrozen(unrankedCount.params));
    unrankedCount.params.forEach(p => assert.ok(Object.isFrozen(p)));

    assert.ok(!stmt1.sql.includes(sentinel));
    const sentinelParams = stmt1.params.filter(p => p.value === sentinel);
    assert.equal(sentinelParams.length, 1);
  });
}

void main().then(() => {
  console.log(`\nTests Operational Ticket List SQL Builder: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
