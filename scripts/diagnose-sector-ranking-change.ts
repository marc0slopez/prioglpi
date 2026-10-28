import { loadEnvConfig } from '@next/env';
import { getSharedSqlServerRuntime } from '../lib/db/sqlserver-runtime-factory';

loadEnvConfig(process.cwd());

async function main() {
  const rt = getSharedSqlServerRuntime();

  try {
    console.log('\n=== 1. Grupos GLPI ===');
    console.table(await rt.query(`
      SELECT group_id, name, complete_name
      FROM prioglpi.glpi_group_cache
      ORDER BY group_id;
    `, []));

    console.log('\n=== 2. Usuarios y sectores actuales ===');
    console.table(await rt.query(`
      SELECT u.id, u.username, u.display_name, u.role,
             u.is_active, s.glpi_group_id, s.sector_name
      FROM prioglpi.app_user u
      LEFT JOIN prioglpi.user_sector_scope s ON s.user_id = u.id
      WHERE u.role IN ('priorizador', 'referente')
      ORDER BY u.username, s.glpi_group_id;
    `, []));

    console.log('\n=== 3. Identidad de Tamara y referentes de Julian ===');
    console.table(await rt.query(`
      SELECT id, account_name, display_name, is_active
      FROM dbo.internal_user
      WHERE LOWER(display_name) LIKE N'%tamara%'
         OR LOWER(account_name) IN (
           'carolinae', 'matiasr', 'silvinac', 'cynthiar'
         )
      ORDER BY account_name;
    `, []));

    console.log('\n=== 4. Asignaciones de origen ===');
    console.table(await rt.query(`
      SELECT u.account_name, a.profile, a.is_active,
             p.account_name AS priorizador_origen,
             a.scope_selector_name
      FROM dbo.prioglpi_user_access a
      JOIN dbo.internal_user u ON u.id = a.internal_user_id
      LEFT JOIN dbo.internal_user p
        ON p.id = a.referent_internal_user_id
      WHERE a.profile IN ('priorizador', 'referente', 'supervisor')
      ORDER BY u.account_name;
    `, []));

    console.log('\n=== 5. Rankings existentes por usuario y sector ===');
    console.table(await rt.query(`
      SELECT u.username, u.is_active AS usuario_activo,
             r.glpi_group_id, r.sector_name, r.is_active,
             COUNT(*) AS cantidad
      FROM prioglpi.ticket_ranking r
      JOIN prioglpi.app_user u ON u.id = r.owner_user_id
      GROUP BY u.username, u.is_active,
               r.glpi_group_id, r.sector_name, r.is_active
      ORDER BY r.glpi_group_id, u.username, r.is_active;
    `, []));

    console.log('\n=== 6. Orden actual de rankings activos ===');
    console.table(await rt.query(`
      SELECT r.id, u.username, r.ticket_id,
             r.glpi_group_id, r.sector_name, r.rank_position
      FROM prioglpi.ticket_ranking r
      JOIN prioglpi.app_user u ON u.id = r.owner_user_id
      WHERE r.is_active = 1
      ORDER BY u.username, r.rank_position, r.id;
    `, []));
  } finally {
    await rt.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
