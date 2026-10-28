import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

let passed = 0, failed = 0, total = 0;

async function runTest(name: string, fn: (content: string) => void | Promise<void>, content: string) {
  total++;
  try {
    await fn(content);
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] ${name}`);
    throw err;
  }
}

async function main() {
  const routePath = path.resolve(process.cwd(), 'app/api/rankings/route.ts');
  const content = await fs.readFile(routePath, 'utf-8');

  await runTest('1. Imports operacionales completos y canónicos', (c) => {
    assert.ok(c.includes("import { NextRequest, NextResponse } from 'next/server';"));
    assert.ok(c.includes("import { getAuthUser } from '@/lib/auth';"));
    assert.ok(c.includes("import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';"));
    assert.ok(c.includes("import { SqlServerOperationalRankingReadRepository } from '@/lib/db/operational/sqlserver-operational-ranking-read-repository';"));
    assert.ok(c.includes("import { parseOperationalRankingListQuery, type OperationalRankingListRole } from '@/lib/db/operational/operational-ranking-list-query';"));
    assert.ok(c.includes("import { buildOperationalRankingListResponse } from '@/lib/db/operational/operational-ranking-list-response';"));
  }, content);

  await runTest('2. Prisma y @prisma/client ausentes', (c) => {
    assert.ok(!c.includes('prisma'));
    assert.ok(!c.includes('@prisma/client'));
  }, content);

  await runTest('3. Type guard acepta cuatro roles y no system', (c) => {
    assert.ok(c.includes("function isOperationalRankingListRole"));
    assert.ok(c.includes("role === 'admin'"));
    assert.ok(c.includes("role === 'coordinador_sistemas'"));
    assert.ok(c.includes("role === 'referente'"));
    assert.ok(c.includes("role === 'priorizador'"));
    assert.ok(!c.includes("role === 'system'"));
  }, content);

  await runTest('4. Auth y 401 antes del parser/runtime', (c) => {
    const authIndex = c.indexOf('await getAuthUser()');
    const status401Index = c.indexOf('status: 401');
    const parserCallIndex = c.indexOf('const parsed = parseOperationalRankingListQuery(request.nextUrl.searchParams, actor);');
    const runtimeIndex = c.indexOf('const runtime = getSharedSqlServerRuntime();');

    assert.ok(authIndex !== -1);
    assert.ok(status401Index !== -1);
    assert.ok(parserCallIndex !== -1);
    assert.ok(authIndex < status401Index);
    assert.ok(status401Index < parserCallIndex);
    assert.ok(status401Index < runtimeIndex);
  }, content);

  await runTest('5. Guard y 403 antes del parser/runtime', (c) => {
    const guardIndex = c.indexOf('if (!isOperationalRankingListRole(user.role))');
    const status403Index = c.indexOf('status: 403');
    const parserCallIndex = c.indexOf('const parsed = parseOperationalRankingListQuery(request.nextUrl.searchParams, actor);');
    const runtimeIndex = c.indexOf('const runtime = getSharedSqlServerRuntime();');

    assert.ok(guardIndex !== -1);
    assert.ok(status403Index !== -1);
    assert.ok(parserCallIndex !== -1);
    assert.ok(guardIndex < status403Index);
    assert.ok(status403Index < parserCallIndex);
    assert.ok(status403Index < runtimeIndex);
  }, content);

  await runTest('6. Parser usa exactamente request.nextUrl.searchParams', (c) => {
    assert.ok(c.includes("parseOperationalRankingListQuery(request.nextUrl.searchParams, actor)"));
  }, content);

  await runTest('7. Parser se ejecuta antes de adquirir runtime', (c) => {
    const parserIndex = c.indexOf('parseOperationalRankingListQuery(request.nextUrl.searchParams, actor)');
    const runtimeIndex = c.indexOf('const runtime = getSharedSqlServerRuntime();');
    assert.ok(parserIndex !== -1);
    assert.ok(runtimeIndex !== -1);
    assert.ok(parserIndex < runtimeIndex);
  }, content);

  await runTest('8. Error del parser reenvía error/httpStatus', (c) => {
    assert.ok(c.includes("NextResponse.json({ error: parsed.error }, { status: parsed.httpStatus })"));
  }, content);

  await runTest('9. Runtime aparece exactamente una vez', (c) => {
    const matches = c.match(/getSharedSqlServerRuntime\(\)/g);
    assert.ok(matches);
    assert.equal(matches.length, 1);
  }, content);

  await runTest('10. Repositorio recibe runtime y método recibe parsed.groupIds', (c) => {
    assert.ok(c.includes("new SqlServerOperationalRankingReadRepository(runtime)"));
    assert.ok(c.includes("repository.listActiveRankings(parsed.groupIds)"));
  }, content);

  await runTest('11. Serializer recibe rankings y respuesta se entrega directamente', (c) => {
    assert.ok(c.includes("buildOperationalRankingListResponse(rankings)"));
    assert.ok(c.includes("NextResponse.json(response)"));
  }, content);

  await runTest('12. Higiene: sin SQL, .query, .execute, new URL, searchParams.get, console.error, casts, Prisma, transacciones o cierre manual', (c) => {
    assert.ok(!c.includes('SELECT '));
    assert.ok(!c.includes('.query('));
    assert.ok(!c.includes('.execute('));
    assert.ok(!c.includes('new URL('));
    assert.ok(!c.includes('searchParams.get('));
    assert.ok(!c.includes('console.error'));
    assert.ok(!c.includes(' as ')); // no casts
    assert.ok(!c.includes('prisma'));
    assert.ok(!c.includes('transaction'));
    assert.ok(!c.includes('.close('));
    assert.ok(!c.includes('.destroy('));
  }, content);
}

void main().then(() => {
  console.log(`\nTests Route Architecture: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
