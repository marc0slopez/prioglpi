import assert from 'node:assert/strict';
import { buildOperationalTicketListPlan, validateOperationalTicketIdArray } from '../lib/db/operational/operational-ticket-list-planner';
import { OperationalTicketListPlanError } from '../lib/db/operational/operational-ticket-list-plan-types';
import type { IOperationalTicketListContextRepository } from '../lib/db/operational/operational-ticket-list-context-repository';
import type { IOperationalTicketListFilterRepository } from '../lib/db/operational/operational-ticket-list-filter-repository';
import type { OperationalTicketListQuery } from '../lib/db/operational/operational-ticket-list-types';
import { OperationalTicketListFilterError, type OperationalActivityVisibility } from '../lib/db/operational/operational-ticket-list-filter-types';
import { OperationalTicketListContextError } from '../lib/db/operational/operational-ticket-list-context-types';
import { SqlRuntimeError } from '../lib/db/sqlserver-runtime-contract';

class FakeContextRepo implements IOperationalTicketListContextRepository {
  public referentContext: { userId: number; groupIds: readonly number[] } | null = null;
  public requesterAllowed = true;
  public forceError: Error | null = null;

  public calls = {
    findActiveReferentContext: 0,
    isActiveNonReferentRequesterInGroups: 0
  };

  public lastArgs: {
    findActiveReferentContext: { referentUserId: number };
    isActiveNonReferentRequesterInGroups: { requesterGlpiUserId: number; groupIds: readonly number[] };
  } = {
    findActiveReferentContext: { referentUserId: -1 },
    isActiveNonReferentRequesterInGroups: { requesterGlpiUserId: -1, groupIds: Object.freeze([]) }
  };

  async findActiveReferentContext(referentUserId: number) {
    this.calls.findActiveReferentContext++;
    this.lastArgs.findActiveReferentContext.referentUserId = referentUserId;
    if (this.forceError) throw this.forceError;
    return this.referentContext;
  }

  async isActiveNonReferentRequesterInGroups(requesterGlpiUserId: number, groupIds: readonly number[]) {
    this.calls.isActiveNonReferentRequesterInGroups++;
    this.lastArgs.isActiveNonReferentRequesterInGroups = { requesterGlpiUserId, groupIds };
    if (this.forceError) throw this.forceError;
    return this.requesterAllowed;
  }
}

class FakeFilterRepo implements IOperationalTicketListFilterRepository {
  public history: readonly number[] = [];
  public directTech: readonly number[] = [];
  public canonicalTech: readonly number[] = [];
  public activeGroupTech: readonly number[] = [];
  public requester: readonly number[] = [];
  public followupPrivate: readonly number[] = [];
  public followupPublic: readonly number[] = [];
  public activity: readonly number[] = [];

  public forceError: Error | null = null;

  public calls = {
    history: 0,
    directTech: 0,
    canonicalTech: 0,
    activeGroupTech: 0,
    requester: 0,
    followup: 0,
    activity: 0,
    soporteDycos: 0
  };

  public lastArgs: {
    history: { userId: number };
    directTech: { userId: number };
    canonicalTech: { userId: number | null };
    activeGroupTech: { groupId: number };
    requester: { userId: number };
    followup: { text: string; visibility: OperationalActivityVisibility | '' };
    activity: { text: string; visibility: 'all' | 'public_only' | '' };
  } = {
    history: { userId: -1 },
    directTech: { userId: -1 },
    canonicalTech: { userId: null },
    activeGroupTech: { groupId: -1 },
    requester: { userId: -1 },
    followup: { text: '', visibility: '' },
    activity: { text: '', visibility: '' }
  };

