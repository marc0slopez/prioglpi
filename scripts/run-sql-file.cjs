const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql/msnodesqlv8');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  const raw = fs.readFileSync(envPath, 'utf8');

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');

    process.env[key] = value;
  }
}

async function main() {
  loadEnv();

  const sqlFile = process.argv[2];
  if (!sqlFile) throw new Error('Uso: node scripts/run-sql-file.cjs <archivo.sql>');

  const fullPath = path.resolve(sqlFile);
  const rawSql = fs.readFileSync(fullPath, 'utf8');

  const config = {
    server: process.env.PRIOGLPI_SQL_SERVER,
    port: Number(process.env.PRIOGLPI_SQL_PORT),
    database: process.env.PRIOGLPI_SQL_DATABASE,
    driver: process.env.PRIOGLPI_SQL_ODBC_DRIVER,
    connectionTimeout: Number(process.env.PRIOGLPI_SQL_CONNECTION_TIMEOUT_MS || 15000),
    requestTimeout: Number(process.env.PRIOGLPI_SQL_REQUEST_TIMEOUT_MS || 60000),
    options: {
      trustedConnection: true,
      encrypt: true,
      trustServerCertificate: process.env.PRIOGLPI_SQL_TRUST_SERVER_CERTIFICATE === 'true',
    },
  };

  const batches = rawSql
    .split(/^\s*GO\s*;?\s*$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);

  console.log(`Ejecutando ${batches.length} batch(es) desde ${fullPath}`);

  const pool = await sql.connect(config);
  try {
    for (let i = 0; i < batches.length; i++) {
      console.log(`Batch ${i + 1}/${batches.length}`);
      await pool.request().query(batches[i]);
    }

    const result = await pool.request().query(`
      SELECT username, role, auth_source, directory_active, is_active
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
    `);

    console.table(result.recordset);
  } finally {
    await pool.close();
  }

  console.log('SQL aplicado OK.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
