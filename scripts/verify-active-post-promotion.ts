import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hashQuery(db: any, query: string): string {
  const rows = db.prepare(query).all();
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function verify() {
  const projectRoot = path.resolve(__dirname, '..');
  const activeDbPath = path.resolve(projectRoot, 'data/appglpi.sqlite');

  console.log(`Verificando Post-Promoción...\nActive: ${activeDbPath}`);

  const backupsDir = path.resolve(projectRoot, 'data/backups');
  const backupFiles = fs.readdirSync(backupsDir).filter(f => f.startsWith('pre_promotion_') && f.endsWith('.sqlite')).sort();
  if (backupFiles.length === 0) {
    console.error(`ERROR: No se encontró ningún backup previo pre_promotion_*.sqlite`);
    process.exit(1);
  }
  const lastBackup = path.resolve(backupsDir, backupFiles[backupFiles.length - 1]);
  console.log(`Backup Base: ${lastBackup}`);

  const activeDb = new Database(activeDbPath, { readonly: true });
  const baseDb = new Database(lastBackup, { readonly: true });

  try {
    const integrity = activeDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') throw new Error(`Integrity check fail: ${integrity.integrity_check}`);
    console.log(`[PASS] integrity_check = ok`);

    // Invariantes
    const invariantTables = ['User', 'UserSectorScope', 'TicketRanking', 'TicketCoordination', 'AuditLog'];
    for (const tbl of invariantTables) {
      const q = `SELECT * FROM "${tbl}" ORDER BY id`;
      const baseHash = hashQuery(baseDb, q);
      const activeHash = hashQuery(activeDb, q);
      if (baseHash !== activeHash) {
        throw new Error(`Invariante fallido: La tabla ${tbl} fue modificada en la base activa`);
      }
    }
    console.log(`[PASS] Tablas protegidas idénticas al backup`);

    // Duplicados
    const countIds = activeDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache').get() as {c:number};
    const distinctIds = activeDb.prepare('SELECT COUNT(DISTINCT ticketId) as c FROM GlpiTicketCache').get() as {c:number};
    if (countIds.c !== distinctIds.c) throw new Error('Se detectaron tickets duplicados');
    console.log(`[PASS] Cero duplicados en cache`);

    // Huérfanos
    const taskOrphans = (activeDb.prepare('SELECT COUNT(*) as c FROM GlpiTaskCache t LEFT JOIN GlpiTicketCache c ON t.ticketId = c.ticketId WHERE c.ticketId IS NULL').get() as {c:number}).c;
    if (taskOrphans > 0) throw new Error(`Existen ${taskOrphans} tasks huérfanas`);
    const followupOrphans = (activeDb.prepare('SELECT COUNT(*) as c FROM GlpiFollowupCache f LEFT JOIN GlpiTicketCache c ON f.ticketId = c.ticketId WHERE c.ticketId IS NULL').get() as {c:number}).c;
    if (followupOrphans > 0) throw new Error(`Existen ${followupOrphans} followups huérfanos`);
    const grpActorOrphans = (activeDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketGroupActor a LEFT JOIN GlpiTicketCache c ON a.ticketId = c.ticketId WHERE c.ticketId IS NULL').get() as {c:number}).c;
    if (grpActorOrphans > 0) throw new Error(`Existen ${grpActorOrphans} grupos actores huérfanos`);
    const usrActorOrphans = (activeDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketUserActor a LEFT JOIN GlpiTicketCache c ON a.ticketId = c.ticketId WHERE c.ticketId IS NULL').get() as {c:number}).c;
    if (usrActorOrphans > 0) throw new Error(`Existen ${usrActorOrphans} usuarios actores huérfanos`);
    console.log(`[PASS] Cero huérfanos`);

    // SyncRun success
    const lastRun = activeDb.prepare("SELECT * FROM SyncRun WHERE status='success' ORDER BY id DESC LIMIT 1").get() as Record<string, unknown>;
    if (!lastRun) throw new Error('No hay SyncRun success');
    const dbTotalTickets = countIds.c;
    if (lastRun.ticketsFetched !== dbTotalTickets) throw new Error(`SyncRun indica ${lastRun.ticketsFetched} tickets, pero hay ${dbTotalTickets} en cache.`);
    console.log(`[PASS] SyncRun finalizado correctamente con ${lastRun.ticketsFetched} tickets`);

    // Activos + Históricos = Total
    const sysCountDb = (activeDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1').get() as {c:number}).c;
    const activos = (activeDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1 AND status BETWEEN 1 AND 4').get() as {c:number}).c;
    const historicos = (activeDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1 AND status BETWEEN 5 AND 6').get() as {c:number}).c;
    if (activos + historicos !== sysCountDb) throw new Error(`activos(${activos}) + historicos(${historicos}) != total Sistemas(${sysCountDb})`);
    console.log(`[PASS] Activos + Históricos = Total`);

    // Mandatory fields
    const tickets = activeDb.prepare('SELECT ticketId, webUrl, statusLabel, typeLabel, priorityLabel, syncedAt FROM GlpiTicketCache').all() as Record<string, unknown>[];
    for (const t of tickets) {
      if (!t.webUrl || (t.webUrl as string).trim() === '') throw new Error(`Ticket ${t.ticketId} tiene webUrl vacío`);
      if (!t.statusLabel || (t.statusLabel as string).trim() === '') throw new Error(`Ticket ${t.ticketId} tiene statusLabel vacío`);
      if (!t.typeLabel || (t.typeLabel as string).trim() === '') throw new Error(`Ticket ${t.ticketId} tiene typeLabel vacío`);
      if (!t.priorityLabel || (t.priorityLabel as string).trim() === '') throw new Error(`Ticket ${t.ticketId} tiene priorityLabel vacío`);
      if (!t.syncedAt) throw new Error(`Ticket ${t.ticketId} no tiene syncedAt`);
    }
    console.log(`[PASS] Atributos (webUrl, labels, fechas) completos`);

    const techCountDb = (activeDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isTecnologiaScope = 1').get() as {c:number}).c;
    if (lastRun.tecnologiaCount !== techCountDb) throw new Error('SyncRun tecnologiaCount mismatch');

    console.log(`[GLPI] Referencia Dinámica Total: ${lastRun.ticketsFetched}`);
    console.log(`[GLPI] Referencia Dinámica Sistemas (under 30): ${lastRun.sistemasCount}`);
    console.log(`[GLPI] Referencia Dinámica Tecnología (under 32): ${lastRun.tecnologiaCount}`);

    // Filtros
    console.log(`[Filtro] Mauro (isSistemasScope=1): ${sysCountDb}`);
    const julianTotal = (activeDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1 AND detectedSectorGroupId IN (15,55,14,36)').get() as {c:number}).c;
    console.log(`[Filtro] Julián (Sistemas y 15,55,14,36): ${julianTotal}`);
    const carolinaTotal = (activeDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1 AND detectedSectorGroupId = 15').get() as {c:number}).c;
    console.log(`[Filtro] Carolina (Sistemas y 15): ${carolinaTotal}`);

    console.log('\nComparación contra fotografía QA:');
    console.log(`QA Anterior: Total 1272, Sist 892, Tec 348, Mauro 892, Julian 58, Carolina 22`);
    console.log(`Activa Hoy:  Total ${dbTotalTickets}, Sist ${sysCountDb}, Tec ${techCountDb}, Mauro ${sysCountDb}, Julian ${julianTotal}, Carolina ${carolinaTotal}`);

    if (dbTotalTickets !== 1272 || sysCountDb !== 892 || techCountDb !== 348 || julianTotal !== 58 || carolinaTotal !== 22) {
      console.log(`[INFO] Diferencia dinámica detectada debido a nuevos cambios en GLPI desde la ejecución QA anterior.`);
    } else {
      console.log(`[INFO] Los datos son exactamente los mismos que en la fotografía QA. Ningún ticket nuevo fue modificado en GLPI.`);
    }

    console.log('\n[✔] Verificacion POST-PROMOCION Completa y Exitosa.');

  } catch (err: unknown) {
    console.error('Fallo de Verificación Post-Promoción:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    activeDb.close();
    baseDb.close();
  }
}

verify();