  async listHistoricalRankedTicketIdsByReferent(userId: number) {
    this.calls.history++;
    this.lastArgs.history.userId = userId;
    if (this.forceError) throw this.forceError;
    return this.history;
  }
  async listTicketIdsByDirectTechnician(userId: number) {
    this.calls.directTech++;
    this.lastArgs.directTech.userId = userId;
    if (this.forceError) throw this.forceError;
    return this.directTech;
  }
  async listTicketIdsByCanonicalTechnician(userId: number | null) {
    this.calls.canonicalTech++;
    this.lastArgs.canonicalTech.userId = userId;
    if (this.forceError) throw this.forceError;
    return this.canonicalTech;
  }
  async listTicketIdsAssignedToActiveUsersInGroup(groupId: number) {
    this.calls.activeGroupTech++;
    this.lastArgs.activeGroupTech.groupId = groupId;
    if (this.forceError) throw this.forceError;
    return this.activeGroupTech;
  }
  async listTicketIdsByRequester(userId: number) {
    this.calls.requester++;
    this.lastArgs.requester.userId = userId;
    if (this.forceError) throw this.forceError;
    return this.requester;
  }
  async listTicketIdsByFollowupText(text: string, visibility: OperationalActivityVisibility) {
    this.calls.followup++;
    this.lastArgs.followup = { text, visibility };
    if (this.forceError) throw this.forceError;
    if (visibility === 'private_only') return this.followupPrivate;
    if (visibility === 'public_only') return this.followupPublic;
    throw new Error('Unsupported fake test visibility: ' + visibility);
  }
  async listTicketIdsByActivityText(text: string, visibility: 'all' | 'public_only') {
    this.calls.activity++;
    this.lastArgs.activity = { text, visibility };
    if (this.forceError) throw this.forceError;
    return this.activity;
  }
  async listTicketIdsBySoporteDycosGroup() {
    this.calls.soporteDycos++;
    if (this.forceError) throw this.forceError;
    return Object.freeze([] as number[]);
  }
}

