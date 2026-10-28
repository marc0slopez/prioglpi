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
    console.error(`[FAIL] ${name}`);
    throw err;
  }
}

async function main() {
  const routePath = path.join(process.cwd(), 'app', 'api', 'tickets', 'route.ts');
  const routeCode = await readFile(routePath, 'utf8');

  await runTest('1. Imports operacionales requeridos presentes', () => {
    assert.ok(routeCode.includes('import { getAuthUser } from'));
    assert.ok(routeCode.includes('import { getSharedSqlServerRuntime } from'));
    assert.ok(routeCode.includes('import { parseOperationalTicketListQuery } from'));
    assert.ok(routeCode.includes('import { SqlServerOperationalTicketListContextRepository } from'));
    assert.ok(routeCode.includes('import { SqlServerOperationalTicketListFilterRepository } from'));
    assert.ok(routeCode.includes('import { buildOperationalTicketListPlan } from'));
    assert.ok(routeCode.includes('import { executeOperationalTicketList } from'));
    assert.ok(routeCode.includes("import type { OperationalTicketListActor } from '@/lib/db/operational/operational-ticket-list-types';"));
    assert.equal(routeCode.includes("OperationalTicketListActor } from '@/lib/db/operational/operational-ticket-list-plan-types'"), false);
    assert.ok(routeCode.includes('import { NextRequest, NextResponse } from'));
  });

  await runTest('2. Prisma, @prisma/client y getCanonicalTechMap ausentes', () => {
    assert.ok(!routeCode.includes('import { prisma }'));
    assert.ok(!routeCode.includes('import { Prisma }'));
    assert.ok(!routeCode.includes('@prisma/client'));
    assert.ok(!routeCode.includes('getCanonicalTechMap'));
  });

  await runTest('3. Type guard acepta textualmente los cuatro roles y no system', () => {
    assert.ok(routeCode.includes('function isOperationalTicketListRole('));
    assert.ok(routeCode.includes("role === 'admin'"));
    assert.ok(routeCode.includes("role === 'coordinador_sistemas'"));
    assert.ok(routeCode.includes("role === 'referente'"));
    assert.ok(routeCode.includes("role === 'priorizador'"));
    assert.ok(!routeCode.includes("role === 'system'"));
  });

  await runTest('4. getAuthUser precede al parser y existe respuesta 401', () => {
    const authIdx = routeCode.indexOf('await getAuthUser()');
    const parseIdx = routeCode.indexOf('parseOperationalTicketListQuery(');
    assert.ok(authIdx !== -1);
    assert.ok(parseIdx !== -1);
    assert.ok(authIdx < parseIdx);
    assert.ok(routeCode.includes('status: 401'));
  });

  await runTest('5. Validación de rol precede al parser y existe respuesta 403', () => {
    const roleCheckIdx = routeCode.indexOf('if (!isOperationalTicketListRole(user.role))');
    const parseIdx = routeCode.indexOf('parseOperationalTicketListQuery(searchParams, actor)');
    const authErrorIdx = routeCode.indexOf('status: 403');
    assert.ok(roleCheckIdx !== -1);
    assert.ok(parseIdx !== -1);
    assert.ok(roleCheckIdx < parseIdx);
    assert.ok(authErrorIdx > roleCheckIdx && authErrorIdx < parseIdx);
  });

  await runTest('6. Parser se ejecuta antes de getSharedSqlServerRuntime', () => {
    const parseIdx = routeCode.indexOf('parseOperationalTicketListQuery(');
    const runtimeIdx = routeCode.indexOf('getSharedSqlServerRuntime()');
    assert.ok(parseIdx !== -1);
    assert.ok(runtimeIdx !== -1);
    assert.ok(parseIdx < runtimeIdx);
  });

  await runTest('7. Error del parser reenvía parsed.error y parsed.httpStatus', () => {
    assert.ok(routeCode.includes('parsed.error'));
    assert.ok(routeCode.includes('parsed.httpStatus'));
  });

  await runTest('8. Ambos repositorios reciben la misma variable runtime', () => {
    assert.ok(routeCode.includes('new SqlServerOperationalTicketListContextRepository(runtime)'));
    assert.ok(routeCode.includes('new SqlServerOperationalTicketListFilterRepository(runtime)'));
  });

  await runTest('9. Planner se ejecuta después de construir los repositorios', () => {
    const buildContextIdx = routeCode.indexOf('new SqlServerOperationalTicketListContextRepository');
    const buildFilterIdx = routeCode.indexOf('new SqlServerOperationalTicketListFilterRepository');
    const plannerIdx = routeCode.indexOf('buildOperationalTicketListPlan(');
    assert.ok(buildContextIdx !== -1);
    assert.ok(buildFilterIdx !== -1);
    assert.ok(plannerIdx !== -1);
    assert.ok(buildContextIdx < plannerIdx);
    assert.ok(buildFilterIdx < plannerIdx);
  });

  await runTest('10. Error del planner reenvía planned.error y planned.httpStatus', () => {
    assert.ok(routeCode.includes('planned.error'));
    assert.ok(routeCode.includes('planned.httpStatus'));
  });

  await runTest('11. Executor recibe runtime, planned.plan y todayArgentina; la respuesta se entrega directamente', () => {
    assert.ok(routeCode.includes('executeOperationalTicketList('));
    assert.ok(routeCode.includes('runtime,'));
    assert.ok(routeCode.includes('planned.plan,'));
    assert.ok(routeCode.includes('todayArgentina'));
    assert.ok(routeCode.includes('NextResponse.json(response)'));
  });

  await runTest('12. Higiene arquitectónica', () => {
    assert.ok(!routeCode.includes('prisma.'));
    assert.ok(!routeCode.includes('Prisma.'));
    assert.ok(!routeCode.includes('parseInt('));
    assert.ok(!routeCode.includes('JSON.parse('));
    assert.ok(!routeCode.includes('SELECT '));
    assert.ok(!routeCode.includes('$transaction'));
    assert.ok(!routeCode.includes('console.error'));
    assert.ok(!routeCode.includes('as any'));
    assert.ok(!routeCode.includes('!.'));
    assert.ok(routeCode.includes('catch {')); // catch genérico sin variable
    assert.ok(routeCode.includes('status: 500'));
    assert.ok(routeCode.includes("timeZone: 'America/Argentina/Buenos_Aires'"));
    assert.ok(!routeCode.includes('searchParams.get('));
  });
}

void main().then(() => {
  console.log(`\nTests Operational Ticket List Route: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
