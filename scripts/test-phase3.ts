import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';

process.exitCode = 0;

type SqliteDatabase = InstanceType<typeof Database>;

type FormatDateModule = typeof import('../lib/formatDate');
const requireForTest = createRequire(import.meta.url);
const {
  formatDateFunctional,
  formatDateAudit,
  formatDateRange,
} = requireForTest('../lib/formatDate.ts') as FormatDateModule;

const EXTERNAL_SERVER_URL = process.env.APPGLPI_TEST_EXTERNAL_SERVER_URL;
const DB_PATH = process.env.APPGLPI_TEST_DB_PATH;

if (!EXTERNAL_SERVER_URL || !DB_PATH) {
  console.error('Faltan variables de entorno requeridas.');
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

let db: SqliteDatabase | null = null;
let checksPassed = 0;

function check(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`AserciÃ³n fallida: ${message}`);
  }
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

async function loginAndGetCookie(username: string, pass: string, expectedRole: string): Promise<{ cookie: string, role: string }> {
  const res = await fetch(`${EXTERNAL_SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: pass }),
  });
  checkEqual(res.status, 200, `Login fallido para ${username}`);
  const rawCookie = res.headers.get('set-cookie');
  check(!!rawCookie, 'Falta cookie');
  const cookie = rawCookie!.split(';')[0] || '';

  const meRes = await fetch(`${EXTERNAL_SERVER_URL}/api/auth/me`, { headers: { Cookie: cookie } });
  checkEqual(meRes.status, 200, `Auth/me fallido para ${username}`);
  const meData = (await meRes.json()) as { role: string };
  checkEqual(meData.role, expectedRole, `Rol incorrecto para ${username}`);

  return { cookie, role: meData.role };
}

async function fetchWithAuth(apiPath: string, cookie: string, options: RequestInit = {}) {
  return fetch(`${EXTERNAL_SERVER_URL}${apiPath}`, {
    ...options,
    headers: { ...options.headers, Cookie: cookie },
  });
}

async function fetchJsonWithAuth<T>(url: string, cookie: string, expectedStatus = 200): Promise<T> {
  const res = await fetchWithAuth(url, cookie);
  checkEqual(res.status, expectedStatus, `Error HTTP en ${url}. Se esperaba ${expectedStatus}, recibido ${res.status}`);
  return (await res.json()) as T;
}

interface TicketPayload {
  ticketId: number;
  title: string;
  status: number;
  coordination?: unknown;
}

interface TicketsResponse {
  total: number;
  pages: number;
  tickets?: TicketPayload[];
}

interface ReferentMetricsResponse {
  kpis: { ingresados: number, backlog: number, conRanking: number, sinRanking: number };
  byStatus: { id: number, label: string, count: number }[];
  bySector: { id: number | null, name: string, count: number }[];
  periodRange: { start: string, end: string };
}

interface SupervisorMetricsResponse {
  kpis: { ingresados: number, backlog: number, conPrioridad: number, avancePromedio: number, tprVencida: number };
  requesterOptions: { id: number, name: string }[];
  byRequester: { id: number, name: string, count: number }[];
  periodRange: { start: string, end: string };
}

interface CoordinatorMetricsResponse {
  kpis: {
    ingresados: number;
    backlog: number;
    nuevos: number;
    enCurso: number;
    planificados: number;
    espera: number;
    resueltos: number;
    cerrados: number;
    conRanking: number;
    avancePromedio: number;
    etaVencida: number;
  };
  byTechnician: { id: number | 'unassigned', name: string, count: number }[];
  periodRange: { start: string, end: string };
}

type DbRanking = { id: number, ticketId: number, sectorName: string, rankPosition: number, createdByUserId: number, updatedByUserId: number, createdAt: string, updatedAt: string, isActive: number };
type DbAuditLog = { id: number, userId: number, action: string, entityType: string, entityId: string, beforeJson: string | null, afterJson: string | null, createdAt: string };

async function runTests() {
  try {
    db = new Database(absoluteDb, { readonly: true, fileMustExist: true });

    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    checkEqual(integrity.integrity_check, 'ok', 'La base de datos QA no superÃ³ el integrity_check.');

    const authMauro = await loginAndGetCookie('coordinator_demo', 'coordinator_demo123', 'coordinador_sistemas');
    const authJulian = await loginAndGetCookie('julianc', 'julianc123', 'referente');
    const authCarolina = await loginAndGetCookie('carolinar', 'carolinar123', 'supervisor');
    const authAdmin = await loginAndGetCookie('admin', 'admin123', 'admin');

    // A. Fechas
    checkEqual(formatDateFunctional('2026-07-15'), '15-07-2026', 'Fechas funcionales fallan');
    checkEqual(formatDateAudit('2026-07-15 10:00:00'), '15-07-2026 10:00', 'Fechas audit fallan');
    checkEqual(formatDateRange('2026-07-01 00:00:00', '2026-08-01 00:00:00'), '01-07-2026 al 31-07-2026', 'Fechas range fallan');

    // B. Validaciones sin escritura
    let res = await fetchWithAuth('/api/tickets?view=history', authJulian.cookie);
    checkEqual(res.status, 400, 'Referente viendo historial no rechazado');
    res = await fetchWithAuth('/api/tickets?status=5', authJulian.cookie);
    checkEqual(res.status, 400, 'Referente status=5 no rechazado');
    res = await fetchWithAuth('/api/metrics/referent?status=6', authJulian.cookie);
    checkEqual(res.status, 400, 'Referente metrics status=6 no rechazado');

    res = await fetchWithAuth('/api/metrics/supervisor?requester=231', authCarolina.cookie);
    checkEqual(res.status, 403, 'Supervisora consultando requester fuera de su equipo no bloqueado');

    const group30Row = db.prepare(`SELECT userId FROM GlpiUserGroupMembership WHERE groupId = 30`).all() as { userId: number }[];
    const group30Ids = group30Row.map(r => r.userId);
    check(group30Ids.length > 0, 'No hay miembros del grupo 30 en QA');

    let externalTechId: number | null = null;
    const namedExternalTech = db.prepare(`SELECT glpiUserId FROM GlpiUserCache WHERE (displayName = 'Joel Lugo' OR displayName = 'Guillermo Kunz') AND isActive = 1 AND glpiUserId NOT IN (${group30Ids.join(',')}) LIMIT 1`).get() as { glpiUserId: number } | undefined;
    if (namedExternalTech) {
      externalTechId = namedExternalTech.glpiUserId;
    } else {
      const anyExternal = db.prepare(`SELECT glpiUserId FROM GlpiUserCache WHERE isActive = 1 AND glpiUserId NOT IN (${group30Ids.join(',')}) LIMIT 1`).get() as { glpiUserId: number } | undefined;
      if (anyExternal) externalTechId = anyExternal.glpiUserId;
    }

    check(externalTechId !== null, 'No se encontrÃ³ un tÃ©cnico externo activo vÃ¡lido para pruebas');
    res = await fetchWithAuth(`/api/metrics/coordinator?technicianId=${externalTechId}`, authMauro.cookie);
    checkEqual(res.status, 403, 'Coordinador tÃ©cnico externo no bloqueado');

    const invalidIds = ['0', '1abc', '1.5', ''];
    for (const id of invalidIds) {
      res = await fetchWithAuth(`/api/tickets?technicianId=${id}`, authMauro.cookie);
      checkEqual(res.status, 400, `technicianId invÃ¡lido no rechazado: ${id}`);
      res = await fetchWithAuth(`/api/tickets?requesterId=${id}`, authMauro.cookie);
      checkEqual(res.status, 400, `requesterId invÃ¡lido no rechazado: ${id}`);
    }

    res = await fetchWithAuth('/api/tickets?isActiveRanking=', authMauro.cookie);
    checkEqual(res.status, 400, 'Booleano vacÃ­o en isActiveRanking no rechazado');
    res = await fetchWithAuth('/api/tickets?isUnranked=abc', authMauro.cookie);
    checkEqual(res.status, 400, 'Booleano invÃ¡lido en isUnranked no rechazado');

    res = await fetchWithAuth('/api/tickets?technicianId=100&unassignedTechnician=true', authMauro.cookie);
    checkEqual(res.status, 400, 'technicianId y unassignedTechnician simultÃ¡neos no rechazados');

    res = await fetchWithAuth('/api/tickets?isActiveRanking=true&isUnranked=true', authMauro.cookie);
    checkEqual(res.status, 400, 'isActiveRanking y isUnranked simultÃ¡neos no rechazados');

    res = await fetchWithAuth('/api/tickets?notes=test', authJulian.cookie);
    checkEqual(res.status, 403, 'Referente pudo buscar por notes');
    res = await fetchWithAuth('/api/tickets?comments=test', authCarolina.cookie);
    checkEqual(res.status, 200, 'Supervisora no pudo consultar comentarios pÃºblicos');

    // C. MÃ©tricas Exactas
    // C.1 Referente
    const refMetrics = await fetchJsonWithAuth<ReferentMetricsResponse>('/api/metrics/referent', authJulian.cookie);
    check(refMetrics.byStatus.every(s => [1,2,3,4].includes(s.id)), 'Referente byStatus contains 5 or 6');
    checkEqual(
      refMetrics.kpis.conRanking + refMetrics.kpis.sinRanking,
      refMetrics.kpis.backlog,
      'Ranking + sinRanking !== backlog en Referente'
    );
    const allowedSectors = [15, 55, 14, 36];
    check(refMetrics.bySector.every(s => s.id === null || allowedSectors.includes(s.id)), 'Sectores invÃ¡lidos para referente en bySector');

    const sqlRefBacklog = db.prepare(`SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1 AND detectedSectorGroupId IN (${allowedSectors.join(',')}) AND status IN (1,2,3,4)`).get() as { c: number };
    checkEqual(refMetrics.kpis.backlog, sqlRefBacklog.c, 'Referente backlog SQL mismatch');
    const sqlRefRanked = db.prepare(`SELECT COUNT(DISTINCT t.ticketId) as c FROM GlpiTicketCache t JOIN TicketRanking r ON t.ticketId = r.ticketId WHERE t.isSistemasScope = 1 AND t.detectedSectorGroupId IN (${allowedSectors.join(',')}) AND t.status IN (1,2,3,4) AND r.isActive = 1`).get() as { c: number };
    checkEqual(refMetrics.kpis.conRanking, sqlRefRanked.c, 'Referente conRanking SQL mismatch');
    const sqlRefSinRank = db.prepare(`SELECT COUNT(DISTINCT t.ticketId) as c FROM GlpiTicketCache t LEFT JOIN TicketRanking r ON t.ticketId = r.ticketId AND r.isActive = 1 WHERE t.isSistemasScope = 1 AND t.detectedSectorGroupId IN (${allowedSectors.join(',')}) AND t.status IN (1,2,3,4) AND r.id IS NULL`).get() as { c: number };
    checkEqual(refMetrics.kpis.sinRanking, sqlRefSinRank.c, 'Referente sinRanking SQL mismatch');

    // C.2 Supervisor
    const supMetrics = await fetchJsonWithAuth<SupervisorMetricsResponse>('/api/metrics/supervisor', authCarolina.cookie);

    const impGroupIds = [15];
    const impRefs = db.prepare(`
      SELECT u.glpiUserId
      FROM User u
      JOIN UserSectorScope s ON s.userId = u.id
      WHERE u.role = 'referente'
        AND u.isActive = 1
        AND u.glpiUserId IS NOT NULL
        AND s.glpiGroupId IN (${impGroupIds.join(',')})
    `).all() as { glpiUserId: number }[];
    const impRefIds = impRefs.map(r => r.glpiUserId);

    const impMembers = db.prepare(`SELECT userId FROM GlpiUserGroupMembership WHERE groupId IN (${impGroupIds.join(',')})`).all() as { userId: number }[];
    const impValidIds = impMembers.map(m => m.userId).filter(id => !impRefIds.includes(id));
    const activeReqDB = db.prepare(`SELECT glpiUserId, displayName FROM GlpiUserCache WHERE glpiUserId IN (${impValidIds.join(',')}) AND isActive = 1`).all() as { glpiUserId: number, displayName: string }[];

    checkEqual(supMetrics.requesterOptions.length, activeReqDB.length, 'Cantidad de requesterOptions no coincide con SQL');
    checkEqual(supMetrics.byRequester.length, activeReqDB.length, 'Cantidad de byRequester no coincide con el equipo');

    for (const req of activeReqDB) {
      const optItem = supMetrics.requesterOptions.find(o => o.id === req.glpiUserId);
      check(optItem !== undefined, `requesterOptions no incluye al usuario ${req.displayName}`);
      checkEqual(optItem!.name, req.displayName, `Nombre de requesterOptions difiere para ${req.displayName}`);

      const rqItem = supMetrics.byRequester.find(r => r.id === req.glpiUserId);
      check(rqItem !== undefined, `byRequester no incluye a ${req.displayName}`);
      checkEqual(rqItem!.name, req.displayName, `Nombre de byRequester difiere para ${req.displayName}`);

      const sqlReqCnt = db.prepare(`SELECT COUNT(DISTINCT t.ticketId) as c FROM GlpiTicketCache t JOIN GlpiTicketUserActor a ON t.ticketId = a.ticketId WHERE t.isSistemasScope = 1 AND t.detectedSectorGroupId = 15 AND t.openedAt >= ? AND t.openedAt < ? AND a.actorType = 1 AND a.glpiUserId = ?`).get(supMetrics.periodRange.start, supMetrics.periodRange.end, req.glpiUserId) as { c: number };
      checkEqual(rqItem!.count, sqlReqCnt.c, `byRequester count no coincide por SQL para ${req.displayName}`);
    }

    const sqlSupBacklog = db.prepare(`SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1 AND detectedSectorGroupId = 15 AND status IN (1,2,3,4)`).get() as { c: number };
    checkEqual(supMetrics.kpis.backlog, sqlSupBacklog.c, 'Supervisor backlog SQL mismatch');
    const sqlSupConPrioridad = db.prepare(`SELECT COUNT(DISTINCT t.ticketId) as c FROM GlpiTicketCache t JOIN TicketRanking r ON t.ticketId = r.ticketId WHERE t.isSistemasScope = 1 AND t.detectedSectorGroupId = 15 AND t.status IN (1,2,3,4) AND r.isActive = 1 AND r.sectorName = 'Impuestos'`).get() as { c: number };
    checkEqual(supMetrics.kpis.conPrioridad, sqlSupConPrioridad.c, 'Supervisor conPrioridad SQL mismatch');
    checkEqual(supMetrics.kpis.conPrioridad, 3, 'Supervisor conPrioridad no es 3 en esta foto de base de datos de test');

    const supervisorBacklogRows = db.prepare(`
      SELECT
        c.progressPercent,
        c.estimatedDeliveryDate
      FROM GlpiTicketCache t
      LEFT JOIN TicketCoordination c ON c.ticketId = t.ticketId
      WHERE t.isSistemasScope = 1 AND t.detectedSectorGroupId = 15 AND t.status IN (1,2,3,4)
    `).all() as { progressPercent: number | null, estimatedDeliveryDate: string | null }[];

    const expectedAvancePromedio = supervisorBacklogRows.length > 0
      ? Math.round(
          supervisorBacklogRows.reduce(
            (sum, row) => sum + (row.progressPercent ?? 0),
            0
          ) / supervisorBacklogRows.length
        )
      : 0;

    const todayStr = new Date().toLocaleDateString(
      'sv-SE',
      { timeZone: 'America/Argentina/Buenos_Aires' }
    );

    const expectedTprVencida = supervisorBacklogRows.filter(
      row =>
        row.estimatedDeliveryDate !== null &&
        row.estimatedDeliveryDate < todayStr
    ).length;

    checkEqual(supMetrics.kpis.avancePromedio, expectedAvancePromedio, 'Supervisor avancePromedio SQL mismatch');
    checkEqual(supMetrics.kpis.tprVencida, expectedTprVencida, 'Supervisor tprVencida SQL mismatch');

    const supM = await fetchJsonWithAuth<SupervisorMetricsResponse>('/api/metrics/supervisor?period=month', authCarolina.cookie);
    const supD = await fetchJsonWithAuth<SupervisorMetricsResponse>('/api/metrics/supervisor?period=day', authCarolina.cookie);
    checkEqual(supM.kpis.backlog, supD.kpis.backlog, 'Supervisor Backlog varÃ­a por periodo');
    checkEqual(supM.kpis.conPrioridad, supD.kpis.conPrioridad, 'Supervisor conPrioridad varÃ­a por periodo');
    checkEqual(supM.kpis.avancePromedio, supD.kpis.avancePromedio, 'Supervisor avancePromedio varÃ­a por periodo');
    checkEqual(supM.kpis.tprVencida, supD.kpis.tprVencida, 'Supervisor tprVencida varÃ­a por periodo');

    // C.3 Coordinador
    const coordMetrics = await fetchJsonWithAuth<CoordinatorMetricsResponse>('/api/metrics/coordinator', authMauro.cookie);
    const activeTechsDB = db.prepare(`SELECT glpiUserId, displayName FROM GlpiUserCache WHERE glpiUserId IN (${group30Ids.join(',')}) AND isActive = 1 AND glpiUserId != 231 AND displayName NOT IN ('Joel Lugo', 'Guillermo Kunz')`).all() as { glpiUserId: number, displayName: string }[];

    check(activeTechsDB.length >= 9, 'La fotografÃ­a QA debe tener los tÃ©cnicos esperados excluyendo excepciones');

    checkEqual(coordMetrics.byTechnician.length, activeTechsDB.length + 1, 'Cantidad de barras byTechnician incorrecta');

    for (const tech of activeTechsDB) {
      const item = coordMetrics.byTechnician.find(t => t.id === tech.glpiUserId);
      check(item !== undefined, `Coordinador no incluye al tÃ©cnico activo ${tech.displayName}`);
      checkEqual(item!.name, tech.displayName, `Nombre de tÃ©cnico difiere para ${tech.displayName}`);

      const sqlTechCnt = db.prepare(`
        SELECT COUNT(*) as c FROM (
          SELECT t.ticketId, (
            SELECT a.glpiUserId
            FROM GlpiTicketUserActor a
            WHERE a.ticketId = t.ticketId AND a.actorType = 2 AND a.glpiUserId IN (${activeTechsDB.map(r => r.glpiUserId).join(',')})
            ORDER BY a.id ASC
            LIMIT 1
          ) as canonicalTech
          FROM GlpiTicketCache t
          WHERE t.isSistemasScope = 1 AND (
            (t.status IN (1,2,3,4) AND t.openedAt >= ? AND t.openedAt < ?) OR
            (t.status = 5 AND t.solvedAt >= ? AND t.solvedAt < ?) OR
            (t.status = 6 AND t.closedAt >= ? AND t.closedAt < ?)
          )
        ) WHERE canonicalTech = ?
      `).get(
        coordMetrics.periodRange.start, coordMetrics.periodRange.end,
        coordMetrics.periodRange.start, coordMetrics.periodRange.end,
        coordMetrics.periodRange.start, coordMetrics.periodRange.end,
        tech.glpiUserId
      ) as { c: number };
      checkEqual(item!.count, sqlTechCnt.c, `Conteo de byTechnician no coincide para ${tech.displayName}`);
    }

    const sinAsignarItem = coordMetrics.byTechnician.find(item => item.id === 'unassigned');
    check(sinAsignarItem !== undefined, 'Falta Sin asignar en byTechnician');
    checkEqual(sinAsignarItem!.name, 'Sin asignar', 'Nombre Sin asignar difiere');

    const activeTechIdsStr = activeTechsDB.map(r => r.glpiUserId).join(',');
    const sqlUnassigned = db.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT t.ticketId, (
          SELECT a.glpiUserId
          FROM GlpiTicketUserActor a
          WHERE a.ticketId = t.ticketId AND a.actorType = 2 AND a.glpiUserId IN (${activeTechIdsStr})
          ORDER BY a.id ASC
          LIMIT 1
        ) as canonicalTech
        FROM GlpiTicketCache t
        WHERE t.isSistemasScope = 1 AND (
            (t.status IN (1,2,3,4) AND t.openedAt >= ? AND t.openedAt < ?) OR
            (t.status = 5 AND t.solvedAt >= ? AND t.solvedAt < ?) OR
            (t.status = 6 AND t.closedAt >= ? AND t.closedAt < ?)
        )
      ) WHERE canonicalTech IS NULL
    `).get(
      coordMetrics.periodRange.start, coordMetrics.periodRange.end,
      coordMetrics.periodRange.start, coordMetrics.periodRange.end,
      coordMetrics.periodRange.start, coordMetrics.periodRange.end
    ) as { cnt: number };
    checkEqual(sinAsignarItem!.count, sqlUnassigned.cnt, 'SQL error in Sin asignar count');

    // D. Drill-down
    const refStart = refMetrics.periodRange.start;
    const refEnd = refMetrics.periodRange.end;
    let data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?view=open&from=${refStart}&toExclusive=${refEnd}`, authJulian.cookie);
    checkEqual(data.total, refMetrics.kpis.ingresados, 'Referente drill-down Ingresados');
    data = await fetchJsonWithAuth<TicketsResponse>('/api/tickets?view=open', authJulian.cookie);
    checkEqual(data.total, refMetrics.kpis.backlog, 'Referente drill-down Backlog');
    data = await fetchJsonWithAuth<TicketsResponse>('/api/tickets?view=open&isActiveRanking=true', authJulian.cookie);
    checkEqual(data.total, refMetrics.kpis.conRanking, 'Referente drill-down Con prioridad');
    data = await fetchJsonWithAuth<TicketsResponse>('/api/tickets?view=open&isUnranked=true', authJulian.cookie);
    checkEqual(data.total, refMetrics.kpis.sinRanking, 'Referente drill-down Sin prioridad');

    const supStart = supMetrics.periodRange.start;
    const supEnd = supMetrics.periodRange.end;
    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?from=${supStart}&toExclusive=${supEnd}`, authCarolina.cookie);
    checkEqual(data.total, supMetrics.kpis.ingresados, 'Supervisor drill-down Ingresados');
    data = await fetchJsonWithAuth<TicketsResponse>('/api/tickets?view=open', authCarolina.cookie);
    checkEqual(data.total, supMetrics.kpis.backlog, 'Supervisor drill-down Backlog');
    data = await fetchJsonWithAuth<TicketsResponse>('/api/tickets?view=open&isActiveRanking=true', authCarolina.cookie);
    checkEqual(data.total, supMetrics.kpis.conPrioridad, 'Supervisor drill-down Con prioridad');
    data = await fetchJsonWithAuth<TicketsResponse>('/api/tickets?view=open&tprVencida=true', authCarolina.cookie);
    checkEqual(data.total, supMetrics.kpis.tprVencida, 'Supervisor drill-down TPR Vencida');

    res = await fetchWithAuth('/api/tickets?tprVencida=', authCarolina.cookie);
    checkEqual(res.status, 400, 'tprVencida vacÃ­o no rechazado');
    res = await fetchWithAuth('/api/tickets?tprVencida=yes', authCarolina.cookie);
    checkEqual(res.status, 400, 'tprVencida invÃ¡lido no rechazado');

    check(supMetrics.byRequester.length > 0, 'No hay solicitantes en byRequester para drill-down');
    const supervisorRequesterId = supMetrics.byRequester[0].id;
    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?requesterId=${supervisorRequesterId}&from=${supStart}&toExclusive=${supEnd}`, authCarolina.cookie);
    checkEqual(data.total, supMetrics.byRequester[0].count, 'Supervisor drill-down Solicitante');

    const coordStart = coordMetrics.periodRange.start;
    const coordEnd = coordMetrics.periodRange.end;
    const coordIngKPI = await fetchJsonWithAuth<CoordinatorMetricsResponse>(`/api/metrics/coordinator?status=1`, authMauro.cookie);
    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?status=1&from=${coordStart}&toExclusive=${coordEnd}`, authMauro.cookie);
    checkEqual(data.total, coordIngKPI.kpis.nuevos, 'Coordinador drill-down Estado 1 (nuevos)');
    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?unassignedTechnician=true&from=${coordStart}&toExclusive=${coordEnd}`, authMauro.cookie);
    checkEqual(data.total, sinAsignarItem!.count, 'Coordinador drill-down Sin asignar');

    check(activeTechsDB.length > 0, 'No hay tÃ©cnicos en activeTechsDB para probar drill-down');
    const realTechId = activeTechsDB[0].glpiUserId;
    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?technicianId=${realTechId}&from=${coordStart}&toExclusive=${coordEnd}`, authMauro.cookie);
    const techBar = coordMetrics.byTechnician.find(t => t.id === realTechId);
    checkEqual(data.total, techBar!.count, 'Coordinador drill-down tÃ©cnico especÃ­fico');

    // E. BÃºsqueda avanzada sin skips
    const dbSistemasTicket = db.prepare(`
      SELECT
        t.ticketId,
        t.detectedSectorGroupId,
        a1.glpiUserId AS reqId,
        (
          SELECT a2.glpiUserId
          FROM GlpiTicketUserActor a2
          WHERE a2.ticketId = t.ticketId
            AND a2.actorType = 2
            AND a2.glpiUserId IN (${activeTechIdsStr})
          ORDER BY a2.id ASC
          LIMIT 1
        ) AS techId
      FROM GlpiTicketCache t
      JOIN GlpiTicketUserActor a1
        ON a1.ticketId = t.ticketId
       AND a1.actorType = 1
      WHERE t.isSistemasScope = 1
        AND t.detectedSectorGroupId IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM GlpiTicketUserActor a2
          WHERE a2.ticketId = t.ticketId
            AND a2.actorType = 2
            AND a2.glpiUserId IN (${activeTechIdsStr})
        )
      ORDER BY t.ticketId ASC, a1.id ASC
      LIMIT 1
    `).get() as { ticketId: number, detectedSectorGroupId: number, reqId: number, techId: number } | undefined;

    check(dbSistemasTicket !== undefined, 'No hay tickets de sistemas aptos para prueba avanzada en BD');

    const { ticketId, detectedSectorGroupId, reqId: advancedRequesterId, techId } = dbSistemasTicket!;
    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?ticketId=${ticketId}`, authMauro.cookie);
    checkEqual(data.total, 1, 'Advanced filter ticketId fallÃ³ (total!==1)');
    check(data.tickets !== undefined && data.tickets[0].ticketId === ticketId, 'Advanced filter ticketId no coincide id');

    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?technicianId=${techId}`, authMauro.cookie);
    check(data.total > 0, 'Advanced filter techId failed');
    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?requesterId=${advancedRequesterId}`, authMauro.cookie);
    check(data.total > 0, 'Advanced filter reqId failed');
    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?sectorGroupId=${detectedSectorGroupId}`, authMauro.cookie);
    check(data.total > 0, 'Advanced filter sectorGroupId failed');

    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?ticketId=${ticketId}&technicianId=${techId}&requesterId=${advancedRequesterId}&sectorGroupId=${detectedSectorGroupId}`, authMauro.cookie);
    checkEqual(data.total, 1, 'Advanced filter AND combination fallÃ³ (total!==1)');
    check(data.tickets !== undefined && data.tickets[0].ticketId === ticketId, 'Advanced filter AND no devolviÃ³ ticket correcto');

    const otherSector = db.prepare(`SELECT detectedSectorGroupId FROM GlpiTicketCache WHERE isSistemasScope = 1 AND detectedSectorGroupId IS NOT NULL AND detectedSectorGroupId != ? LIMIT 1`).get(detectedSectorGroupId) as { detectedSectorGroupId: number } | undefined;
    check(otherSector !== undefined, 'No hay otro sector disponible para la prueba de filtro AND fallido');
    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?ticketId=${ticketId}&technicianId=${techId}&requesterId=${advancedRequesterId}&sectorGroupId=${otherSector!.detectedSectorGroupId}`, authMauro.cookie);
    checkEqual(data.total, 0, 'Advanced filter missing 0 result');

    // F. Notas, comentarios y privacidad
    const noteRow = db.prepare(`
      SELECT t.ticketId, f.contentPlain
      FROM GlpiFollowupCache f
      JOIN GlpiTicketCache t ON t.ticketId = f.ticketId
      WHERE f.isPrivate = 1
        AND f.contentPlain IS NOT NULL
        AND length(f.contentPlain) > 20
        AND t.isSistemasScope = 1
        AND t.detectedSectorGroupId = 15
        AND t.status IN (1,2,3,4)
      LIMIT 1
    `).get() as { ticketId: number, contentPlain: string } | undefined;

    check(noteRow !== undefined, 'No hay notas privadas en Impuestos/Sistemas para prueba (activos)');

    const words = noteRow!.contentPlain.split(' ').filter(w => w.length > 5);
    check(words.length > 0, 'La nota privada no contiene palabras Ãºtiles');
    const searchWord = words[0];

    const checkPublicExposed = db.prepare(`
      SELECT COUNT(*) as c
      FROM GlpiTicketCache
      WHERE ticketId = ?
      AND (title LIKE ? OR contentPlain LIKE ?)
    `).get(noteRow!.ticketId, `%${searchWord}%`, `%${searchWord}%`) as { c: number };
    checkEqual(checkPublicExposed.c, 0, 'La palabra de nota privada aparece en tÃ­tulo o contentPlain pÃºblicos');

    const checkFollowupsExposed = db.prepare(`
      SELECT COUNT(*) as c
      FROM GlpiFollowupCache
      WHERE ticketId = ? AND isPrivate = 0 AND contentPlain LIKE ?
    `).get(noteRow!.ticketId, `%${searchWord}%`) as { c: number };
    checkEqual(checkFollowupsExposed.c, 0, 'La nota privada aparece en followups pÃºblicos');

    const checkTasksExposed = db.prepare(`
      SELECT COUNT(*) as c
      FROM GlpiTaskCache
      WHERE ticketId = ? AND isPrivate = 0 AND contentPlain LIKE ?
    `).get(noteRow!.ticketId, `%${searchWord}%`) as { c: number };
    checkEqual(checkTasksExposed.c, 0, 'La nota privada aparece en tasks pÃºblicos');

    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?ticketId=${noteRow!.ticketId}&notes=${encodeURIComponent(searchWord)}`, authMauro.cookie);
    checkEqual(data.total, 1, 'Coordinador no encontrÃ³ 1 ticket exacto por notes');
    check(data.tickets !== undefined && data.tickets[0].ticketId === noteRow!.ticketId, 'Coordinador no encontrÃ³ el ticket id exacto por notes');

    const dataAdmin = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?ticketId=${noteRow!.ticketId}&notes=${encodeURIComponent(searchWord)}`, authAdmin.cookie);
    checkEqual(dataAdmin.total, 1, 'Admin no encontrÃ³ 1 ticket exacto por notes');

    const commentRow = db.prepare(`
      SELECT t.ticketId, c.contentPlain
      FROM GlpiTaskCache c
      JOIN GlpiTicketCache t ON t.ticketId = c.ticketId
      WHERE t.isSistemasScope = 1
        AND c.contentPlain IS NOT NULL
        AND length(c.contentPlain) > 20
      LIMIT 1
    `).get() as { ticketId: number, contentPlain: string } | undefined;
    check(commentRow !== undefined, 'No hay comentarios/tareas en BD para prueba');
    const cWords = commentRow!.contentPlain.split(' ').filter(w => w.length > 5);
    check(cWords.length > 0, 'El comentario no tiene palabras Ãºtiles');
    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?ticketId=${commentRow!.ticketId}&comments=${encodeURIComponent(cWords[0])}`, authMauro.cookie);
    checkEqual(data.total, 1, 'Coordinador no encontrÃ³ 1 ticket exacto por comments');
    check(data.tickets !== undefined && data.tickets[0].ticketId === commentRow!.ticketId, 'Coordinador no encontrÃ³ el ticket exacto por comentario');

    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?ticketId=${noteRow!.ticketId}&search=${encodeURIComponent(searchWord)}`, authJulian.cookie);
    checkEqual(data.total, 0, 'Referente pudo encontrar ticket por nota privada en search general');
    check(data.tickets === undefined || data.tickets.length === 0, 'Referente obtuvo ticket en array de bÃºsqueda de nota privada');

    data = await fetchJsonWithAuth<TicketsResponse>(`/api/tickets?ticketId=${noteRow!.ticketId}&search=${encodeURIComponent(searchWord)}`, authCarolina.cookie);
    checkEqual(data.total, 0, 'Supervisora pudo encontrar ticket por nota privada en search general');
    check(data.tickets === undefined || data.tickets.length === 0, 'Supervisora obtuvo ticket en array de bÃºsqueda de nota privada');

    // G. Privacidad del payload
    data = await fetchJsonWithAuth<TicketsResponse>('/api/tickets?view=open&limit=1', authJulian.cookie);
    check(data.tickets !== undefined && data.tickets.length > 0, 'No se obtuvieron tickets para revisar payload');
    const tk = data.tickets![0];
    check(!('followups' in tk), 'Propiedad followups serializada');
    check(!('tasks' in tk), 'Propiedad tasks serializada');
    check(!('internalNotes' in tk), 'Propiedad internalNotes serializada');
    check(!('privateFollowups' in tk), 'Propiedad privateFollowups serializada');
    check(!('privateTasks' in tk), 'Propiedad privateTasks serializada');

    // H. Ranking e invariantes SQLite
    const activeImpuestosBefore = db.prepare(`SELECT id, ticketId, sectorName, rankPosition, createdByUserId, updatedByUserId, createdAt, updatedAt, isActive FROM TicketRanking WHERE sectorName = 'Impuestos' AND isActive = 1 ORDER BY rankPosition ASC, id ASC`).all() as DbRanking[];
    check(activeImpuestosBefore.length >= 2, 'Se requieren al menos dos rankings de Impuestos activos para las pruebas');

    const inactiveImpuestosBefore = db.prepare(`SELECT id, ticketId, sectorName, rankPosition, createdByUserId, updatedByUserId, createdAt, updatedAt, isActive FROM TicketRanking WHERE sectorName = 'Impuestos' AND isActive = 0 ORDER BY id ASC`).all() as DbRanking[];

    const auditLogsBefore = db.prepare(`SELECT id, userId, action, entityType, entityId, beforeJson, afterJson, createdAt FROM AuditLog ORDER BY id ASC`).all() as DbAuditLog[];
    const rankingsOtherBefore = db.prepare(`SELECT id, ticketId, sectorName, rankPosition, createdByUserId, updatedByUserId, createdAt, updatedAt, isActive FROM TicketRanking WHERE sectorName != 'Impuestos' ORDER BY id ASC`).all() as DbRanking[];

    const orderImp = activeImpuestosBefore.map(r => r.ticketId);

    const activeImpuestosBeforeHash = hashRows(activeImpuestosBefore);
    const inactiveImpuestosBeforeHash = hashRows(inactiveImpuestosBefore);
    const auditLogsBeforeHash = hashRows(auditLogsBefore);
    const rankingsOtherBeforeHash = hashRows(rankingsOtherBefore);

    function assertRejectedOrNoOpIntact(msg: string) {
      const hAct = hashRows(db!.prepare(`SELECT id, ticketId, sectorName, rankPosition, createdByUserId, updatedByUserId, createdAt, updatedAt, isActive FROM TicketRanking WHERE sectorName = 'Impuestos' AND isActive = 1 ORDER BY rankPosition ASC, id ASC`).all());
      const hIna = hashRows(db!.prepare(`SELECT id, ticketId, sectorName, rankPosition, createdByUserId, updatedByUserId, createdAt, updatedAt, isActive FROM TicketRanking WHERE sectorName = 'Impuestos' AND isActive = 0 ORDER BY id ASC`).all());
      const hAud = hashRows(db!.prepare(`SELECT id, userId, action, entityType, entityId, beforeJson, afterJson, createdAt FROM AuditLog ORDER BY id ASC`).all());
      const hOth = hashRows(db!.prepare(`SELECT id, ticketId, sectorName, rankPosition, createdByUserId, updatedByUserId, createdAt, updatedAt, isActive FROM TicketRanking WHERE sectorName != 'Impuestos' ORDER BY id ASC`).all());

      checkEqual(hAct, activeImpuestosBeforeHash, `Rankings activos mutaron en fallo: ${msg}`);
      checkEqual(hIna, inactiveImpuestosBeforeHash, `Rankings inactivos mutaron en fallo: ${msg}`);
      checkEqual(hAud, auditLogsBeforeHash, `AuditLog mutÃ³ en fallo: ${msg}`);
      checkEqual(hOth, rankingsOtherBeforeHash, `Otros sectores mutaron en fallo: ${msg}`);
    }

    function assertProtectedRankingsIntact(msg: string) {
      const hIna = hashRows(db!.prepare(`SELECT id, ticketId, sectorName, rankPosition, createdByUserId, updatedByUserId, createdAt, updatedAt, isActive FROM TicketRanking WHERE sectorName = 'Impuestos' AND isActive = 0 ORDER BY id ASC`).all());
      const hOth = hashRows(db!.prepare(`SELECT id, ticketId, sectorName, rankPosition, createdByUserId, updatedByUserId, createdAt, updatedAt, isActive FROM TicketRanking WHERE sectorName != 'Impuestos' ORDER BY id ASC`).all());

      checkEqual(hIna, inactiveImpuestosBeforeHash, `Rankings inactivos mutaron en positivo: ${msg}`);
      checkEqual(hOth, rankingsOtherBeforeHash, `Otros sectores mutaron en positivo: ${msg}`);
    }

    // Carolina no autorizada
    res = await fetchWithAuth('/api/rankings/reorder', authCarolina.cookie, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sector: 'Impuestos', orderedTicketIds: orderImp })
    });
    checkEqual(res.status, 403, 'Carolina autorizada a POST reorder');
    res = await fetchWithAuth(`/api/rankings/${orderImp[0]}`, authCarolina.cookie, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sector: 'Impuestos', newPosition: 1 })
    });
    checkEqual(res.status, 403, 'Carolina autorizada a PATCH');
    assertRejectedOrNoOpIntact('Carolina probando permisos');

    // Casos negativos POST
    const historicTicket = db.prepare(`SELECT ticketId FROM GlpiTicketCache WHERE isSistemasScope = 1 AND detectedSectorGroupId = 15 AND status IN (5,6) LIMIT 1`).get() as { ticketId: number } | undefined;
    check(historicTicket !== undefined, 'No hay ticket histÃ³rico exacto (Sistemas, Impuestos, 5/6) para prueba negativa');
    const activeOtherSector = db.prepare(`SELECT t.ticketId FROM GlpiTicketCache t JOIN TicketRanking r ON t.ticketId = r.ticketId WHERE t.isSistemasScope = 1 AND t.status IN (1,2,3,4) AND r.isActive = 1 AND r.sectorName != 'Impuestos' LIMIT 1`).get() as { ticketId: number } | undefined;
    check(activeOtherSector !== undefined, 'No hay ticket exacto de otro sector (Sistemas, Activo, otro) para prueba negativa');

    const badOrders = [
      [...orderImp, orderImp[0]], // duplicado
      orderImp.slice(1), // incompleta
      [historicTicket!.ticketId, ...orderImp.slice(1)], // histÃ³rico
      [activeOtherSector!.ticketId, ...orderImp.slice(1)], // otro sector
    ];

    for (const bad of badOrders) {
      res = await fetchWithAuth('/api/rankings/reorder', authJulian.cookie, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sector: 'Impuestos', orderedTicketIds: bad })
      });
      checkEqual(res.status, 400, 'Mal orden POST no rechazado');
      assertRejectedOrNoOpIntact('Fallo de bad order POST');
    }

    // NO-OP Reorder
    res = await fetchWithAuth('/api/rankings/reorder', authJulian.cookie, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sector: 'Impuestos', orderedTicketIds: orderImp })
    });
    checkEqual(res.status, 200, 'Reorder idÃ©ntico POST fallido');
    const reorderNoOpData = (await res.json()) as { changed: boolean };
    checkEqual(reorderNoOpData.changed, false, 'Reorder idÃ©ntico POST devolviÃ³ changed true');
    assertRejectedOrNoOpIntact('NO-OP POST');

    // Casos positivos (PATCH)
    const ticketToMove = orderImp[1];
    res = await fetchWithAuth(`/api/rankings/${ticketToMove}`, authJulian.cookie, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sector: 'Impuestos', newPosition: 1 })
    });
    checkEqual(res.status, 200, 'PATCH ranking fallido');
    const patchData = (await res.json()) as { changed: boolean };
    checkEqual(patchData.changed, true, 'PATCH changed false');

    const patchRankings = db.prepare(`SELECT id, ticketId, sectorName, rankPosition, createdByUserId, updatedByUserId, createdAt, updatedAt, isActive FROM TicketRanking WHERE sectorName = 'Impuestos' AND isActive = 1 ORDER BY rankPosition ASC, id ASC`).all() as DbRanking[];
    checkEqual(patchRankings[0].ticketId, ticketToMove, 'Desplazamiento exacto PATCH fallido');
    for (let i = 0; i < patchRankings.length; i++) {
      checkEqual(patchRankings[i].rankPosition, i + 1, 'Posiciones no consecutivas en PATCH');
    }

    const patchAuditLogs = db.prepare(`SELECT id, userId, action, entityType, entityId, beforeJson, afterJson, createdAt FROM AuditLog ORDER BY id ASC`).all() as DbAuditLog[];
    checkEqual(patchAuditLogs.length, auditLogsBefore.length + 1, 'PATCH no creÃ³ exactamente 1 AuditLog');
    checkEqual(patchAuditLogs[patchAuditLogs.length - 1].action, 'ranking_position_change', 'AuditLog action mismatch PATCH');

    assertProtectedRankingsIntact('MutaciÃ³n ilegal detectada en sectores o inactivos durante PATCH');

    // Casos positivos (POST reorder)
    const postPatchOrder = patchRankings.map(r => r.ticketId);

    // Rotar para garantizar orden diferente
    const realNewOrder = [
      ...postPatchOrder.slice(1),
      postPatchOrder[0],
    ];
    check(JSON.stringify(realNewOrder) !== JSON.stringify(postPatchOrder), 'El nuevo orden generado para POST reorder no difiere del orden PATCH');

    res = await fetchWithAuth('/api/rankings/reorder', authJulian.cookie, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sector: 'Impuestos', orderedTicketIds: realNewOrder })
    });
    checkEqual(res.status, 200, 'POST reorder real fallido');
    const realReorderData = (await res.json()) as { changed: boolean };
    checkEqual(realReorderData.changed, true, 'POST reorder changed false');

    const realRankings = db.prepare(`SELECT id, ticketId, sectorName, rankPosition, createdByUserId, updatedByUserId, createdAt, updatedAt, isActive FROM TicketRanking WHERE sectorName = 'Impuestos' AND isActive = 1 ORDER BY rankPosition ASC, id ASC`).all() as DbRanking[];
    checkEqual(JSON.stringify(realRankings.map(r => r.ticketId)), JSON.stringify(realNewOrder), 'Orden final exacto fallido');
    for (let i = 0; i < realRankings.length; i++) {
      checkEqual(realRankings[i].rankPosition, i + 1, 'Posiciones no consecutivas en POST reorder');
    }

    const realAuditLogs = db.prepare(`SELECT id, userId, action, entityType, entityId, beforeJson, afterJson, createdAt FROM AuditLog ORDER BY id ASC`).all() as DbAuditLog[];
    checkEqual(realAuditLogs.length, patchAuditLogs.length + 1, 'POST reorder no creÃ³ exactamente 1 AuditLog adicional');
    checkEqual(realAuditLogs[realAuditLogs.length - 1].action, 'ranking_reorder', 'AuditLog action mismatch POST reorder');

    assertProtectedRankingsIntact('MutaciÃ³n ilegal detectada en sectores o inactivos durante POST reorder');

  } catch (err) {
    if (err instanceof Error) {
      console.error(err.message);
    } else {
      console.error('Error fatal', err);
    }
    process.exitCode = 1;
  } finally {
    if (db) db.close();
  }

  if (process.exitCode === 0) {
    console.log(`âœ… Todos los ${checksPassed} tests funcionales pasaron exitosamente.`);
  }
}

runTests();