function assertNoRepositoryCalls(ctx: FakeContextRepo, filter: FakeFilterRepo) {
  assert.equal(ctx.calls.findActiveReferentContext, 0);
  assert.equal(ctx.calls.isActiveNonReferentRequesterInGroups, 0);
  assert.equal(filter.calls.history, 0);
  assert.equal(filter.calls.directTech, 0);
  assert.equal(filter.calls.canonicalTech, 0);
  assert.equal(filter.calls.activeGroupTech, 0);
  assert.equal(filter.calls.requester, 0);
  assert.equal(filter.calls.followup, 0);
  assert.equal(filter.calls.activity, 0);
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

function createBaseQuery(): OperationalTicketListQuery {
  return {
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
}

async function main() {
  await runTest('1. Query sin filtros: cero llamadas y plan vacío correcto', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();
    const q = createBaseQuery();

    const res = await buildOperationalTicketListPlan(q, ctx, filter);
    assert.equal(res.status, 'success');
    if (res.status !== 'success') return;

    assertNoRepositoryCalls(ctx, filter);

    assert.equal(res.plan.referent, null);
    assert.equal(res.plan.includeTicketIds, null);
    assert.deepEqual(res.plan.excludeTicketIds, []);
    assert.equal(res.plan.activityTextTicketIds, null);
  });

  await runTest('2. Referente ausente: HTTP 400 y corte temprano de todo filtro y autorizacion', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();
    const q = createBaseQuery();
    q.referentUserId = 999;

    const res = await buildOperationalTicketListPlan(q, ctx, filter);
    assert.equal(res.status, 'error');
    if (res.status === 'error') {
      assert.equal(res.httpStatus, 400);
      assert.equal(res.error, 'Referente no encontrado o inactivo.');
    }

    assert.equal(ctx.calls.findActiveReferentContext, 1);
    assert.equal(ctx.calls.isActiveNonReferentRequesterInGroups, 0);
    assert.equal(filter.calls.history, 0);
    assert.equal(filter.calls.directTech, 0);
    assert.equal(filter.calls.canonicalTech, 0);
    assert.equal(filter.calls.activeGroupTech, 0);
    assert.equal(filter.calls.requester, 0);
    assert.equal(filter.calls.followup, 0);
    assert.equal(filter.calls.activity, 0);
  });

  await runTest('3. Referente abierto sin consulta histórica', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();
    ctx.referentContext = { userId: 999, groupIds: Object.freeze([1, 2]) };
    const q = createBaseQuery();
    q.referentUserId = 999;
    q.view = 'open';
    q.priority = 'ranked';

    const res = await buildOperationalTicketListPlan(q, ctx, filter);
    assert.equal(res.status, 'success');
    if (res.status !== 'success') return;

    assert.equal(filter.calls.history, 0);
    assert.ok(res.plan.referent);
    assert.deepEqual(res.plan.referent?.historicalTicketIds, []);
    assert.equal(ctx.lastArgs.findActiveReferentContext.referentUserId, 999);
  });

  await runTest('4. Matriz completa view/priority para consulta histórica', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();
    ctx.referentContext = { userId: 999, groupIds: Object.freeze([1]) };

    const combinations: readonly {
      view: OperationalTicketListQuery['view'];
      priority: OperationalTicketListQuery['priority'];
      shouldLoadHistory: boolean;
    }[] = [
      { view: 'open', priority: 'ranked', shouldLoadHistory: false },
      { view: 'open', priority: 'unranked', shouldLoadHistory: false },
      { view: 'open', priority: 'all', shouldLoadHistory: false },
      { view: 'history', priority: 'ranked', shouldLoadHistory: true },
      { view: 'history', priority: 'all', shouldLoadHistory: true },
      { view: 'history', priority: 'unranked', shouldLoadHistory: false },
      { view: 'all', priority: 'ranked', shouldLoadHistory: true },
      { view: 'all', priority: 'all', shouldLoadHistory: true },
      { view: 'all', priority: 'unranked', shouldLoadHistory: false },
    ];

    for (const combo of combinations) {
      filter.calls.history = 0;
      const q = createBaseQuery();
      q.referentUserId = 999;
      q.view = combo.view;
      q.priority = combo.priority;
      const res = await buildOperationalTicketListPlan(q, ctx, filter);
      assert.equal(res.status, 'success');
      assert.equal(filter.calls.history, combo.shouldLoadHistory ? 1 : 0, `Failed for view=${combo.view} priority=${combo.priority}`);
    }
  });

  await runTest('5. Técnico específico para roles', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();
    const roles: readonly OperationalTicketListQuery['actor']['role'][] = ['admin', 'coordinador_sistemas', 'referente', 'priorizador'];

    for (const role of roles) {
      filter.calls.canonicalTech = 0;
      filter.calls.directTech = 0;

      const q = createBaseQuery();
      q.actor.role = role;
      q.canSeePrivate = (role === 'admin' || role === 'coordinador_sistemas');
      q.technicianId = 777;

      await buildOperationalTicketListPlan(q, ctx, filter);

      if (role === 'admin' || role === 'coordinador_sistemas') {
        assert.equal(filter.calls.canonicalTech, 1);
        assert.equal(filter.calls.directTech, 0);
        assert.equal(filter.lastArgs.canonicalTech.userId, 777);
      } else {
        assert.equal(filter.calls.canonicalTech, 0);
        assert.equal(filter.calls.directTech, 1);
        assert.equal(filter.lastArgs.directTech.userId, 777);
      }
    }
  });

  await runTest('6. Sin técnico para roles (Exclusiones y include separados)', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();
    const roles: readonly OperationalTicketListQuery['actor']['role'][] = ['admin', 'coordinador_sistemas', 'referente', 'priorizador'];

    for (const role of roles) {
      filter.calls.canonicalTech = 0;
      filter.calls.activeGroupTech = 0;
      filter.canonicalTech = Object.freeze([10]);
      filter.activeGroupTech = Object.freeze([10, 20]);

      const q = createBaseQuery();
      q.actor.role = role;
      q.canSeePrivate = (role === 'admin' || role === 'coordinador_sistemas');
      q.unassignedTechnician = true;
      q.search = 'text'; // search triggers activity Text
      filter.activity = Object.freeze([30]);

      const res = await buildOperationalTicketListPlan(q, ctx, filter);
      assert.equal(res.status, 'success');
      if (res.status !== 'success') return;

      if (role === 'admin' || role === 'coordinador_sistemas') {
        assert.equal(filter.calls.canonicalTech, 1);
        assert.equal(filter.calls.activeGroupTech, 0);
        assert.equal(filter.lastArgs.canonicalTech.userId, null);
        assert.deepEqual(res.plan.includeTicketIds, [10]);
        assert.deepEqual(res.plan.excludeTicketIds, []);
      } else {
        assert.equal(filter.calls.canonicalTech, 0);
        assert.equal(filter.calls.activeGroupTech, 1);
        assert.equal(filter.lastArgs.activeGroupTech.groupId, 30);
        assert.equal(res.plan.includeTicketIds, null);
        assert.deepEqual(res.plan.excludeTicketIds, [10, 20]);
      }
      assert.deepEqual(res.plan.activityTextTicketIds, [30]);

      assert.ok(Object.isFrozen(res.plan.excludeTicketIds));
      assert.ok(Object.isFrozen(res.plan.activityTextTicketIds));
      if (res.plan.includeTicketIds !== null) {
        assert.ok(Object.isFrozen(res.plan.includeTicketIds));
      }
      assert.notEqual(res.plan.excludeTicketIds, filter.activeGroupTech);
      assert.notEqual(res.plan.activityTextTicketIds, filter.activity);
    }
  });

  await runTest('7. Corte temprano completo con referente histórico', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();
    ctx.referentContext = { userId: 999, groupIds: Object.freeze([1, 2]) };
    ctx.requesterAllowed = false;

    const q = createBaseQuery();
    q.referentUserId = 999;
    q.view = 'history';
    q.priority = 'ranked';
    q.actor.role = 'referente';
    q.canSeePrivate = false;
    q.requesterId = 555;
    q.technicianId = 123;
    q.comments = 'bar';
    q.search = 'text';

    const res = await buildOperationalTicketListPlan(q, ctx, filter);
    assert.equal(res.status, 'error');
    if (res.status === 'error') {
      assert.equal(res.httpStatus, 403);
      assert.equal(res.error, 'Solicitante no pertenece a tus sectores.');
    }

    // Validate the order exactly:
    assert.equal(ctx.calls.findActiveReferentContext, 1);
    assert.equal(ctx.calls.isActiveNonReferentRequesterInGroups, 1);
    assert.equal(ctx.lastArgs.isActiveNonReferentRequesterInGroups.requesterGlpiUserId, 555);

    // Nothing past authorization executed
    assert.equal(filter.calls.history, 0);
    assert.equal(filter.calls.directTech, 0);
    assert.equal(filter.calls.canonicalTech, 0);
    assert.equal(filter.calls.activeGroupTech, 0);
    assert.equal(filter.calls.requester, 0);
    assert.equal(filter.calls.followup, 0);
    assert.equal(filter.calls.activity, 0);
  });

  await runTest('8. Requester para otros roles sin validación de grupos', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();

    let q = createBaseQuery();
    q.actor.role = 'admin';
    q.requesterId = 555;
    await buildOperationalTicketListPlan(q, ctx, filter);
    assert.equal(ctx.calls.isActiveNonReferentRequesterInGroups, 0);
    assert.equal(filter.calls.requester, 1);
    assert.equal(filter.lastArgs.requester.userId, 555);

    // Referente allowed (retorna HTTP success, ejecutando el request en filter)
    ctx.calls.isActiveNonReferentRequesterInGroups = 0;
    filter.calls.requester = 0;
    ctx.requesterAllowed = true;
    q = createBaseQuery();
    q.actor.role = 'referente';
    q.canSeePrivate = false;
    q.requesterId = 555;
    await buildOperationalTicketListPlan(q, ctx, filter);
    assert.equal(ctx.calls.isActiveNonReferentRequesterInGroups, 1);
    assert.equal(filter.calls.requester, 1);
  });

  await runTest('9. Notes usa private_only y Comments usa public_only', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();

    let q = createBaseQuery();
    q.notes = 'foo';
    await buildOperationalTicketListPlan(q, ctx, filter);
    assert.equal(filter.calls.followup, 1);
    assert.equal(filter.lastArgs.followup.text, 'foo');
    assert.equal(filter.lastArgs.followup.visibility, 'private_only');

    q = createBaseQuery();
    q.comments = 'bar';
    await buildOperationalTicketListPlan(q, ctx, filter);
    assert.equal(filter.calls.followup, 2);
    assert.equal(filter.lastArgs.followup.text, 'bar');
    assert.equal(filter.lastArgs.followup.visibility, 'public_only');
  });

  await runTest('10. Search para los cuatro roles', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();

    const matrix: readonly { role: OperationalTicketListQuery['actor']['role'], expectedVis: 'all' | 'public_only' }[] = [
      { role: 'admin', expectedVis: 'all' },
      { role: 'coordinador_sistemas', expectedVis: 'all' },
      { role: 'priorizador', expectedVis: 'public_only' },
      { role: 'referente', expectedVis: 'public_only' }
    ];

    for (const item of matrix) {
      filter.calls.activity = 0;
      const q = createBaseQuery();
      q.actor.role = item.role;
      q.canSeePrivate = (item.role === 'admin' || item.role === 'coordinador_sistemas');
      q.search = 'text_' + item.role;

      await buildOperationalTicketListPlan(q, ctx, filter);
      assert.equal(filter.calls.activity, 1);
      assert.equal(filter.lastArgs.activity.text, 'text_' + item.role);
      assert.equal(filter.lastArgs.activity.visibility, item.expectedVis);
    }
  });

  await runTest('11. Intersección real matemática de cuatro conjuntos', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();

    filter.canonicalTech = Object.freeze([1, 5, 10, 15]);
    filter.requester = Object.freeze([5, 10, 15, 20]);
    filter.followupPrivate = Object.freeze([2, 5, 10, 15]);
    filter.followupPublic = Object.freeze([5, 10, 12]);

    const q = createBaseQuery();
    q.actor.role = 'admin';
    q.canSeePrivate = true;
    q.technicianId = 777;
    q.requesterId = 555;
    q.notes = 'foo';
    q.comments = 'bar';

    let res = await buildOperationalTicketListPlan(q, ctx, filter);
    assert.equal(res.status, 'success');
    assert.equal(filter.calls.canonicalTech, 1);
    assert.equal(filter.calls.requester, 1);
    assert.equal(filter.calls.followup, 2);
    assert.equal(filter.calls.activity, 0);
    if (res.status === 'success') {
      // Intersection: [1,5,10,15], [5,10,15,20], [2,5,10,15], [5,10,12] = [5,10]
      assert.deepEqual(res.plan.includeTicketIds, [5, 10]);
    }

    // Subcaso: uno vacío revienta el cruce
    filter.followupPublic = Object.freeze([]);
    res = await buildOperationalTicketListPlan(q, ctx, filter);
    assert.equal(res.status, 'success');
    if (res.status === 'success') {
      assert.deepEqual(res.plan.includeTicketIds, []);
    }
  });

  await runTest('12. Validacion defensiva: Uso puro de validateOperationalTicketIdArray con arrays corruptos', async () => {
    const badArrays: unknown[] = [
      null,
      undefined,
      {},
      [1, '2'],
      [1, 1], // dup
      [2, 1], // unordered
      [-1], // neg
      [2147483648], // overflow
      [NaN],
      [Infinity]
    ];

    for (const bad of badArrays) {
      let caught = false;
      try {
        validateOperationalTicketIdArray(bad);
      } catch (err) {
        if (err instanceof OperationalTicketListPlanError && err.code === 'corrupt_data') {
          caught = true;
        }
      }
      assert.ok(caught, `Fallo en atrapar: ${JSON.stringify(bad)}`);
    }
  });

  await runTest('13. Propagación por identidad de OperationalTicketListFilterError y SqlRuntimeError', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();
    const q = createBaseQuery();
    q.technicianId = 123;

    const errSql = new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'boom');
    filter.forceError = errSql;
    let caughtSql: unknown = null;
    try {
      await buildOperationalTicketListPlan(q, ctx, filter);
    } catch (e) {
      caughtSql = e;
    }
    assert.equal(caughtSql, errSql);

    const errFilter = new OperationalTicketListFilterError('corrupt_data', 'boom');
    filter.forceError = errFilter;
    let caughtFilter: unknown = null;
    try {
      await buildOperationalTicketListPlan(q, ctx, filter);
    } catch (e) {
      caughtFilter = e;
    }
    assert.equal(caughtFilter, errFilter);

    const errContext = new OperationalTicketListContextError('corrupt_data', 'boom');
    filter.forceError = null;
    q.referentUserId = 999;
    ctx.forceError = errContext;
    let caughtContext: unknown = null;
    try {
      await buildOperationalTicketListPlan(q, ctx, filter);
    } catch (e) {
      caughtContext = e;
    }
    assert.equal(caughtContext, errContext);
  });

  await runTest('14. Validaciones puras pre-queries verificando 0 calls', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();

    // Contradictorio: techID y unassigned simultaneos
    let q = createBaseQuery();
    q.technicianId = 123;
    q.unassignedTechnician = true;
    let caught = false;
    try {
      await buildOperationalTicketListPlan(q, ctx, filter);
    } catch (err) {
      if (err instanceof OperationalTicketListPlanError && err.code === 'corrupt_data') caught = true;
    }
    assert.ok(caught);
    assertNoRepositoryCalls(ctx, filter);

    // canSeePrivate falso para un admin
    q = createBaseQuery();
    q.actor.role = 'admin';
    q.canSeePrivate = false;
    caught = false;
    try {
      await buildOperationalTicketListPlan(q, ctx, filter);
    } catch (err) {
      if (err instanceof OperationalTicketListPlanError && err.code === 'corrupt_data') caught = true;
    }
    assert.ok(caught);
    assertNoRepositoryCalls(ctx, filter);

    // Notes para usuario sin canSeePrivate (ej: priorizador)
    q = createBaseQuery();
    q.actor.role = 'priorizador';
    q.canSeePrivate = false;
    q.notes = 'foo';
    caught = false;
    try {
      await buildOperationalTicketListPlan(q, ctx, filter);
    } catch (err) {
      if (err instanceof OperationalTicketListPlanError && err.code === 'corrupt_data') caught = true;
    }
    assert.ok(caught);
    assertNoRepositoryCalls(ctx, filter);
  });

  await runTest('15. Inmutabilidad profunda completa', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();
    ctx.referentContext = { userId: 999, groupIds: Object.freeze([10, 20]) };
    filter.history = Object.freeze([1, 2]);
    filter.canonicalTech = Object.freeze([10, 11]);
    filter.activity = Object.freeze([100, 200]);

    const q1 = createBaseQuery();
    q1.sector = { type: 'all' };
    q1.referentUserId = 999;
    q1.view = 'history';
    q1.technicianId = 777;
    q1.search = 'text';

    const r1 = await buildOperationalTicketListPlan(q1, ctx, filter);
    assert.equal(r1.status, 'success');
    if (r1.status === 'success') {
      const plan = r1.plan;
      assert.ok(Object.isFrozen(plan));
      assert.ok(Object.isFrozen(plan.query));
      assert.ok(Object.isFrozen(plan.query.actor));
      assert.ok(Object.isFrozen(plan.query.actor.sectorGroupIds));
      assert.ok(Object.isFrozen(plan.query.sector));
      assert.notEqual(plan.query, q1);
      assert.notEqual(plan.query.actor, q1.actor);
      assert.notEqual(plan.query.actor.sectorGroupIds, q1.actor.sectorGroupIds);
      assert.notEqual(plan.query.sector, q1.sector);
      assert.ok(Object.isFrozen(plan.excludeTicketIds));

      assert.ok(plan.referent !== null);
      assert.ok(Object.isFrozen(plan.referent));
      assert.ok(Object.isFrozen(plan.referent.activeGroupIds));
      assert.ok(Object.isFrozen(plan.referent.historicalTicketIds));
      const referentContext = ctx.referentContext;
      assert.ok(referentContext !== null);
      assert.notEqual(plan.referent.activeGroupIds, referentContext.groupIds);
      assert.notEqual(plan.referent.historicalTicketIds, filter.history);

      assert.ok(plan.includeTicketIds !== null);
      assert.ok(Object.isFrozen(plan.includeTicketIds));
      assert.notEqual(plan.includeTicketIds, filter.canonicalTech);

      assert.ok(plan.activityTextTicketIds !== null);
      assert.ok(Object.isFrozen(plan.activityTextTicketIds));
      assert.notEqual(plan.activityTextTicketIds, filter.activity);
    }

    const q2 = createBaseQuery();
    q2.sector = { type: 'group_id', id: 50 };
    const r2 = await buildOperationalTicketListPlan(q2, ctx, filter);
    assert.equal(r2.status, 'success');
    if (r2.status === 'success') {
      const sector2 = r2.plan.query.sector;
      assert.ok(Object.isFrozen(sector2));
      if (sector2.type === 'group_id') {
        assert.equal(sector2.id, 50);
      } else {
        assert.fail('Expected group_id');
      }
    }

    const q3 = createBaseQuery();
    q3.sector = { type: 'name', name: 'Soporte' };
    const r3 = await buildOperationalTicketListPlan(q3, ctx, filter);
    assert.equal(r3.status, 'success');
    if (r3.status === 'success') {
      const sector3 = r3.plan.query.sector;
      assert.ok(Object.isFrozen(sector3));
      if (sector3.type === 'name') {
        assert.equal(sector3.name, 'Soporte');
      } else {
        assert.fail('Expected name');
      }
    }
  });

  await runTest('16. Validacion defensiva: userId del referente discordante lanza corrupt_data', async () => {
    const ctx = new FakeContextRepo();
    const filter = new FakeFilterRepo();
    const q = createBaseQuery();
    q.referentUserId = 100;

    ctx.referentContext = { userId: 200, groupIds: [1] }; // mismatch

    let caught = false;
    try {
      await buildOperationalTicketListPlan(q, ctx, filter);
    } catch (err) {
      if (err instanceof OperationalTicketListPlanError && err.code === 'corrupt_data') {
        caught = true;
      }
    }
    assert.ok(caught);
  });
}

void main().then(() => {
  console.log(`\nTests Operational Ticket List Planner: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
