import assert from 'node:assert/strict';
import { parseOperationalTicketListQuery } from '../lib/db/operational/operational-ticket-list-query';
import { OPERATIONAL_TICKET_LIST_PARAMS } from '../lib/db/operational/operational-ticket-list-types';
import type { OperationalTicketListActor } from '../lib/db/operational/operational-ticket-list-types';

let passed = 0;
let failed = 0;
let total = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
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

const adminActor: OperationalTicketListActor = { role: 'admin', sectorGroupIds: [10, 20] };
const priorizadorActor: OperationalTicketListActor = { role: 'priorizador', sectorGroupIds: [10, 20] };
const referenteActor: OperationalTicketListActor = { role: 'referente', sectorGroupIds: [10, 20] };
const coordinadorActor: OperationalTicketListActor = { role: 'coordinador_sistemas', sectorGroupIds: [] };

async function main() {
  await runTest('1. defaults', () => {
    const params = new URLSearchParams('');
    const res = parseOperationalTicketListQuery(params, adminActor);
    assert.equal(res.status, 'success');
    if (res.status === 'success') {
      const q = res.query;
      assert.equal(q.page, 1);
      assert.equal(q.limit, 50);
      assert.equal(q.offset, 0);
      assert.equal(q.view, 'open');
      assert.equal(q.priority, 'all');
      assert.equal(q.status, null);
      assert.equal(q.referentUserId, null);
      assert.equal(q.ticketId, null);
      assert.equal(q.technicianId, null);
      assert.equal(q.requesterId, null);
      assert.equal(q.categoryId, null);
      assert.equal(q.entityId, null);
      assert.equal(q.locationId, null);
      assert.equal(q.type, null);
      assert.equal(q.glpiPriority, null);
      assert.equal(q.sectorGroupId, null);
      assert.deepEqual(q.sector, { type: 'all' });
      assert.equal(q.from, null);
      assert.equal(q.search, null);
      assert.equal(q.isActiveRanking, false);
      assert.equal(q.isUnranked, false);
      assert.equal(q.hasTPR, false);
      assert.equal(q.tprVencida, false);
      assert.equal(q.unassignedTechnician, false);
      assert.equal(q.canSeePrivate, true);
      assert.equal(q.isDrillDown, false);
    }
  });

  await runTest('2. los tres views y tres prioridades', () => {
    const views = ['open', 'history', 'all'];
    const priorities = ['ranked', 'unranked', 'all'];

    for (const v of views) {
      const p1 = new URLSearchParams(`view=${v}`);
      const r1 = parseOperationalTicketListQuery(p1, adminActor);
      assert.equal(r1.status, 'success');
      if (r1.status === 'success') assert.equal(r1.query.view, v);
    }

    for (const p of priorities) {
      const p1 = new URLSearchParams(`priority=${p}`);
      const r1 = parseOperationalTicketListQuery(p1, adminActor);
      assert.equal(r1.status, 'success');
      if (r1.status === 'success') assert.equal(r1.query.priority, p);
    }

    const bad = new URLSearchParams('view=invalid');
    const rb = parseOperationalTicketListQuery(bad, adminActor);
    assert.equal(rb.status, 'error');
    if (rb.status === 'error') assert.equal(rb.httpStatus, 400);
  });

  await runTest('3. todos los IDs validos y validacion de literales estrictos', () => {
    const params = new URLSearchParams('status=1&referentUserId=2&ticketId=3&technicianId=4&requesterId=5&categoryId=6&entityId=7&locationId=8&type=9&glpiPriority=10&sectorGroupId=10');
    const res = parseOperationalTicketListQuery(params, adminActor);
    assert.equal(res.status, 'success');

    // Literales validos de cancelacion segun ruta real
    const pValidLiterals = new URLSearchParams('referentUserId=all&technicianId=todos&sector=todos');
    const rValid = parseOperationalTicketListQuery(pValidLiterals, adminActor);
    assert.equal(rValid.status, 'success');
    if (rValid.status === 'success') {
      assert.equal(rValid.query.referentUserId, null);
      assert.equal(rValid.query.technicianId, null);
      assert.deepEqual(rValid.query.sector, { type: 'all' });
    }

    // Literales invalidos (rechazo estricto)
    assert.equal(parseOperationalTicketListQuery(new URLSearchParams('technicianId=all'), adminActor).status, 'error');
    assert.equal(parseOperationalTicketListQuery(new URLSearchParams('status=all'), adminActor).status, 'error');
    assert.equal(parseOperationalTicketListQuery(new URLSearchParams('sectorGroupId=all'), adminActor).status, 'error');
    assert.equal(parseOperationalTicketListQuery(new URLSearchParams('sectorGroupId=todos'), adminActor).status, 'error');
  });

  await runTest('4. cero, negativos, espacios, decimales, exponenciales, unsafe y overflow SQL INT', () => {
    const badNums = ['0', '-1', ' 1', '1 ', '1.5', '1e3', '9007199254740992', '2147483648'];
    for (const bad of badNums) {
      assert.equal(parseOperationalTicketListQuery(new URLSearchParams(`page=${bad}`), adminActor).status, 'error');
      assert.equal(parseOperationalTicketListQuery(new URLSearchParams(`limit=${bad}`), adminActor).status, 'error');
      assert.equal(parseOperationalTicketListQuery(new URLSearchParams(`ticketId=${bad}`), adminActor).status, 'error');
    }
  });

  await runTest('5. limit mayor a 200 normalizado', () => {
    const params = new URLSearchParams('limit=300');
    const res = parseOperationalTicketListQuery(params, adminActor);
    assert.equal(res.status, 'success');
    if (res.status === 'success') {
      assert.equal(res.query.limit, 200);
    }
  });

  await runTest('6. offset overflow', () => {
    const params = new URLSearchParams('page=2147483647&limit=200');
    assert.equal(parseOperationalTicketListQuery(params, adminActor).status, 'error');
  });

  await runTest('7. los cinco booleanos y booleanos invalidos', () => {
    const params = new URLSearchParams('isActiveRanking=true&isUnranked=false&hasTPR=true&tprVencida=false&unassignedTechnician=true');
    const res = parseOperationalTicketListQuery(params, adminActor);
    assert.equal(res.status, 'success');
    if (res.status === 'success') {
      assert.equal(res.query.isActiveRanking, true);
      assert.equal(res.query.isUnranked, false);
      assert.equal(res.query.hasTPR, true);
      assert.equal(res.query.tprVencida, false);
      assert.equal(res.query.unassignedTechnician, true);
    }

    assert.equal(parseOperationalTicketListQuery(new URLSearchParams('hasTPR=1'), adminActor).status, 'error');
    assert.equal(parseOperationalTicketListQuery(new URLSearchParams('hasTPR=True'), adminActor).status, 'error');
  });

  await runTest('8. reglas mutuamente excluyentes', () => {
    assert.equal(parseOperationalTicketListQuery(new URLSearchParams('isActiveRanking=true&isUnranked=true'), adminActor).status, 'error');
    assert.equal(parseOperationalTicketListQuery(new URLSearchParams('technicianId=5&unassignedTechnician=true'), adminActor).status, 'error');
    assert.equal(parseOperationalTicketListQuery(new URLSearchParams('to=2023-01-01&toExclusive=2023-01-01'), adminActor).status, 'error');
  });

  await runTest('9. estados y drill-down', () => {
    const params1 = new URLSearchParams('isActiveRanking=true');
    const r1 = parseOperationalTicketListQuery(params1, adminActor);
    assert.equal(r1.status, 'success');
    if (r1.status === 'success') assert.equal(r1.query.isDrillDown, true);

    const badStatus5 = new URLSearchParams('hasTPR=true&status=5');
    assert.equal(parseOperationalTicketListQuery(badStatus5, adminActor).status, 'error');

    const badStatus6 = new URLSearchParams('isUnranked=true&status=6');
    assert.equal(parseOperationalTicketListQuery(badStatus6, adminActor).status, 'error');
  });

  await runTest('10. fechas validas e invalidas', () => {
    const valid = new URLSearchParams('from=2023-01-01T00:00:00Z&updatedTo=2023-12-31');
    assert.equal(parseOperationalTicketListQuery(valid, adminActor).status, 'success');

    const invalid = new URLSearchParams('from=not-a-date');
    assert.equal(parseOperationalTicketListQuery(invalid, adminActor).status, 'error');
  });

  await runTest('11. authorization de notes', () => {
    const params = new URLSearchParams('notes=test');
    assert.equal(parseOperationalTicketListQuery(params, adminActor).status, 'success');
    assert.equal(parseOperationalTicketListQuery(params, coordinadorActor).status, 'success');

    const rRef = parseOperationalTicketListQuery(params, priorizadorActor);
    assert.equal(rRef.status, 'error');
    if (rRef.status === 'error') assert.equal(rRef.httpStatus, 403);
  });

  await runTest('12. cobertura coordinador de sistemas', () => {
    const p1 = new URLSearchParams('sectorGroupId=99&sector=Sistemas');
    const r1 = parseOperationalTicketListQuery(p1, coordinadorActor);
    assert.equal(r1.status, 'success');
    if (r1.status === 'success') {
      assert.equal(r1.query.canSeePrivate, true);
      assert.equal(r1.query.sectorGroupId, 99);
      // Legado: coordinador normaliza sector=... a 'all'
      assert.deepEqual(r1.query.sector, { type: 'all' });
    }
  });

  await runTest('13. cobertura referente y supervisor', () => {
    for (const act of [priorizadorActor, referenteActor]) {
      const pAllowed = new URLSearchParams('sectorGroupId=10');
      const r1 = parseOperationalTicketListQuery(pAllowed, act);
      assert.equal(r1.status, 'success');
      if (r1.status === 'success') {
        assert.equal(r1.query.canSeePrivate, false);
      }

      const pNotAllowed = new URLSearchParams('sectorGroupId=99');
      const r2 = parseOperationalTicketListQuery(pNotAllowed, act);
      assert.equal(r2.status, 'error');
      if (r2.status === 'error') assert.equal(r2.httpStatus, 403);

      const pSectorId = new URLSearchParams('sector=10');
      assert.equal(parseOperationalTicketListQuery(pSectorId, act).status, 'success');

      const pSectorName = new URLSearchParams('sector=Sistemas');
      const r4 = parseOperationalTicketListQuery(pSectorName, act);
      assert.equal(r4.status, 'error');
      if (r4.status === 'error') assert.equal(r4.httpStatus, 403);

      const pSectorTodos = new URLSearchParams('sector=todos');
      assert.equal(parseOperationalTicketListQuery(pSectorTodos, act).status, 'success');

      // Literal `all` legacy para referente o admin:
      // admin normaliza 'all' a { type: 'name', name: 'all' }
      const r5 = parseOperationalTicketListQuery(new URLSearchParams('sector=all'), adminActor);
      assert.equal(r5.status, 'success');
      if (r5.status === 'success') assert.deepEqual(r5.query.sector, { type: 'name', name: 'all' });

      // referente rechaza 'all' 403 por ser literal de nombre
      const r6 = parseOperationalTicketListQuery(new URLSearchParams('sector=all'), act);
      assert.equal(r6.status, 'error');
      if (r6.status === 'error') assert.equal(r6.httpStatus, 403);
    }
  });

  await runTest('14. actor con grupo invalido o duplicado', () => {
    const params = new URLSearchParams('');
    const invalidActor1: OperationalTicketListActor = { role: 'admin', sectorGroupIds: [0] };
    const invalidActor2: OperationalTicketListActor = { role: 'admin', sectorGroupIds: [10, 10] };
    assert.equal(parseOperationalTicketListQuery(params, invalidActor1).status, 'error');
    assert.equal(parseOperationalTicketListQuery(params, invalidActor2).status, 'error');
  });

  await runTest('15. strings vacios normalizados', () => {
    const params = new URLSearchParams('title=&description=&search=a');
    const res = parseOperationalTicketListQuery(params, adminActor);
    assert.equal(res.status, 'success');
    if (res.status === 'success') {
      assert.equal(res.query.title, null);
      assert.equal(res.query.description, null);
      assert.equal(res.query.search, 'a');
    }
  });

  await runTest('16. inmutabilidad', () => {
    const params = new URLSearchParams('page=2');
    const actorGroups = [10, 20];
    const actor: OperationalTicketListActor = { role: 'admin', sectorGroupIds: actorGroups };

    const res = parseOperationalTicketListQuery(params, actor);
    assert.equal(res.status, 'success');
    if (res.status === 'success') {
      assert.equal(actorGroups.length, 2);
      assert.equal(actor.sectorGroupIds, actorGroups);
      assert.equal(params.get('page'), '2');
      assert.notEqual(res.query.actor.sectorGroupIds, actorGroups);
      assert.deepEqual(res.query.actor.sectorGroupIds, actorGroups);
      assert.ok(Object.isFrozen(res.query.actor.sectorGroupIds));
    }
  });

  await runTest('17. estados HTTP y omision de sentinelas', () => {
    const sentinel = '-987654321';

    // Sintactico invalido
    const params = new URLSearchParams(`page=${sentinel}`);
    const res = parseOperationalTicketListQuery(params, adminActor);
    assert.equal(res.status, 'error');
    if (res.status === 'error') {
      assert.equal(res.httpStatus, 400);
      assert.ok(!res.error.includes(sentinel));
    }

    // Acceso denegado
    const rRef = parseOperationalTicketListQuery(new URLSearchParams('sectorGroupId=9999999'), priorizadorActor);
    assert.equal(rRef.status, 'error');
    if (rRef.status === 'error') {
      assert.equal(rRef.httpStatus, 403);
      assert.ok(!rRef.error.includes('9999999'));
    }
  });

  await runTest('18. inventario estatico de 31 searchParams y arquitectura de la ruta', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const routePath = path.join(process.cwd(), 'app', 'api', 'tickets', 'route.ts');

    const EXPECTED_31 = [
      'categoryId', 'comments', 'description', 'entityId', 'from', 'glpiPriority', 'hasTPR',
      'isActiveRanking', 'isUnranked', 'limit', 'locationId', 'notes', 'page', 'priority',
      'referentUserId', 'requesterId', 'search', 'sector', 'sectorGroupId', 'status', 'technicianId',
      'ticketId', 'title', 'to', 'toExclusive', 'tprVencida', 'type', 'unassignedTechnician',
      'updatedFrom', 'updatedTo', 'view'
    ].sort();

    const actualConstants = [...OPERATIONAL_TICKET_LIST_PARAMS].sort();
    assert.equal(EXPECTED_31.length, 31);
    assert.equal(actualConstants.length, 31);
    assert.deepEqual(EXPECTED_31, actualConstants);

    const content = await fs.readFile(routePath, 'utf8');

    assert.ok(content.includes('import { parseOperationalTicketListQuery }'));
    assert.ok(content.includes('parseOperationalTicketListQuery(searchParams'));
    assert.ok(!content.includes('searchParams.get('));
    assert.ok(!content.includes('parseInt('));
  });
}

void main().then(() => {
  console.log(`\nTests Operational Ticket List Query: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
