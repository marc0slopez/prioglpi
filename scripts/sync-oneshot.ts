import 'dotenv/config';
import { runSync } from '../lib/sync-service';

async function main() {
  console.log('Iniciando sincronización de prueba...');

  const qaDbUrl = process.env.QA_DATABASE_URL;
  if (!qaDbUrl) {
    console.error("ERROR: No se especificó QA_DATABASE_URL. Abortando para proteger la base activa.");
    process.exit(1);
  }

  const result = await runSync(qaDbUrl);
  console.log('Resultado:', result);

  if (result.error) {
    console.error("Fallo la sincronizacion:", result.error);
    process.exit(1);
  }
  process.exit(0);
}

main();
