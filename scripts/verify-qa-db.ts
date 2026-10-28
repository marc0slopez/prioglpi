import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

function verify() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Uso: npx ts-node scripts/verify-qa-db.ts <qaDbPath> <baselinePath> <activeDbPath>');
    process.exit(1);
  }

  const qaDbPath = path.resolve(args[0]);
  const baselinePath = path.resolve(args[1]);
  const activeDbPath = path.resolve(args[2]);

  if (qaDbPath === activeDbPath || qaDbPath === baselinePath || activeDbPath === baselinePath) {
    console.error('Error: Las rutas de base de datos no pueden ser idénticas.');
    process.exit(1);
  }

  console.log(`Verificando...\nQA: ${qaDbPath}\nBaseline: ${baselinePath}\nActive: ${activeDbPath}`);

  const qaDb = new Database(qaDbPath, { readonly: true });
  const baseDb = new Database(baselinePath, { readonly: true });
  const activeDb = new Database(activeDbPath, { readonly: true });

  function hashQuery(db: typeof qaDb, query: string): string {
    const rows = db.prepare(query).all();
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }

  try {
    const integrity = qaDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') throw new Error(`Integrity check fail: ${integrity.integrity_check}`);

    // Invariantes (hashes de contenido) comparados contra Baseline (no activa)
    const tables = qaDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const tbl of tables) {
      const tableName = tbl.name;
      // Get primary key
      const pragma = qaDb.prepare(`PRAGMA table_info("${tableName}")`).all() as { name: string, pk: number }[];
      const pks = pragma.filter(p => p.pk > 0).sort((a, b) => a.pk - b.pk).map(p => `"${p.name}"`);
      const orderBy = pks.length > 0 ? `ORDER BY ${pks.join(', ')}` : '';

      const q = `SELECT * FROM "${tableName}" ${orderBy}`;

      // Active MUST be exactly identical to Baseline
      const baseHash = hashQuery(baseDb, q);
      const activeHash = hashQuery(activeDb, q);

      if (baseHash !== activeHash) {
        throw new Error(`Integridad activa fallida: La tabla ${tableName} en la base activa difiere del baseline.`);
      }

      // Check QA invariants if the table is supposed to be read-only (not a cache or sync-specific table)
      // Actually we are not asked to do invariant checks on QA for ALL tables, just to check active vs baseline for all tables.
      // And we can keep the previous invariant check for QA on the original tables.
      const invariantTables = ['User', 'UserSectorScope', 'TicketRanking', 'TicketCoordination', 'AuditLog'];
      if (invariantTables.includes(tableName)) {
        const qaHash = hashQuery(qaDb, q);
        if (baseHash !== qaHash) {
          throw new Error(`Invariante fallido: La tabla ${tableName} fue modificada en la copia QA`);
        }
      }
    }

    // Mauro (Sistemas)
    const mauroTotal = (qaDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1').get() as {c:number}).c;
    const mauroActivos = (qaDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1 AND status BETWEEN 1 AND 4').get() as {c:number}).c;
    const mauroHist = (qaDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1 AND status BETWEEN 5 AND 6').get() as {c:number}).c;
    console.log(`Mauro (Sistemas): Total ${mauroTotal}, Activos ${mauroActivos}, Historicos ${mauroHist}`);
    if (mauroTotal === 0 || mauroActivos + mauroHist !== mauroTotal) throw new Error('Validación de Mauro falló');

    // Julián (Sectores 15,55,14,36)
    const julianTotal = (qaDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1 AND detectedSectorGroupId IN (15,55,14,36)').get() as {c:number}).c;
    console.log(`Julián: Total ${julianTotal}`);
    if (julianTotal === 0) throw new Error('Julián obtiene cero tickets');

    // Carolina (Sector 15)
    const carolinaTotal = (qaDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1 AND detectedSectorGroupId = 15').get() as {c:number}).c;
    console.log(`Carolina: Total ${carolinaTotal}`);
    if (carolinaTotal === 0) throw new Error('Carolina obtiene cero tickets');

    // Orphans
    const taskOrphans = (qaDb.prepare('SELECT COUNT(*) as c FROM GlpiTaskCache t LEFT JOIN GlpiTicketCache c ON t.ticketId = c.ticketId WHERE c.ticketId IS NULL').get() as {c:number}).c;
    if (taskOrphans > 0) throw new Error(`Existen ${taskOrphans} tasks huérfanas`);

    const followupOrphans = (qaDb.prepare('SELECT COUNT(*) as c FROM GlpiFollowupCache f LEFT JOIN GlpiTicketCache c ON f.ticketId = c.ticketId WHERE c.ticketId IS NULL').get() as {c:number}).c;
    if (followupOrphans > 0) throw new Error(`Existen ${followupOrphans} followups huérfanos`);

    const grpActorOrphans = (qaDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketGroupActor a LEFT JOIN GlpiTicketCache c ON a.ticketId = c.ticketId WHERE c.ticketId IS NULL').get() as {c:number}).c;
    if (grpActorOrphans > 0) throw new Error(`Existen ${grpActorOrphans} grupos actores huérfanos`);

    const usrActorOrphans = (qaDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketUserActor a LEFT JOIN GlpiTicketCache c ON a.ticketId = c.ticketId WHERE c.ticketId IS NULL').get() as {c:number}).c;
    if (usrActorOrphans > 0) throw new Error(`Existen ${usrActorOrphans} usuarios actores huérfanos`);

    // Mandatory Fields
    const tickets = qaDb.prepare('SELECT * FROM GlpiTicketCache').all() as Record<string, unknown>[];
    for (const tRow of tickets) {
      const t = tRow as { ticketId: number, webUrl: string, statusLabel: string, typeLabel: string, priorityLabel: string, syncedAt: string, assignedGroupIds: string, assignedGroupNames: string };
      if (!t.webUrl || t.webUrl.trim() === '') throw new Error(`Ticket ${t.ticketId} tiene webUrl vacío`);
      if (!t.statusLabel || t.statusLabel.trim() === '') throw new Error(`Ticket ${t.ticketId} tiene statusLabel vacío`);
      if (!t.typeLabel || t.typeLabel.trim() === '') throw new Error(`Ticket ${t.ticketId} tiene typeLabel vacío`);
      if (!t.priorityLabel || t.priorityLabel.trim() === '') throw new Error(`Ticket ${t.ticketId} tiene priorityLabel vacío`);
      if (!t.syncedAt) throw new Error(`Ticket ${t.ticketId} no tiene syncedAt`);

      let parsedIds = [];
      let parsedNames = [];
      try {
        parsedIds = JSON.parse(t.assignedGroupIds);
        parsedNames = JSON.parse(t.assignedGroupNames);
      } catch {
        throw new Error(`Ticket ${t.ticketId} tiene un JSON inválido en assignedGroupIds/Names`);
      }
      if (parsedIds.length !== parsedNames.length) {
        throw new Error(`Ticket ${t.ticketId} tiene arrays de distinta longitud para grupos asignados`);
      }
    }

    // SyncRun success
    const lastRun = qaDb.prepare("SELECT * FROM SyncRun WHERE status='success' ORDER BY id DESC LIMIT 1").get() as Record<string, unknown>;
    if (!lastRun) throw new Error('No hay SyncRun success');
    if (lastRun.ticketsFetched !== tickets.length) throw new Error(`SyncRun indica ${lastRun.ticketsFetched} tickets, pero hay ${tickets.length} en cache.`);

    const sysCount = (qaDb.prepare('SELECT COUNT(*) as c FROM GlpiTicketCache WHERE isSistemasScope = 1').get() as {c:number}).c;
    if (lastRun.sistemasCount !== sysCount) throw new Error('SyncRun sistemasCount mismatch');

    console.log('Verificacion completa: TODO OK.');
  } catch (err: unknown) {
    console.error('Fallo QA:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    qaDb.close();
    baseDb.close();
    activeDb.close();
  }
}

verify();
