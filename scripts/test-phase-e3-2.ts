import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

process.exitCode = 0;

const EXTERNAL_SERVER_URL = process.env.APPGLPI_TEST_EXTERNAL_SERVER_URL;
const DB_PATH = process.env.APPGLPI_TEST_DB_PATH;

if (!EXTERNAL_SERVER_URL || !DB_PATH) {
  console.error('Faltan variables de entorno requeridas. Usar el server QA activo.');
  process.exitCode = 1;
  process.exit();
}

const projectRoot = process.cwd();
const qaRoot = path.resolve(projectRoot, 'data', 'qa');
const activeDb = path.resolve(projectRoot, 'data', 'appglpi.sqlite');
const absoluteDb = path.resolve(DB_PATH);
const relative = path.relative(qaRoot, absoluteDb);

if (
  !path.isAbsolute(DB_PATH) ||
  !fs.existsSync(absoluteDb) ||
  relative.startsWith('..') ||
  path.isAbsolute(relative) ||
  absoluteDb.toLowerCase() === activeDb.toLowerCase()
) {
  console.error('APPGLPI_TEST_DB_PATH invÃ¡lido o inseguro.');
  process.exitCode = 1;
  process.exit();
}

let db: InstanceType<typeof Database> | null = null;
let checksPassed = 0;

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(`AserciÃ³n fallida: ${message}`);
  checksPassed++;
}

function checkEqual<T>(actual: T, expected: T, message: string) {
  try {
    assert.deepStrictEqual(actual, expected, message);
    checksPassed++;
  } catch {
    throw new Error(`AserciÃ³n fallida: ${message}\nActual: ${JSON.stringify(actual)}\nEsperado: ${JSON.stringify(expected)}`);
  }
}

function hashRows(rows: unknown[]): string {
  const json = JSON.stringify(rows);
  return crypto.createHash('sha256').update(json).digest('hex');
}

function getFileHash(filePath: string) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex').toUpperCase();
}

