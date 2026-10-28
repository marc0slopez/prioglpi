import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');

const qaBaselinePath = process.argv[2];
const qaIsolatedPath = process.argv[3];

if (!qaBaselinePath || !qaIsolatedPath) {
  console.error("ERROR: Debes proveer dos rutas: <baseline_db> <isolated_db>");
  process.exitCode = 1;
  process.exit(1);
}

const baselineDbPath = path.resolve(qaBaselinePath);
const activeDbPath = path.resolve(qaIsolatedPath);

if (!fs.existsSync(baselineDbPath) || !fs.existsSync(activeDbPath)) {
  console.error("ERROR: Ambas bases de datos deben existir.");
  process.exitCode = 1;
  process.exit(1);
}

if (baselineDbPath.toLowerCase() === activeDbPath.toLowerCase()) {
  console.error("ERROR: Las bases de datos deben ser diferentes.");
  process.exitCode = 1;
  process.exit(1);
}

const activeSqliteDbPath = path.resolve(projectRoot, 'data/appglpi.sqlite').toLowerCase();
if (baselineDbPath.toLowerCase() === activeSqliteDbPath || activeDbPath.toLowerCase() === activeSqliteDbPath) {
  console.error("ERROR: Ninguna de las bases puede ser data/appglpi.sqlite.");
  process.exitCode = 1;
  process.exit(1);
}

const backupsRoot = path.resolve(projectRoot, 'data', 'backups');
const qaRoot = path.resolve(projectRoot, 'data', 'qa');

const baselineRel = path.relative(backupsRoot, baselineDbPath);
const activeRel = path.relative(qaRoot, activeDbPath);

if (baselineRel.startsWith('..') || path.isAbsolute(baselineRel)) {
  console.error("ERROR: La base baseline_db debe estar dentro de data/backups/");
  process.exitCode = 1;
  process.exit(1);
}

if (activeRel.startsWith('..') || path.isAbsolute(activeRel)) {
  console.error("ERROR: La base isolated_db debe estar dentro de data/qa/");
  process.exitCode = 1;
  process.exit(1);
}

type SqliteDatabase = InstanceType<typeof Database>;

interface DBRow {
  [key: string]: unknown;
}

interface TableChanges {
  [key: string]: { from: unknown; to: unknown };
}

interface ChangeLog {
  id: string;
  changes: TableChanges;
  ticketId?: unknown;
}

interface CompareReport {
  missing: string[];
  added: string[];
  changed: ChangeLog[];
  qaCount: number;
  activeCount: number;
}

function compareTable(qaDb: SqliteDatabase, activeDb: SqliteDatabase, table: string, pkFn: (r: DBRow) => string, ignoreFields: string[] = []): CompareReport {
    let r1: DBRow[] = [];
    let r2: DBRow[] = [];

    // Si la tabla no existe o falla la lectura, lanzará un error que abortará todo.
    r1 = qaDb.prepare(`SELECT * FROM ${table}`).all() as DBRow[];
    r2 = activeDb.prepare(`SELECT * FROM ${table}`).all() as DBRow[];

    const map1 = new Map<string, DBRow>();
    for (const r of r1) {
      const key = pkFn(r);
      if (map1.has(key)) {
        console.error(`ERROR: Duplicate key found in QA DB for table ${table}, key: ${key}`);
        process.exitCode = 1;
        throw new Error(`Duplicate key in QA DB: ${table} ${key}`);
      }
      map1.set(key, r);
    }

    const map2 = new Map<string, DBRow>();
    for (const r of r2) {
      const key = pkFn(r);
      if (map2.has(key)) {
        console.error(`ERROR: Duplicate key found in Isolated QA DB for table ${table}, key: ${key}`);
        process.exitCode = 1;
        throw new Error(`Duplicate key in Isolated QA DB: ${table} ${key}`);
      }
      map2.set(key, r);
    }

    const missing: string[] = [];
    const added: string[] = [];
    const changed: ChangeLog[] = [];

    for (const [id, row] of map1) {
        if (!map2.has(id)) {
            missing.push(id);
        } else {
            const row2 = map2.get(id);
            if (!row2) continue;

            const changes: TableChanges = {};
            for (const key in row) {
                if (row[key] !== row2[key]) {
                    if (!ignoreFields.includes(key)) {
                        changes[key] = { from: row[key], to: row2[key] };
                    }
                }
            }
            if (Object.keys(changes).length > 0) {
                const changeObj: ChangeLog = { id, changes };
                if (table === 'TicketRanking') changeObj.ticketId = row.ticketId;
                changed.push(changeObj);
            }
        }
    }

    for (const id of map2.keys()) {
        if (!map1.has(id)) {
            added.push(id);
        }
    }

    return { missing, added, changed, qaCount: r1.length, activeCount: r2.length };
}

