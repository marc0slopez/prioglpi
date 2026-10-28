import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[OK] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log('--- TEST OPERATIONAL COORDINATION ROUTE OFFLINE ---');

runTest('R1: Analisis estatico de limpieza y ausencia de anti-patterns', () => {
  const routePath = path.join(__dirname, '../app/api/coordination/[ticketId]/route.ts');
  const content = fs.readFileSync(routePath, 'utf8');

  assert.strictEqual(content.includes('prisma'), false, 'Route must not contain prisma');
  assert.strictEqual(content.includes('logAudit'), false, 'Route must not contain logAudit');
  assert.strictEqual(content.includes('parseInt'), false, 'Route must not contain parseInt');
  assert.strictEqual(content.includes('console.error'), false, 'Route must not contain console.error');
  assert.strictEqual(content.includes('await getSharedSqlServerRuntime'), false, 'getSharedSqlServerRuntime is synchronous');
});

runTest('R2: Analisis estatico de orden de ejecucion en GET y PATCH', () => {
  const routePath = path.join(__dirname, '../app/api/coordination/[ticketId]/route.ts');
  const content = fs.readFileSync(routePath, 'utf8');

  const getIndex = content.indexOf('export async function GET');
  const patchIndex = content.indexOf('export async function PATCH');

  assert.ok(getIndex !== -1 && patchIndex !== -1 && getIndex < patchIndex);

  const getSection = content.slice(getIndex, patchIndex);
  const patchSection = content.slice(patchIndex);

  const getAuthPos = getSection.indexOf('getAuthUser()');
  const getParsePos = getSection.indexOf('parseCoordinationTicketId');
  const getRuntimePos = getSection.indexOf('getSharedSqlServerRuntime()');

  assert.ok(getAuthPos !== -1 && getParsePos !== -1 && getRuntimePos !== -1);
  assert.ok(getAuthPos < getParsePos, 'Auth must precede parser in GET');
  assert.ok(getParsePos < getRuntimePos, 'Parser must precede runtime in GET');

  const patchAuthPos = patchSection.indexOf('getAuthUser()');
  const patchGuardPos = patchSection.indexOf("user.role !== 'admin'");
  const patchParsePos = patchSection.indexOf('parseCoordinationTicketId');
  const patchRuntimePos = patchSection.indexOf('getSharedSqlServerRuntime()');

  assert.ok(patchAuthPos !== -1 && patchGuardPos !== -1 && patchParsePos !== -1 && patchRuntimePos !== -1);
  assert.ok(patchAuthPos < patchGuardPos, 'Auth must precede role guard in PATCH');
  assert.ok(patchGuardPos < patchParsePos, 'Role guard must precede parser in PATCH');
  assert.ok(patchParsePos < patchRuntimePos, 'Parser must precede runtime in PATCH');
});

runTest('R3: Verificacion del contrato legacy updatedBy', () => {
  const routePath = path.join(__dirname, '../app/api/coordination/[ticketId]/route.ts');
  const content = fs.readFileSync(routePath, 'utf8');

  assert.ok(content.includes('updatedBy: coordination.updatedByDisplayName'));
});

runTest('R4: Verificacion de guard canAccessTicket en GET', () => {
  const routePath = path.join(__dirname, '../app/api/coordination/[ticketId]/route.ts');
  const content = fs.readFileSync(routePath, 'utf8');

  assert.ok(content.includes('canAccessTicket(user, ticket)'));
});
