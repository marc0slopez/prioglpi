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
  const routePath = path.resolve(process.cwd(), 'app/api/meta/ticket-filters/route.ts');
  const content = await fs.readFile(routePath, 'utf-8');

  await runTest('1. Imports operacionales exactos presentes', (c) => {
    assert.ok(c.includes("import { NextResponse } from 'next/server';"));
    assert.ok(c.includes("import { getAuthUser } from '@/lib/auth';"));
    assert.ok(c.includes("import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';"));
    assert.ok(c.includes("import { SqlServerOperationalTicketFilterOptionsRepository } from '@/lib/db/operational/sqlserver-operational-ticket-filter-options-repository';"));
    assert.ok(c.includes("buildOperationalTicketFilterOptions,"));
    assert.ok(c.includes("type OperationalTicketFilterOptionsRole"));
    assert.ok(c.includes("} from '@/lib/db/operational/operational-ticket-filter-options-service';"));
  }, content);

  await runTest('2. Prisma, @prisma/client y ticket-helpers ausentes', (c) => {
    assert.ok(!c.includes('prisma'));
    assert.ok(!c.includes('@prisma/client'));
    assert.ok(!c.includes('ticket-helpers'));
  }, content);

  await runTest('3. Type guard acepta los cuatro roles y no acepta system', (c) => {
    assert.ok(c.includes("function isOperationalTicketFilterOptionsRole"));
    assert.ok(c.includes("role === 'admin'"));
    assert.ok(c.includes("role === 'coordinador_sistemas'"));
    assert.ok(c.includes("role === 'referente'"));
    assert.ok(c.includes("role === 'priorizador'"));
    assert.ok(!c.includes("role === 'system'"));
  }, content);

  await runTest('4. getAuthUser() ocurre antes de cualquier runtime', (c) => {
    const authIndex = c.indexOf('await getAuthUser()');
    const runtimeIndex = c.indexOf('getSharedSqlServerRuntime()');
    assert.ok(authIndex !== -1);
    assert.ok(runtimeIndex !== -1);
    assert.ok(authIndex < runtimeIndex);
  }, content);

  await runTest('5. Respuesta 401 existe antes del runtime', (c) => {
    const authErrorIndex = c.indexOf("status: 401");
    const runtimeIndex = c.indexOf('getSharedSqlServerRuntime()');
    assert.ok(authErrorIndex !== -1);
    assert.ok(authErrorIndex < runtimeIndex);
  }, content);

  await runTest('6. Validación de rol y respuesta 403 ocurren antes del runtime', (c) => {
    const roleCheckIndex = c.indexOf("if (!isOperationalTicketFilterOptionsRole(user.role))");
    const roleErrorIndex = c.indexOf("status: 403");
    const runtimeIndex = c.indexOf("const runtime = getSharedSqlServerRuntime();");
    assert.ok(roleCheckIndex !== -1);
    assert.ok(roleErrorIndex !== -1);
    assert.ok(runtimeIndex !== -1);
    assert.ok(roleCheckIndex < roleErrorIndex);
    assert.ok(roleErrorIndex < runtimeIndex);
  }, content);

  await runTest('7. getSharedSqlServerRuntime() aparece exactamente una vez', (c) => {
    const matches = c.match(/getSharedSqlServerRuntime\(\)/g);
    assert.ok(matches);
    assert.equal(matches.length, 1);
  }, content);

  await runTest('8. El repositorio recibe exactamente la variable runtime', (c) => {
    assert.ok(c.includes("new SqlServerOperationalTicketFilterOptionsRepository(runtime)"));
  }, content);

  await runTest('9. El actor usa user.sectorScopes y no arrays paralelos', (c) => {
    assert.ok(c.includes("sectorScopes: user.sectorScopes"));
    assert.ok(!c.includes("user.sectors"));
    assert.ok(!c.includes("user.sectorGroupIds"));
  }, content);

  await runTest('10. El servicio recibe el repositorio y el actor antes de responder', (c) => {
    const serviceIndex = c.indexOf("buildOperationalTicketFilterOptions(repository, actor)");
    const responseIndex = c.indexOf("NextResponse.json(response)");
    assert.ok(serviceIndex !== -1);
    assert.ok(responseIndex !== -1);
    assert.ok(serviceIndex < responseIndex);
  }, content);

  await runTest('11. La respuesta del servicio se entrega directamente con NextResponse.json', (c) => {
    assert.ok(c.includes("NextResponse.json(response)"));
  }, content);

  await runTest('12. Higiene: sin SQL, query/execute, console.error, suppressions ni cierre manual', (c) => {
    assert.ok(!c.includes('SELECT '));
    assert.ok(!c.includes('.query('));
    assert.ok(!c.includes('.execute('));
    assert.ok(!c.includes('console.error'));
    assert.ok(!c.includes(' as ')); // no casts
    assert.ok(!c.includes('any'));
    assert.ok(!c.includes('ts-ignore'));
    assert.ok(!c.includes('eslint-disable'));
    assert.ok(!c.includes('.destroy('));
    assert.ok(!c.includes('.close('));
    assert.ok(!c.includes('prisma'));
  }, content);
}

void main().then(() => {
  console.log(`\nTests Route Architecture: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
