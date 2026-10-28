import assert from 'node:assert/strict';
import { buildOperationalTicketDetail, OperationalTicketDetailError } from '../lib/db/operational/operational-ticket-detail';
import type { OperationalTicket, OperationalTicketRanking, OperationalTicketCoordination, OperationalFollowup, OperationalTask } from '../lib/db/operational/operational-ticket-types';

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

function makeTicket(overrides?: Partial<OperationalTicket>): OperationalTicket {
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
    detectedSectorGroupId: null,
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

function makeRanking(): OperationalTicketRanking {
  return {
    id: 1,
    ticketId: 100,
    sectorName: 's1',
    glpiGroupId: 10,
    rankPosition: 1,
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    isActive: true
  };
}

function makeCoordination(): OperationalTicketCoordination {
  return {
    id: 1,
    ticketId: 100,
    progressPercent: 50,
    coordinatorComment: 'test',
    estimatedDeliveryDate: null,
    updatedByUserId: 1,
    updatedAt: new Date()
  };
}

function makeFollowup(isPrivate = false): OperationalFollowup {
  return {
    followupId: 1,
    ticketId: 100,
    author: null,
    contentPlain: 'f',
    isPrivate,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function makeTask(isPrivate = false): OperationalTask {
  return {
    taskId: 1,
    ticketId: 100,
    author: null,
    technician: null,
    techGroup: null,
    contentPlain: 't',
    isPrivate,
    state: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

async function assertCorruptData(fn: () => void, forbiddenValues: readonly string[] = []) {
  let caught: OperationalTicketDetailError | null = null;
  try {
    fn();
  } catch (err) {
    if (err instanceof OperationalTicketDetailError) caught = err;
  }
  assert.ok(caught);
  assert.equal(caught.code, 'corrupt_data');
  assert.equal(caught.message.includes('100'), false);
  assert.equal(caught.message.includes('['), false);
  assert.equal(caught.message.includes('{'), false);
  assert.equal(caught.message.includes(']'), false);
  assert.equal(caught.message.includes('}'), false);
  for (const forbidden of forbiddenValues) {
    assert.equal(caught.message.includes(forbidden), false, `Mensaje de error incluye ${forbidden}`);
  }
}

async function main() {
  await runTest('Detalle valido con arrays vacios', async () => {
    const t = makeTicket();
    const res = buildOperationalTicketDetail(t, [], null, [], [], true);
    assert.equal(res.ticketId, 100);
    assert.deepEqual(res.assignedGroupIds, []);
    assert.deepEqual(res.assignedGroupNames, []);
  });

  await runTest('JSON de IDs y nombres valido', async () => {
    const t = makeTicket({
      assignedGroupIds: '[1, 2]',
      assignedGroupNames: '["A", "B"]'
    });
    const res = buildOperationalTicketDetail(t, [], null, [], [], true);
    assert.deepEqual(res.assignedGroupIds, [1, 2]);
    assert.deepEqual(res.assignedGroupNames, ['A', 'B']);
  });

  await runTest('JSON vacio (string vacio)', async () => {
    const t = makeTicket({ assignedGroupIds: '', assignedGroupNames: '' });
    const res = buildOperationalTicketDetail(t, [], null, [], [], true);
    assert.deepEqual(res.assignedGroupIds, []);
    assert.deepEqual(res.assignedGroupNames, []);
  });

  await runTest('JSON invalido (malformado)', async () => {
    const t1 = makeTicket({ assignedGroupIds: '[1,' });
    await assertCorruptData(() => buildOperationalTicketDetail(t1, [], null, [], [], true));

    const t2 = makeTicket({ assignedGroupNames: '{"a"' });
    await assertCorruptData(() => buildOperationalTicketDetail(t2, [], null, [], [], true));
  });

  await runTest('Valor JSON que no sea array', async () => {
    const t1 = makeTicket({ assignedGroupIds: '1' });
    await assertCorruptData(() => buildOperationalTicketDetail(t1, [], null, [], [], true));

    const t2 = makeTicket({ assignedGroupNames: '"A"' });
    await assertCorruptData(() => buildOperationalTicketDetail(t2, [], null, [], [], true));
  });

  await runTest('IDs cero, negativos, decimales, unsafe, fuera de INT o strings', async () => {
    const badIds = ['[0]', '[-1]', '[1.5]', `[${Number.MAX_SAFE_INTEGER + 1}]`, '[2147483648]', '["1"]', '[null]'];
    for (const bad of badIds) {
      const t = makeTicket({ assignedGroupIds: bad });
      await assertCorruptData(() => buildOperationalTicketDetail(t, [], null, [], [], true));
    }
  });

  await runTest('Nombres con elementos no-string', async () => {
    const badNames = ['[1]', '[null]', '[{}]'];
    for (const bad of badNames) {
      const t = makeTicket({ assignedGroupNames: bad });
      await assertCorruptData(() => buildOperationalTicketDetail(t, [], null, [], [], true));
    }
  });

  await runTest('Privacidad para admin/coordinador (canSeePrivate=true)', async () => {
    const t = makeTicket();
    const followups = [makeFollowup(false), makeFollowup(true)];
    const tasks = [makeTask(false), makeTask(true)];
    const res = buildOperationalTicketDetail(t, [], null, followups, tasks, true);
    assert.equal(res.followups.length, 2);
    assert.equal(res.tasks.length, 2);
  });

  await runTest('Privacidad para referente/supervisor (canSeePrivate=false)', async () => {
    const t = makeTicket();
    const followups = [makeFollowup(false), makeFollowup(true)];
    const tasks = [makeTask(false), makeTask(true)];
    const res = buildOperationalTicketDetail(t, [], null, followups, tasks, false);
    assert.equal(res.followups.length, 1);
    assert.equal(res.followups[0].isPrivate, false);
    assert.equal(res.tasks.length, 1);
    assert.equal(res.tasks[0].isPrivate, false);
  });

  await runTest('Rankings y coordinacion preservados', async () => {
    const t = makeTicket();
    const rankings = [makeRanking()];
    const coord = makeCoordination();
    const res = buildOperationalTicketDetail(t, rankings, coord, [], [], true);
    assert.equal(res.rankings.length, 1);
    assert.ok(res.coordination);
    assert.equal(res.coordination.progressPercent, 50);
  });

  await runTest('Inmutabilidad de todas las entradas', async () => {
    const t = makeTicket();
    const rankings = [makeRanking()];
    const coord = makeCoordination();
    const followups = [makeFollowup()];
    const tasks = [makeTask()];

    const tCopy = { ...t };
    const rCopy = [{ ...rankings[0] }];
    const cCopy = { ...coord };
    const fCopy = [{ ...followups[0] }];
    const tsCopy = [{ ...tasks[0] }];

    buildOperationalTicketDetail(t, rankings, coord, followups, tasks, false);

    assert.deepEqual(t, tCopy);
    assert.deepEqual(rankings, rCopy);
    assert.deepEqual(coord, cCopy);
    assert.deepEqual(followups, fCopy);
    assert.deepEqual(tasks, tsCopy);
  });

  await runTest('No exposicion de valores dentro de OperationalTicketDetailError', async () => {
    const t = makeTicket({ assignedGroupIds: '[-999]' });
    await assertCorruptData(() => buildOperationalTicketDetail(t, [], null, [], [], true), ['-999']);
  });

  await runTest('Redaccion independiente de errores y no exposicion de sentinelas', async () => {
    const sentinelId = '-987654321';
    const t1 = makeTicket({ assignedGroupIds: `[${sentinelId}]` });
    await assertCorruptData(
      () => buildOperationalTicketDetail(t1, [], null, [], [], true),
      [sentinelId, 'test title', 'test content', 'req g']
    );

    const sentinelName = 'SECRET_SENTINEL_NAME';
    const t2 = makeTicket({ assignedGroupNames: `["${sentinelName}", 123]` });
    await assertCorruptData(
      () => buildOperationalTicketDetail(t2, [], null, [], [], true),
      [sentinelName, 'test title', 'test content', 'req g']
    );
  });

  await runTest('Prueba arquitectonica estatica de route.ts', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const routePath = path.join(process.cwd(), 'app', 'api', 'tickets', '[id]', 'route.ts');
    const content = await fs.readFile(routePath, 'utf8');

    assert.equal(content.includes("as any"), false, 'Contiene as any');
    assert.equal(content.includes("@/lib/prisma"), false, 'Importa prisma estaticamente');
    assert.equal(content.includes("prisma."), false, 'Contiene prisma. (uso de ORM)');
    assert.equal(content.includes("parseInt"), false, 'Usa parseInt');
    assert.equal(content.includes("console.error"), false, 'Registra el objeto error (console.error)');

    const canAccessCallIdx = content.indexOf('if (!canAccessTicket(user, ticket))');
    assert.ok(canAccessCallIdx !== -1, 'canAccessCallIdx ausente');

    const listActiveIdx = content.indexOf('listActiveRankingsByTicketId');
    const findCoordIdx = content.indexOf('findCoordinationByTicketId');
    const listFollowupsIdx = content.indexOf('listFollowupsByTicketId');
    const listTasksIdx = content.indexOf('listTasksByTicketId');

    assert.ok(listActiveIdx !== -1, 'listActiveRankingsByTicketId ausente');
    assert.ok(findCoordIdx !== -1, 'findCoordinationByTicketId ausente');
    assert.ok(listFollowupsIdx !== -1, 'listFollowupsByTicketId ausente');
    assert.ok(listTasksIdx !== -1, 'listTasksByTicketId ausente');

    assert.ok(canAccessCallIdx < listActiveIdx, 'Consulta rankings antes de canAccessTicket');
    assert.ok(canAccessCallIdx < findCoordIdx, 'Consulta coordination antes de canAccessTicket');
    assert.ok(canAccessCallIdx < listFollowupsIdx, 'Consulta followups antes de canAccessTicket');
    assert.ok(canAccessCallIdx < listTasksIdx, 'Consulta tasks antes de canAccessTicket');
  });
}

void main().then(() => {
  console.log(`\nTests Operational Ticket Detail: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
