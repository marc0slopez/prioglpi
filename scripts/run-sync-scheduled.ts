import 'dotenv/config';
import { runSync } from '../lib/sync-service';

async function main() {
  const startedAt = new Date();
  console.log(`[scheduled-sync] START ${startedAt.toISOString()}`);

  const result = await runSync();

  const finishedAt = new Date();
  console.log(`[scheduled-sync] OK ${finishedAt.toISOString()} ${JSON.stringify(result)}`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
  console.error(`[scheduled-sync] FAIL ${new Date().toISOString()} ${message}`);
  process.exitCode = 1;
});
