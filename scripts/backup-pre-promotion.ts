import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hashQuery(db: any, query: string): string {
  const rows = db.prepare(query).all();
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function getDbInfo(dbPath: string) {
  const stat = fs.statSync(dbPath);
  const size = stat.size;
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(dbPath));
  const sha256 = hash.digest('hex');

  const db = new Database(dbPath, { readonly: true });
  const integrityRow = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  const integrity = integrityRow.integrity_check;

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  const tablesCount: Record<string, number> = {};
  const tablesHashes: Record<string, string> = {};

  for (const table of tables) {
    const tableName = table.name;
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as { count: number };
    tablesCount[tableName] = countRow.count;

    const pragma = db.prepare(`PRAGMA table_info("${tableName}")`).all() as { name: string, pk: number }[];
    const pks = pragma.filter(p => p.pk > 0).sort((a, b) => a.pk - b.pk).map(p => `"${p.name}"`);
    const orderBy = pks.length > 0 ? `ORDER BY ${pks.join(', ')}` : '';

    const q = `SELECT * FROM "${tableName}" ${orderBy}`;
    tablesHashes[tableName] = hashQuery(db, q);
  }
  db.close();

  return { size, sha256, integrity, tablesCount, tablesHashes };
}

async function main() {
  try {
    const source = path.resolve('data/appglpi.sqlite');
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const backup = path.resolve(`data/backups/pre_promotion_${ts}.sqlite`);

    fs.mkdirSync(path.dirname(backup), { recursive: true });

    console.log(`[Backup Pre-Promocion] Backing up ${source} to ${backup}...`);
    const db = new Database(source, { readonly: true });
    await db.backup(backup);
    db.close();

    const info = getDbInfo(backup);

    if (info.integrity !== 'ok') {
      throw new Error(`Integrity check failed: ${info.integrity}`);
    }

    const report = {
      timestamp: new Date().toISOString(),
      backupPath: backup,
      ...info
    };

    const reportPath = path.resolve(`data/backups/pre_promotion_report_${ts}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`Backup completed.`);
    console.log(`BACKUP_DB: ${backup}`);
    console.log(`Report saved to: ${reportPath}`);
  } catch (err) {
    console.error('ERROR during backup:', err);
    process.exitCode = 1;
  }
}

main();
