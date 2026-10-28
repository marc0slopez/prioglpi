import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

function getDbInfo(dbPath: string): { size: number; sha256: string; integrity: string; tablesCount: Record<string, number> } {
  const stat = fs.statSync(dbPath);
  const size = stat.size;
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(dbPath));
  const sha256 = hash.digest('hex');

  const db = new Database(dbPath, { readonly: true });
  const integrityRow = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  const integrity = integrityRow.integrity_check;

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const tablesCount: Record<string, number> = {};
  for (const table of tables) {
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as { count: number };
    tablesCount[table.name] = countRow.count;
  }
  db.close();

  return { size, sha256, integrity, tablesCount };
}

async function main() {
  try {
    const source = path.resolve('data/appglpi.sqlite');
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const baseline = path.resolve(`data/backups/qa_baseline_${ts}.sqlite`);
    const qaCopy = path.resolve(`data/qa/appglpi_sync_qa_${ts}.sqlite`);

    fs.mkdirSync(path.dirname(baseline), { recursive: true });
    fs.mkdirSync(path.dirname(qaCopy), { recursive: true });

    console.log(`Backing up ${source} to ${baseline}...`);
    const db = new Database(source, { readonly: true });
    await db.backup(baseline);
    db.close();

    console.log(`Creating QA copy at ${qaCopy}...`);
    const baseDb = new Database(baseline, { readonly: true });
    await baseDb.backup(qaCopy);
    baseDb.close();

    const activeInfo = getDbInfo(source);
    const baselineInfo = getDbInfo(baseline);
    const qaInfo = getDbInfo(qaCopy);

    if (activeInfo.integrity !== 'ok' || baselineInfo.integrity !== 'ok' || qaInfo.integrity !== 'ok') {
      throw new Error(`Integrity check failed: Active=${activeInfo.integrity}, Baseline=${baselineInfo.integrity}, QA=${qaInfo.integrity}`);
    }

    const report = {
      timestamp: new Date().toISOString(),
      active: {
        path: source,
        ...activeInfo
      },
      baseline: {
        path: baseline,
        ...baselineInfo
      },
      qa: {
        path: qaCopy,
        ...qaInfo
      }
    };

    const reportPath = path.resolve(`data/qa/backup_report_${ts}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`Backup completed.`);
    console.log(`QA_DB: ${qaCopy}`);
    console.log(`BASELINE_DB: ${baseline}`);
    console.log(`Report saved to: ${reportPath}`);
  } catch (err) {
    console.error('ERROR during backup:', err);
    process.exitCode = 1;
  }
}

main();
