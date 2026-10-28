import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

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

async function readRouteFile(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), ...relativePath.split('/')), 'utf8');
}

async function checkNoLegacyPatterns(content: string, label: string): Promise<void> {
  assert.ok(!content.includes("from '@prisma/client'"), `${label}: must not import @prisma/client`);
  assert.ok(!content.includes("from 'prisma'"), `${label}: must not import prisma`);
  assert.ok(!content.includes("import { prisma }"), `${label}: must not use global prisma`);
  assert.ok(!content.includes("logAudit"), `${label}: must not use legacy logAudit`);
  assert.ok(!content.includes('console.error('), `${label}: must not call console.error`);
  // No raw SQL
  assert.ok(!content.includes('SELECT ') && !content.includes('UPDATE ') && !content.includes('INSERT INTO '),
    `${label}: must not contain raw SQL`);
  // No casts
  assert.ok(!/\bas\s+\{/.test(content), `${label}: must not cast body`);
  assert.ok(!/: any/.test(content), `${label}: must not use any`);
  assert.ok(!content.includes('// eslint-disable'), `${label}: must not suppress ESLint`);
  assert.ok(!content.includes('@ts-ignore') && !content.includes('@ts-expect-error'), `${label}: must not suppress TS`);
}

async function main() {
  const ticketRoutePath = 'app/api/rankings/[ticketId]/handlers.ts';
  const reorderRoutePath = 'app/api/rankings/reorder/handlers.ts';

  let ticketRouteContent: string;
  let reorderRouteContent: string;

  await runTest('AR1. Ambas rutas son legibles', async () => {
    ticketRouteContent = await readRouteFile(ticketRoutePath);
    reorderRouteContent = await readRouteFile(reorderRoutePath);
    assert.ok(ticketRouteContent.length > 0);
    assert.ok(reorderRouteContent.length > 0);
  });

  await runTest('AR2. [ticketId]/route.ts: ausencia de Prisma, logAudit, SQL manual, console.error, casts y suppressions', async () => {
    await checkNoLegacyPatterns(ticketRouteContent, '[ticketId]/route.ts');
  });

  await runTest('AR3. reorder/route.ts: ausencia de Prisma, logAudit, SQL manual, console.error, casts y suppressions', async () => {
    await checkNoLegacyPatterns(reorderRouteContent, 'reorder/route.ts');
  });

  await runTest('AR4. [ticketId]/route.ts usa getSharedSqlServerRuntime', () => {
    const runtimeIdx = ticketRouteContent.indexOf('deps.getSharedSqlServerRuntime');
    assert.ok(runtimeIdx !== -1, '[ticketId] must use shared SQL Server runtime');
  });

  await runTest('AR5. reorder/route.ts usa getSharedSqlServerRuntime', () => {
    const runtimeIdx = reorderRouteContent.indexOf('deps.getSharedSqlServerRuntime');
    assert.ok(runtimeIdx !== -1, 'reorder must use shared SQL Server runtime');
  });

  await runTest('AR6. [ticketId]/route.ts usa isOperationalRankingMutationRole como role guard', () => {
    const roleGuardCall = 'if (!isOperationalRankingMutationRole(user.role))';
    const actorCall = 'const actor =';

    const patchGuardIdx = ticketRouteContent.indexOf(roleGuardCall);
    assert.ok(patchGuardIdx !== -1, 'PATCH role guard must exist');
    const patchActorIdx = ticketRouteContent.indexOf(actorCall, patchGuardIdx);
    assert.ok(patchActorIdx !== -1, 'PATCH actor construction must exist');
    assert.ok(patchActorIdx > patchGuardIdx, 'PATCH actor must be constructed after role guard');

    const deleteGuardIdx = ticketRouteContent.indexOf(roleGuardCall, patchActorIdx);
    assert.ok(deleteGuardIdx !== -1, 'DELETE role guard must exist');
    const deleteActorIdx = ticketRouteContent.indexOf(actorCall, deleteGuardIdx);
    assert.ok(deleteActorIdx !== -1, 'DELETE actor construction must exist');
    assert.ok(deleteActorIdx > deleteGuardIdx, 'DELETE actor must be constructed after role guard');
  });

  await runTest('AR7. reorder/route.ts usa isOperationalRankingMutationRole como role guard', () => {
    const roleGuardCall = 'if (!isOperationalRankingMutationRole(user.role))';
    const actorCall = 'const actor =';

    const guardIdx = reorderRouteContent.indexOf(roleGuardCall);
    assert.ok(guardIdx !== -1, 'reorder role guard must exist');
    const actorIdx = reorderRouteContent.indexOf(actorCall, guardIdx);
    assert.ok(actorIdx !== -1, 'reorder actor construction must exist');
    assert.ok(actorIdx > guardIdx, 'reorder actor must be constructed after role guard');
  });

  await runTest('AR8. [ticketId]/route.ts: parser es invocado antes que getSharedSqlServerRuntime', () => {
    const patchParseCall = 'const parseResult = parsePatchMutation(ticketIdStr, body);';
    const deleteParseCall = 'const parseResult = parseDeleteMutation(ticketIdStr, request.nextUrl.searchParams);';
    const runtimeCall = 'const rt = deps.getSharedSqlServerRuntime();';

    const patchParseIdx = ticketRouteContent.indexOf(patchParseCall);
    assert.ok(patchParseIdx !== -1, 'parsePatchMutation call must exist');
    const patchRuntimeIdx = ticketRouteContent.indexOf(runtimeCall, patchParseIdx);
    assert.ok(patchRuntimeIdx !== -1, 'PATCH runtime call must exist');
    assert.ok(patchParseIdx < patchRuntimeIdx, 'parsePatchMutation must be called before runtime');

    const deleteParseIdx = ticketRouteContent.indexOf(deleteParseCall, patchRuntimeIdx);
    assert.ok(deleteParseIdx !== -1, 'parseDeleteMutation call must exist');
    const deleteRuntimeIdx = ticketRouteContent.indexOf(runtimeCall, deleteParseIdx);
    assert.ok(deleteRuntimeIdx !== -1, 'DELETE runtime call must exist');
    assert.ok(deleteParseIdx < deleteRuntimeIdx, 'parseDeleteMutation must be called before runtime');
  });

  await runTest('AR9. reorder/route.ts: parser es invocado antes que getSharedSqlServerRuntime', () => {
    const parseCall = 'const parseResult = parseReorderMutation(body);';
    const runtimeCall = 'const rt = deps.getSharedSqlServerRuntime();';

    const parseIdx = reorderRouteContent.indexOf(parseCall);
    assert.ok(parseIdx !== -1, 'parseReorderMutation call must exist');
    const runtimeIdx = reorderRouteContent.indexOf(runtimeCall, parseIdx);
    assert.ok(runtimeIdx !== -1, 'reorder runtime call must exist');
    assert.ok(parseIdx < runtimeIdx, 'parseReorderMutation must be called before runtime');
  });

  await runTest('AR10. [ticketId]/route.ts invoca patchOperationalRanking y deleteOperationalRanking', () => {
    const patchCall = 'const result = await deps.patchOperationalRanking(rt, actor, parseResult.data);';
    const deleteCall = 'const result = await deps.deleteOperationalRanking(rt, actor, parseResult.data);';

    const patchIdx = ticketRouteContent.indexOf(patchCall);
    assert.ok(patchIdx !== -1, 'patchOperationalRanking call must exist');
    const deleteIdx = ticketRouteContent.indexOf(deleteCall, patchIdx);
    assert.ok(deleteIdx !== -1, 'deleteOperationalRanking call must exist');
  });

  await runTest('AR11. reorder/route.ts invoca reorderOperationalRankings', () => {
    const reorderCall = 'const result = await deps.reorderOperationalRankings(rt, actor, parseResult.data);';
    const reorderIdx = reorderRouteContent.indexOf(reorderCall);
    assert.ok(reorderIdx !== -1, 'reorderOperationalRankings call must exist');
  });

  await runTest('AR12. [ticketId]/route.ts: cero non-null assertions (!. or ![)', () => {
    const nonNullDotPattern = /[a-zA-Z0-9_\)\])]![.\[]/;
    assert.ok(!nonNullDotPattern.test(ticketRouteContent), 'must not contain non-null assertions');
  });

  await runTest('AR13. reorder/route.ts: cero non-null assertions (!. or ![)', () => {
    const nonNullDotPattern = /[a-zA-Z0-9_\)\])]![.\[]/;
    assert.ok(!nonNullDotPattern.test(reorderRouteContent), 'must not contain non-null assertions');
  });
}

void main().then(() => {
  console.log(`\nTests Routes: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
  if (failed > 0) process.exitCode = 1;
}).catch(() => {
  process.exitCode = 1;
});
