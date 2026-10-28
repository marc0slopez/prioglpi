import 'dotenv/config';
import { getSharedSqlServerRuntime } from '../lib/db/sqlserver-runtime-factory';

async function main() {
  try {
    const runtime = getSharedSqlServerRuntime();
    const sql = `
      SELECT ticket_id, title, assigned_technician, assigned_group_ids, assigned_group_names
      FROM [prioglpi].[glpi_ticket_cache]
      WHERE ticket_id IN (1734,1741);
    `;
    const rows = await runtime.query(sql, []);
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
