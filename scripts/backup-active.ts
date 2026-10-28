import Database from 'better-sqlite3';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getHash(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex').toUpperCase();
}

async function runBackup() {
  const projectRoot = path.resolve(__dirname, '..');
  const activeDbPath = path.resolve(projectRoot, 'data/appglpi.sqlite');
  const backupsDir = path.resolve(projectRoot, 'data/backups');
  const qaDir = path.resolve(projectRoot, 'data/qa');

  if (!fs.existsSync(activeDbPath)) {
    console.error(`ERROR: La base activa no existe en ${activeDbPath}`);
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  if (!fs.existsSync(qaDir)) fs.mkdirSync(qaDir, { recursive: true });

  const activeHashBefore = getHash(activeDbPath);
  console.log(`[BACKUP] Active DB SHA-256 (Inicial): ${activeHashBefore}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '');
  const backupFileName = `containment_backup_${timestamp}.sqlite`;
  const backupPath = path.resolve(backupsDir, backupFileName);

  console.log(`[BACKUP] Starting backup to ${backupPath}...`);

  const src = new Database(activeDbPath, { readonly: true, fileMustExist: true });
  try {
    await src.backup(backupPath);
    console.log(`[BACKUP] Backup written.`);
  } catch (err) {
    console.error(`ERROR during backup:`, err);
    process.exitCode = 1;
    return;
  } finally {
    src.close();
    console.log(`[BACKUP] Source connection closed.`);
  }

  const backupHash = getHash(backupPath);
  console.log(`[BACKUP] Backup SHA-256: ${backupHash}`);

  // Verificar backup
  const dest = new Database(backupPath, { readonly: true, fileMustExist: true });
  const integrity = dest.pragma('integrity_check', { simple: true });
  console.log(`[BACKUP] Backup integrity_check: ${integrity}`);

  if (integrity !== 'ok') {
    console.error(`ERROR: integrity_check falló en el backup. Abortando copia a QA.`);
    dest.close();
    process.exitCode = 1;
    return;
  }

  const tables = dest.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  console.log('[BACKUP] Counts:');
  for (const t of tables) {
    try {
      const count = dest.prepare(`SELECT COUNT(*) as c FROM ${t.name}`).get() as { c: number };
      console.log(`  - ${t.name}: ${count.c}`);
    } catch (e) {
      console.error(`ERROR counting table ${t.name}:`, e);
      dest.close();
      process.exitCode = 1;
      return;
    }
  }
  dest.close();

  const qaDbPath = path.resolve(qaDir, 'appglpi_qa_isolated.sqlite');

  const relativeToQaDir = path.relative(qaDir, qaDbPath);
  if (relativeToQaDir.startsWith('..') || path.isAbsolute(relativeToQaDir)) {
    console.error(`ERROR: Ruta de QA generada no se encuentra dentro del directorio data/qa.`);
    process.exitCode = 1;
    return;
  }

  fs.copyFileSync(backupPath, qaDbPath);
  console.log(`[BACKUP] Copied successfully to QA isolated DB: ${qaDbPath}`);

  const qaHash = getHash(qaDbPath);
  console.log(`[BACKUP] QA Copy SHA-256: ${qaHash}`);

  if (backupHash !== qaHash) {
    console.error(`ERROR: Checksum mismatch. Backup hash: ${backupHash}, QA hash: ${qaHash}`);
    process.exitCode = 1;
    return;
  }

  // Ejecutar integrity_check sobre la copia QA
  const qaDb = new Database(qaDbPath, { readonly: true, fileMustExist: true });
  const qaIntegrity = qaDb.pragma('integrity_check', { simple: true });
  console.log(`[BACKUP] QA Copy integrity_check: ${qaIntegrity}`);
  qaDb.close();
  if (qaIntegrity !== 'ok') {
    console.error(`ERROR: integrity_check falló en la copia QA.`);
    process.exitCode = 1;
    return;
  }

  const activeHashAfter = getHash(activeDbPath);
  console.log(`[BACKUP] Active DB SHA-256 (Final): ${activeHashAfter}`);

  if (activeHashBefore !== activeHashAfter) {
    console.error(`ERROR: La base activa fue mutada durante el backup. Hash inicial: ${activeHashBefore}, Hash final: ${activeHashAfter}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[BACKUP] Backup process completed perfectly.`);
}

runBackup().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