async function loginAndGetCookie(username: string, pass: string, expectedRole: string): Promise<{ cookie: string, userId: number, username: string, role: string }> {
  const res = await fetch(`${EXTERNAL_SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: pass }),
  });
  checkEqual(res.status, 200, `Login fallido para ${username}`);
  const rawCookie = res.headers.get('set-cookie');
  check(!!rawCookie, 'Falta cookie');
  const cookie = rawCookie!.split(';')[0] || '';

  const meRes = await fetchWithAuth('/api/auth/me', cookie);
  checkEqual(meRes.status, 200, `/api/auth/me fallÃ³ para ${username}`);
  const meData = await meRes.json() as { userId: number, username: string, role: string };
  checkEqual(meData.role, expectedRole, `Rol inesperado para ${username}`);
  checkEqual(meData.username, username, `Username inesperado para ${username}`);
  return { cookie, userId: meData.userId, username: meData.username, role: meData.role };
}

async function fetchWithAuth(apiPath: string, cookie: string, options: RequestInit = {}) {
  return fetch(`${EXTERNAL_SERVER_URL}${apiPath}`, {
    ...options,
    headers: { ...options.headers, Cookie: cookie },
  });
}

async function runTests() {
  const initialActiveHash = getFileHash(activeDb);
  console.log(`[INIT] Hash Active DB inicial: ${initialActiveHash}`);
  const initialQaHash = getFileHash(absoluteDb);
  console.log(`[INIT] Hash QA DB inicial: ${initialQaHash}`);

  db = new Database(absoluteDb, { fileMustExist: true, readonly: true });
  const integrity = db.pragma('integrity_check', { simple: true });
  checkEqual(integrity, 'ok', 'Integridad de DB fallida');

  const coordAuth = await loginAndGetCookie('coordinator_demo', 'coordinator_demo123', 'coordinador_sistemas');
  const refAuth = await loginAndGetCookie('julianc', 'julianc123', 'referente');
  const supAuth = await loginAndGetCookie('carolinar', 'carolinar123', 'supervisor');
  const adminAuth = await loginAndGetCookie('admin', 'admin123', 'admin');

  // Verify server is reading same DB:
  const dbTicketCount = db.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1').get() as { c: number };
  const resTicketsAll = await fetchWithAuth('/api/tickets?view=all&page=1&limit=1', coordAuth.cookie);
  const dataTicketsAll = await resTicketsAll.json() as { total: number };
  checkEqual(dataTicketsAll.total, dbTicketCount.c, 'El servidor no estÃ¡ leyendo la DB QA esperada (conteo de tickets difiere)');

  const resMeta = await fetchWithAuth('/api/meta/ticket-filters', refAuth.cookie);
  checkEqual(resMeta.status, 200, 'meta endpoint failed');
  const metaData = await resMeta.json() as { technicians: { id: number, name: string }[] };
  check(metaData.technicians && metaData.technicians.length > 0, 'No technicians found in metaData');

  console.log('[Test] Privacidad de Notas y Comentarios');
  const privNote = db.prepare(`
    SELECT f.ticketId, f.contentPlain
    FROM GlpiFollowupCache f
    JOIN GlpiTicketCache t ON t.ticketId = f.ticketId
    WHERE f.isPrivate = 1 AND f.contentPlain IS NOT NULL AND f.contentPlain != '' AND t.isSistemasScope = 1
    LIMIT 1
  `).get() as { ticketId: number, contentPlain: string } | undefined;

  check(!!privNote, 'Falta fixture de nota privada real de Sistemas');

  if (privNote) {
    const word = privNote.contentPlain.split(/[ \n]+/).filter(w => w.length > 5 && !w.includes('<'))[0] || 'privado';
    const resRef = await fetchWithAuth(`/api/tickets?notes=${encodeURIComponent(word)}&ticketId=${privNote.ticketId}`, refAuth.cookie);
    checkEqual(resRef.status, 403, 'Referente debe recibir 403 en notas privadas');
    const resSup = await fetchWithAuth(`/api/tickets?notes=${encodeURIComponent(word)}&ticketId=${privNote.ticketId}`, supAuth.cookie);
    checkEqual(resSup.status, 403, 'Supervisor debe recibir 403 en notas privadas');

    const resCoord = await fetchWithAuth(`/api/tickets?notes=${encodeURIComponent(word)}&ticketId=${privNote.ticketId}`, coordAuth.cookie);
    checkEqual(resCoord.status, 200, 'Coordinador puede buscar notas privadas');
    const coordData = await resCoord.json() as { total: number, tickets: { ticketId: number }[] };
    checkEqual(coordData.total, 1, 'Coordinador no encontrÃ³ el Ãºnico ticket privado esperado');
    checkEqual(coordData.tickets[0].ticketId, privNote.ticketId, 'El ticketId esperado no estÃ¡ en los resultados del coordinador');

    const resAdmin = await fetchWithAuth(`/api/tickets?notes=${encodeURIComponent(word)}&ticketId=${privNote.ticketId}`, adminAuth.cookie);
    checkEqual(resAdmin.status, 200, 'Admin puede buscar notas privadas');
    const adminData = await resAdmin.json() as { total: number, tickets: { ticketId: number }[] };
    checkEqual(adminData.total, 1, 'Admin no encontrÃ³ el Ãºnico ticket privado esperado');
  }

  const pubComment = db.prepare(`
    SELECT f.ticketId, f.contentPlain
    FROM GlpiFollowupCache f
    JOIN GlpiTicketCache t ON t.ticketId = f.ticketId
    WHERE f.isPrivate = 0 AND f.contentPlain IS NOT NULL AND f.contentPlain != ''
      AND t.isSistemasScope = 1 AND t.status IN (1,2,3,4) AND t.detectedSectorGroupId IN (15, 55, 14, 36)
    LIMIT 1
  `).get() as { ticketId: number, contentPlain: string } | undefined;

  check(!!pubComment, 'Falta fixture de comentario publico real para Julian');

  if (pubComment) {
    const word = pubComment.contentPlain.split(/[ \n]+/).filter(w => w.length > 5 && !w.includes('<'))[0] || 'publico';
    const resRefPub = await fetchWithAuth(`/api/tickets?comments=${encodeURIComponent(word)}&ticketId=${pubComment.ticketId}`, refAuth.cookie);
    checkEqual(resRefPub.status, 200, 'Comentario pÃºblico encontrado por referente');
    const refData = await resRefPub.json() as { total: number, tickets: { ticketId: number }[] };
    checkEqual(refData.total, 1, 'Referente total comentario publico fallÃ³');
    checkEqual(refData.tickets[0].ticketId, pubComment.ticketId, 'Referente ticketId comentario publico fallÃ³');
  }

  console.log('[Test] PaginaciÃ³n estricta');
  const p1 = await fetchWithAuth('/api/tickets/unranked?sector=Sistemas&page=', refAuth.cookie);
  checkEqual(p1.status, 400, 'Page vacÃ­o');
  const p2 = await fetchWithAuth('/api/tickets/unranked?sector=Sistemas&page=0', refAuth.cookie);
  checkEqual(p2.status, 400, 'Page cero');
  const p3 = await fetchWithAuth('/api/tickets/unranked?sector=Sistemas&page=-1', refAuth.cookie);
  checkEqual(p3.status, 400, 'Page negativo');
  const p4 = await fetchWithAuth('/api/tickets/unranked?sector=Sistemas&page=1.5', refAuth.cookie);
  checkEqual(p4.status, 400, 'Page decimal');
  const p5 = await fetchWithAuth('/api/tickets/unranked?sector=Sistemas&page=01', refAuth.cookie);
  checkEqual(p5.status, 400, 'Page con cero inicial');
  const p6 = await fetchWithAuth('/api/tickets/unranked?sector=Sistemas&limit=201', refAuth.cookie);
  checkEqual(p6.status, 400, 'Limit > 200');

  console.log('[Test] Quitar Prioridad y NO-OP');
  const deleteNoBody = await fetchWithAuth('/api/rankings/999999', refAuth.cookie, { method: 'DELETE' });
  checkEqual(deleteNoBody.status, 400, 'DELETE sin body debe ser 400');

  const rank = db.prepare(`
    SELECT r.id, r.ticketId, r.sectorName, r.updatedAt, r.rankPosition
    FROM TicketRanking r
    JOIN GlpiTicketCache t ON t.ticketId = r.ticketId
    WHERE r.isActive = 1 AND t.isSistemasScope = 1 AND t.status IN (1,2,3,4)
      AND t.detectedSectorGroupId IN (15, 55, 14, 36)
      AND t.detectedSector = r.sectorName
    LIMIT 1
  `).get() as { ticketId: number, sectorName: string, id: number, updatedAt: string, rankPosition: number } | undefined;

  check(!!rank, 'No se encontro fixture de ranking valida para JulianC');

  if (rank) {
    const entityId = `${rank.sectorName}/${rank.ticketId}`;
    const initialOtherSector = db.prepare('SELECT * FROM TicketRanking WHERE sectorName != ?').all(rank.sectorName);
    const initialOtherSectorHash = hashRows(initialOtherSector);

    // Capturar inactivos antes
    const initialInactive = db.prepare('SELECT id FROM TicketRanking WHERE isActive = 0 ORDER BY id ASC').all() as { id: number }[];
    const initialInactiveIds = initialInactive.map(r => r.id);
    const initialInactiveRows = db.prepare(`SELECT * FROM TicketRanking WHERE id IN (${initialInactiveIds.length ? initialInactiveIds.join(',') : '0'}) ORDER BY id ASC`).all();
    const initialInactiveHash = hashRows(initialInactiveRows);

    const initialAuditForEntity = db.prepare("SELECT * FROM AuditLog WHERE entityType = 'ranking' AND action = 'ranking_remove' AND entityId = ? ORDER BY id ASC").all(entityId);
    const initialAuditCount = initialAuditForEntity.length;

    // PRIMER DELETE
    const del1 = await fetchWithAuth(`/api/rankings/${rank.ticketId}`, refAuth.cookie, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sector: rank.sectorName })
    });
    checkEqual(del1.status, 200, 'Status HTTP de DELETE ok');
    const del1Data = await del1.json();
    checkEqual(del1Data.changed, true, 'Quitar prioridad changed true');

    // Verifications in DB
    const updatedObj = db.prepare('SELECT * FROM TicketRanking WHERE id = ?').get(rank.id) as { isActive: number, rankPosition: number, updatedAt: string };
    checkEqual(updatedObj.isActive, 0, 'Ranking ahora es inactivo');
    // rankPosition check is omitted as requested

    // Inmutables
    const postOtherSector = db.prepare('SELECT * FROM TicketRanking WHERE sectorName != ?').all(rank.sectorName);
    checkEqual(hashRows(postOtherSector), initialOtherSectorHash, 'Otros sectores inmutables');

    const postInactiveRows = db.prepare(`SELECT * FROM TicketRanking WHERE id IN (${initialInactiveIds.length ? initialInactiveIds.join(',') : '0'}) ORDER BY id ASC`).all();
    checkEqual(hashRows(postInactiveRows), initialInactiveHash, 'Inactivos previos inmutables');

    // Audit log exact check
    const postAuditForEntity = db.prepare("SELECT * FROM AuditLog WHERE entityType = 'ranking' AND action = 'ranking_remove' AND entityId = ? ORDER BY id ASC").all(entityId) as { userId: number, beforeJson: string, afterJson: string }[];
    checkEqual(postAuditForEntity.length, initialAuditCount + 1, 'Exactamente 1 AuditLog nuevo para la entidad');
    const newAudit = postAuditForEntity[postAuditForEntity.length - 1];
    checkEqual(newAudit.userId, refAuth.userId, 'UserId local correcto en AuditLog');

    const beforeObj = JSON.parse(newAudit.beforeJson) as { ticketId: number, pos: number }[];
    const afterObj = JSON.parse(newAudit.afterJson) as { ticketId: number, pos: number }[];
    checkEqual(beforeObj.length, afterObj.length + 1, 'afterJson tiene un elemento menos que beforeJson');
    check(beforeObj.some(x => x.ticketId === rank.ticketId), 'ticketId eliminado esta en beforeJson');
    check(!afterObj.some(x => x.ticketId === rank.ticketId), 'ticketId eliminado NO esta en afterJson');
    afterObj.forEach((x, idx) => checkEqual(x.pos, idx + 1, 'afterJson rankPosition 1..N consecutivo'));

    // Capturar DB completas justo despues del 1er delete
    const postDelRankingRows = db.prepare('SELECT * FROM TicketRanking ORDER BY id ASC').all();
    const postDelAuditRows = db.prepare('SELECT * FROM AuditLog ORDER BY id ASC').all();
    const postDelRankingHash = hashRows(postDelRankingRows);
    const postDelAuditHash = hashRows(postDelAuditRows);

    // SEGUNDO DELETE -> NO-OP
    const del2 = await fetchWithAuth(`/api/rankings/${rank.ticketId}`, refAuth.cookie, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sector: rank.sectorName })
    });
    checkEqual(del2.status, 200, 'Segundo DELETE status HTTP 200');
    const del2Data = await del2.json();
    checkEqual(del2Data.changed, false, 'Segundo DELETE es NO-OP');

    // Comprobar inmutabilidad total post NO-OP con lecturas fresquitas
    const noOpObj = db.prepare('SELECT * FROM TicketRanking WHERE id = ?').get(rank.id) as { updatedAt: string };
    checkEqual(noOpObj.updatedAt, updatedObj.updatedAt, 'updatedAt inmutable ante NO-OP');

    const noOpAllRanking = db.prepare('SELECT * FROM TicketRanking ORDER BY id ASC').all();
    checkEqual(hashRows(noOpAllRanking), postDelRankingHash, 'TicketRanking completo inmutable ante NO-OP');

    const noOpAllAudit = db.prepare('SELECT * FROM AuditLog ORDER BY id ASC').all();
    checkEqual(hashRows(noOpAllAudit), postDelAuditHash, 'AuditLog inmutable ante NO-OP');
  }

  console.log('[Test] Cross-filter');
  const firstTechFilter = metaData.technicians[0]?.id;
  check(Number.isSafeInteger(firstTechFilter), 'Technician ID is not a safe integer');

  // period+view+tech
  const cf1 = await fetchWithAuth(`/api/tickets?period=month&view=history&technicianId=${firstTechFilter}`, coordAuth.cookie);
  checkEqual(cf1.status, 200, 'Cross filter period+view+tech tickets');
  const cf1Data = await cf1.json() as { total: number, tickets: { ticketId: number }[] };

  const cf1Metrics = await fetchWithAuth(`/api/metrics/coordinator?period=month&view=history&technicianId=${firstTechFilter}`, coordAuth.cookie);
  checkEqual(cf1Metrics.status, 200, 'Cross filter period+view+tech metrics');
  const cf1MetricsData = await cf1Metrics.json() as { kpis: { resueltos: number, cerrados: number } };

  const historyTotal = cf1MetricsData.kpis.resueltos + cf1MetricsData.kpis.cerrados;
  checkEqual(cf1Data.total, historyTotal, 'Tickets view=history matches resueltos+cerrados KPI');

  // byStatus sum
  const cf2Metrics = await fetchWithAuth(`/api/metrics/coordinator?period=week&technicianId=${firstTechFilter}`, coordAuth.cookie);
  checkEqual(cf2Metrics.status, 200, 'Cross filter byStatus metrics');
  const cf2MetricsData = await cf2Metrics.json() as { byStatus: { count: number }[] };
  const cf2 = await fetchWithAuth(`/api/tickets?period=week&technicianId=${firstTechFilter}`, coordAuth.cookie);
  const cf2Data = await cf2.json() as { total: number };
  const byStatusSum = cf2MetricsData.byStatus.reduce((acc, x) => acc + x.count, 0);
  checkEqual(cf2Data.total, byStatusSum, 'Total from tickets matches sum of byStatus.count');

  // unassignedTechnician total vs list
  const cf3 = await fetchWithAuth('/api/tickets?period=day&unassignedTechnician=true', coordAuth.cookie);
  const cf3Data = await cf3.json() as { total: number };
  const cf3Metrics = await fetchWithAuth('/api/metrics/coordinator?period=day&unassignedTechnician=true', coordAuth.cookie);
  const cf3MetricsData = await cf3Metrics.json() as { byStatus: { count: number }[] };
  const cf3StatusSum = cf3MetricsData.byStatus.reduce((acc, x) => acc + x.count, 0);
  checkEqual(cf3Data.total, cf3StatusSum, 'Unassigned tickets matches sum of byStatus.count');

  // open vs status=5 -> total 0
  const cf4 = await fetchWithAuth(`/api/tickets?view=open&status=5`, coordAuth.cookie);
  const cf4Data = await cf4.json() as { total: number };
  checkEqual(cf4Data.total, 0, 'estado incompatible con view -> total 0 (status=5 y view=open)');

  console.log('[Test] TÃ©cnico CanÃ³nico Negativos');
  // Julian 231 is excluded in code. Check 403
  const metricsJulian = await fetchWithAuth('/api/metrics/coordinator?technicianId=231', coordAuth.cookie);
  checkEqual(metricsJulian.status, 403, 'TÃ©cnico 231 devuelve 403');

  const techUnassigned = await fetchWithAuth(`/api/metrics/coordinator?technicianId=${firstTechFilter}&unassignedTechnician=true`, coordAuth.cookie);
  checkEqual(techUnassigned.status, 400, 'technicianId + unassigned = 400');

  console.log('[TEARDOWN] Verificando hashes post-ejecuciÃ³n');
  const integrity2 = db.pragma('integrity_check', { simple: true });
  checkEqual(integrity2, 'ok', 'Integridad de DB fallida al final');

  const finalActiveHash = getFileHash(activeDb);
  checkEqual(initialActiveHash, finalActiveHash, 'LA BASE ACTIVA FUE MUTADA! GRAVE!');
}

runTests().then(() => {
  console.log(`[PASS] Completado. Controles: ${checksPassed}`);
}).catch(err => {
  console.error(err.message);
  process.exitCode = 1;
}).finally(() => {
  if (db) db.close();
  console.log(`[END] Hash QA DB final: ${getFileHash(absoluteDb)}`);
});