const tableConfig: Record<string, { pkFn: (r: DBRow) => string, ignoreFields: string[] }> = {
    'GlpiTicketCache': { pkFn: r => String(r.ticketId), ignoreFields: ['syncedAt'] },
    'SyncRun': { pkFn: r => String(r.id), ignoreFields: [] },
    'TicketRanking': { pkFn: r => String(r.id), ignoreFields: [] },
    'TicketCoordination': { pkFn: r => String(r.ticketId), ignoreFields: [] },
    'AuditLog': { pkFn: r => String(r.id), ignoreFields: [] },
    'GlpiTicketGroupActor': { pkFn: r => `${r.ticketId}_${r.groupId}_${r.actorType}`, ignoreFields: ['id'] },
    'GlpiTicketUserActor': { pkFn: r => `${r.ticketId}_${r.glpiUserId}_${r.actorType}`, ignoreFields: ['id'] },
    'GlpiFollowupCache': { pkFn: r => String(r.followupId), ignoreFields: [] },
    'GlpiTaskCache': { pkFn: r => String(r.taskId), ignoreFields: [] }
};

function runAudit() {
  const qaDb = new Database(baselineDbPath, {readonly: true, fileMustExist: true});
  const activeDb = new Database(activeDbPath, {readonly: true, fileMustExist: true});

  try {
    const qaIntegrity = qaDb.pragma('integrity_check', { simple: true });
    if (qaIntegrity !== 'ok') {
      throw new Error(`integrity_check falló en baseline_db: ${qaIntegrity}`);
    }

    const activeIntegrity = activeDb.pragma('integrity_check', { simple: true });
    if (activeIntegrity !== 'ok') {
      throw new Error(`integrity_check falló en isolated_db: ${activeIntegrity}`);
    }

    const report: Record<string, CompareReport> = {};
    for (const [table, config] of Object.entries(tableConfig)) {
        const res = compareTable(qaDb, activeDb, table, config.pkFn, config.ignoreFields);
        report[table] = res;
    }

    const qaDir = path.resolve(projectRoot, 'docs/qa');
    if (!fs.existsSync(qaDir)) {
        fs.mkdirSync(qaDir, { recursive: true });
    }

    const finalReportPath = path.resolve(qaDir, 'audit_diff.json');
    const tempReportPath = path.resolve(qaDir, `audit_diff_${Date.now()}.tmp.json`);

    fs.writeFileSync(tempReportPath, JSON.stringify(report, null, 2));

    console.log('--- CIERRE DE AUDITORÍA DE DATOS ---');
    const newTickets = report.GlpiTicketCache?.added || [];
    console.log('tickets nuevos 1332, 1333 y 1334:', newTickets.filter((id: string) => ['1332','1333','1334'].includes(id)));
    console.log('diferencias de SyncRun 10 y 11:');

    const syncRunChanged = report.SyncRun?.changed?.filter((c: ChangeLog) => c.id === '10');
    console.log('  10 changed:', syncRunChanged);
    console.log('  11 added:', report.SyncRun?.added?.includes('11') ? true : false);

    const qaRankings = qaDb.prepare(`SELECT r.* FROM TicketRanking r JOIN GlpiTicketCache t ON r.ticketId = t.ticketId WHERE t.detectedSectorName = 'Impuestos' ORDER BY r.rankPosition ASC`).all() as DBRow[];
    const activeRankings = activeDb.prepare(`SELECT r.* FROM TicketRanking r JOIN GlpiTicketCache t ON r.ticketId = t.ticketId WHERE t.detectedSectorName = 'Impuestos' ORDER BY r.rankPosition ASC`).all() as DBRow[];

    console.log('ranking baseline Impuestos:', qaRankings.map(r => r.ticketId).join(', '));
    console.log('ranking actual Impuestos:', activeRankings.map(r => r.ticketId).join(', '));

    const auditLogs32To36 = activeDb.prepare(`SELECT * FROM AuditLog WHERE id IN (32, 33, 34, 35, 36) ORDER BY id ASC`).all() as DBRow[];
    console.log('los AuditLog 32 a 36:', auditLogs32To36);

    const remediationLogs = activeDb.prepare(`SELECT * FROM AuditLog WHERE action = 'ranking_remediation' ORDER BY id ASC`).all() as DBRow[];
    console.log('AuditLogs de ranking_remediation:', remediationLogs);

    fs.renameSync(tempReportPath, finalReportPath);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    qaDb.close();
    activeDb.close();
  }
}

runAudit();
