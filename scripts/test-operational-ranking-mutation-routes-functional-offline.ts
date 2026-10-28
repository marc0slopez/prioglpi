import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

process.env.JWT_SECRET = '12345678901234567890123456789012';
let passed = 0, failed = 0, total = 0;
async function runTest(name: string, fn: () => void | Promise<void>) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] ${name}: ${message}`);
  }
}

async function main() {
  let simulatedUser: any = null;
  let lastServiceInput: any = null;
  let simulatedError: any = null;

  const mockDeps = {
    getAuthUser: async () => simulatedUser,
    getSharedSqlServerRuntime: () => ({}),
    patchOperationalRanking: async (rt: any, actor: any, input: any) => {
      if (simulatedError) throw simulatedError;
      lastServiceInput = input;
      return { changed: true, newOrder: [] };
    },
    deleteOperationalRanking: async (rt: any, actor: any, input: any) => {
      if (simulatedError) throw simulatedError;
      lastServiceInput = input;
      return { changed: true, newOrder: [] };
    },
    reorderOperationalRankings: async (rt: any, actor: any, input: any) => {
      if (simulatedError) throw simulatedError;
      lastServiceInput = input;
      return { changed: true, newOrder: [] };
    },
    logError: () => {}
  };

  const { makeTicketIdHandlers } = await import('../app/api/rankings/[ticketId]/handlers');
  const { makeReorderHandlers } = await import('../app/api/rankings/reorder/handlers');
  const { OperationalRankingMutationError } = await import('../lib/db/operational/operational-ranking-mutation-service');

  const { PATCH, DELETE } = makeTicketIdHandlers(mockDeps as any);
  const { POST } = makeReorderHandlers(mockDeps as any);

  await runTest('R1. PATCH pasa ownerUserId válido intacto al servicio', async () => {
    simulatedUser = { userId: 1, role: 'admin' };
    const req = new NextRequest('http://localhost/api/rankings/100', {
      method: 'PATCH',
      body: JSON.stringify({ newPosition: 1, ownerUserId: 99 })
    });
    const res = await PATCH(req, { params: Promise.resolve({ ticketId: '100' }) });
    assert.equal(res.status, 200);
    assert.equal(lastServiceInput?.ownerUserId, 99);
  });

  await runTest('R2. PATCH sin ownerUserId invoca al servicio conservando omisión', async () => {
    simulatedUser = { userId: 2, role: 'priorizador' };
    lastServiceInput = null;
    const req = new NextRequest('http://localhost/api/rankings/100', {
      method: 'PATCH',
      body: JSON.stringify({ newPosition: 1 })
    });
    const res = await PATCH(req, { params: Promise.resolve({ ticketId: '100' }) });
    assert.equal(res.status, 200);
    assert.equal(lastServiceInput?.ownerUserId, undefined);
  });

  await runTest('R3. PATCH rechaza null, negativos y malformados sin invocar servicio', async () => {
    simulatedUser = { userId: 1, role: 'admin' };
    lastServiceInput = null;
    const req = new NextRequest('http://localhost/api/rankings/100', {
      method: 'PATCH',
      body: JSON.stringify({ newPosition: 1, ownerUserId: -5 })
    });
    const res = await PATCH(req, { params: Promise.resolve({ ticketId: '100' }) });
    assert.equal(res.status, 400);
    assert.equal(lastServiceInput, null);
  });

  await runTest('R4. DELETE pasa ownerUserId intacto desde query', async () => {
    simulatedUser = { userId: 1, role: 'admin' };
    const req = new NextRequest('http://localhost/api/rankings/100?ownerUserId=55', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ ticketId: '100' }) });
    assert.equal(res.status, 200);
    assert.equal(lastServiceInput?.ownerUserId, 55);
  });

  await runTest('R4b. DELETE rechaza ownerUserId duplicado sin invocar mutación', async () => {
    simulatedUser = { userId: 1, role: 'admin' };
    lastServiceInput = null;
    const req = new NextRequest('http://localhost/api/rankings/100?ownerUserId=55&ownerUserId=56', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ ticketId: '100' }) });
    assert.equal(res.status, 400);
    assert.equal(lastServiceInput, null);
  });

  await runTest('R5. POST (reorder) rechaza array vacío sin invocar mutación', async () => {
    simulatedUser = { userId: 1, role: 'admin' };
    lastServiceInput = null;
    const req = new NextRequest('http://localhost/api/rankings/reorder', {
      method: 'POST',
      body: JSON.stringify({ orderedTicketIds: [], ownerUserId: 10 })
    });
    const res = await POST(req);
    assert.equal(res.status, 400);
    assert.equal(lastServiceInput, null);
  });

  await runTest('R6. Errores de autorización producen 403 HTTP y validan parseo estricto', async () => {
    simulatedUser = { userId: 1, role: 'admin' };
    simulatedError = new OperationalRankingMutationError(403, 'Forbidden');
    const req = new NextRequest('http://localhost/api/rankings/100', {
      method: 'PATCH',
      body: JSON.stringify({ newPosition: 1, ownerUserId: 10 })
    });
    const res = await PATCH(req, { params: Promise.resolve({ ticketId: '100' }) });
    assert.equal(res.status, 403);
    simulatedError = null;
  });

  await runTest('R7. Roles no permitidos no invocan la mutación y devuelven 403', async () => {
    simulatedUser = { userId: 1, role: 'viewer' };
    lastServiceInput = null;
    const req = new NextRequest('http://localhost/api/rankings/100', {
      method: 'PATCH',
      body: JSON.stringify({ newPosition: 1, ownerUserId: 10 })
    });
    const res = await PATCH(req, { params: Promise.resolve({ ticketId: '100' }) });
    assert.equal(res.status, 403);
    assert.equal(lastServiceInput, null);
  });
}

main().then(() => {
  console.log(`\nTests Funcionales de Rutas: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
  if (failed > 0) process.exitCode = 1;
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
