/**
 * Sync Worker — Proceso separado para sincronización automática.
 *
 * Ejecutar con: npm run sync:worker
 *
 * Ejecuta sync cada SYNC_INTERVAL_MINUTES minutos.
 * Separado del proceso Next.js para robustez.
 */

import 'dotenv/config';

// Importar dinámicamente para que dotenv esté cargado primero
async function main() {
  const { runSync } = await import('../lib/sync-service');

  const intervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES || '3', 10);
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log('='.repeat(50));
  console.log('APPGLPI Sync Worker');
  console.log(`Intervalo: cada ${intervalMinutes} minutos`);
  console.log('='.repeat(50));

  async function doSync() {
    const startTime = new Date();
    console.log(`\n[${startTime.toLocaleString('es-AR')}] Iniciando sincronización...`);

    try {
      const result = await runSync();
      const endTime = new Date();
      const duration = ((endTime.getTime() - startTime.getTime()) / 1000).toFixed(1);

      if (result.error) {
        console.log(`[Sync] Completado con errores (${duration}s): ${result.error}`);
      } else {
        console.log(`[Sync] Completado (${duration}s): ${result.ticketsFetched} tickets sincronizados.`);
      }
    } catch (err) {
      console.error(`[Sync] Error fatal:`, err);
    }
  }

  // Sync inicial
  await doSync();

  // Sync periódico
  setInterval(doSync, intervalMs);

  console.log(`\nSync worker activo. Próxima sync en ${intervalMinutes} minutos.`);
  console.log('Presioná Ctrl+C para detener.');
}

main().catch((err) => {
  console.error('Error fatal en sync worker:', err);
  process.exit(1);
});
