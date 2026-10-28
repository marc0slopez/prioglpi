import { loadEnvConfig } from '@next/env';
import fs from 'node:fs';
import path from 'node:path';
import { getSharedSqlServerRuntime } from '../lib/db/sqlserver-runtime-factory';

loadEnvConfig(process.cwd());

async function main() {
  const sqlFile = process.argv[2];
  if (!sqlFile) throw new Error('Uso: tsx scripts/run-sql-file.ts <archivo.sql>');

  const fullPath = path.resolve(sqlFile);
  const rawSql = fs.readFileSync(fullPath, 'utf8');

  const batches = rawSql
    .split(/^\s*GO\s*;?\s*$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);

  console.log(`Ejecutando ${batches.length} batch(es) desde ${fullPath}`);

  const rt = getSharedSqlServerRuntime();

  try {
    for (let i = 0; i < batches.length; i++) {
      console.log(`Batch ${i + 1}/${batches.length}`);
      await rt.execute(batches[i], []);
    }

    const rows = await rt.query(`
      SELECT username, role, auth_source, ad_object_id, directory_active, is_active,
             CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS has_password_hash
      FROM [prioglpi].[app_user]
      WHERE username IN (
        'tecnico_test',
        'emmanuelr',
        'matiasf',
        'sebastianz',
        'eduardom',
        'stefanol',
        'francoc'
      )
      ORDER BY username;
    `, []);

    console.table(rows);
  } finally {
    await rt.close();
  }

  console.log('SQL aplicado OK.');
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
