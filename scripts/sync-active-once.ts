import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { runSync } from '../lib/sync-service';

async function main() {
  if (process.env.ALLOW_ACTIVE_SYNC !== 'APPGLPI_LOCAL_QA_APPROVED_20260714') {
    console.error('ERROR: Confirmación explícita ALLOW_ACTIVE_SYNC inválida o ausente.');
    process.exit(1);
  }

  const projectRoot = path.resolve(__dirname, '..');
  const cwd = process.cwd();
  if (cwd !== projectRoot) {
    console.error(`ERROR: Ejecución fuera del directorio absoluto del proyecto.\nEsperado: ${projectRoot}\nActual: ${cwd}`);
    process.exit(1);
  }

  const targetDb = path.resolve(projectRoot, 'data/appglpi.sqlite');
  console.log(`[Promocion] Destino resuelto: ${targetDb}`);
  if (!fs.existsSync(targetDb)) {
    console.error(`ERROR: La base de datos activa no existe en ${targetDb}`);
    process.exit(1);
  }

  // Comprobar el backup previo
  const backupsDir = path.resolve(projectRoot, 'data/backups');
  const backupFiles = fs.readdirSync(backupsDir).filter(f => f.startsWith('pre_promotion_') && f.endsWith('.sqlite')).sort();
  if (backupFiles.length === 0) {
    console.error(`ERROR: No se encontró ningún backup previo pre_promotion_*.sqlite`);
    process.exit(1);
  }
  const lastBackup = path.resolve(backupsDir, backupFiles[backupFiles.length - 1]);
  console.log(`[Promocion] Backup de recuperación detectado: ${lastBackup}`);

  const db = new Database(lastBackup, { readonly: true });
  const integrityRow = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  db.close();

  if (integrityRow.integrity_check !== 'ok') {
    console.error(`ERROR: El backup previo no pasó el integrity_check: ${integrityRow.integrity_check}`);
    process.exit(1);
  }

  console.log(`[Promocion] Backup OK. Iniciando sincronización en base ACTIVA...`);
  const result = await runSync(); // Not passing qaDbUrl -> defaults to active prisma

  if (result.error) {
    console.error(`ERROR: Falló la promoción. Detalle: ${result.error}`);
    process.exit(1);
  }

  console.log(`[Promocion] Sincronización finalizada exitosamente. Tickets fetched: ${result.ticketsFetched}`);
}

main().catch(err => {
  console.error('[Promocion] Falla inesperada:', err);
  process.exit(1);
});
