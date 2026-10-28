/**
 * migrate-rankings-to-canonical-owner.ts
 *
 * Script idempotente para migrar rankings existentes al canonical owner
 * de cada grupo de priorizadores con sectores idénticos.
 *
 * Uso:
 *   npx tsx scripts/migrate-rankings-to-canonical-owner.ts            # dry-run (solo reporte)
 *   npx tsx scripts/migrate-rankings-to-canonical-owner.ts --apply    # ejecutar cambios seguros
 *
 * Reglas:
 *   - Si solo un usuario del grupo tiene rankings activos, se mueve al canonical.
 *   - Si varios usuarios tienen rankings activos, se reporta conflicto y NO se modifica.
 *   - Si ninguno tiene rankings, no se hace nada.
 *
 * Seguro para correr múltiples veces (idempotente).
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { getSharedSqlServerRuntime } from '../lib/db/sqlserver-runtime-factory';
import type { SqlParameter } from '../lib/db/sqlserver-runtime-contract';

interface PeerInfo {
  userId: number;
  username: string;
  displayName: string;
  activeRankingCount: number;
}

interface GroupReport {
  sortedGroupIds: number[];
  canonicalUserId: number;
  canonicalUsername: string;
  peers: PeerInfo[];
  action: 'no_rankings' | 'already_canonical' | 'migrate' | 'conflict';
  details: string;
}

async function main() {
  const applyMode = process.argv.includes('--apply');
  console.log(`\n=== Migración de Rankings a Canonical Owner ===`);
  console.log(`Modo: ${applyMode ? 'APLICAR CAMBIOS' : 'DRY-RUN (solo reporte)'}\n`);

  const rt = getSharedSqlServerRuntime();

  // 1. Obtener todos los priorizadores activos con sus scopes
  const userRows = await rt.query(`
    SELECT
      u.[id] AS [user_id],
      u.[username],
      u.[display_name],
      s.[glpi_group_id]
    FROM [prioglpi].[app_user] u
    INNER JOIN [prioglpi].[user_sector_scope] s ON s.[user_id] = u.[id]
    WHERE u.[is_active] = 1
      AND u.[role] = 'priorizador'
      AND s.[glpi_group_id] IS NOT NULL
    ORDER BY u.[id] ASC, s.[glpi_group_id] ASC
  `, []);

  // Agrupar scopes por usuario
  const userScopes = new Map<number, { username: string; displayName: string; groupIds: number[] }>();
  for (const row of userRows) {
    const userId = row['user_id'] as number;
    const username = row['username'] as string;
    const displayName = row['display_name'] as string;
    const groupId = row['glpi_group_id'] as number;

    let entry = userScopes.get(userId);
    if (!entry) {
      entry = { username, displayName, groupIds: [] };
      userScopes.set(userId, entry);
    }
    entry.groupIds.push(groupId);
  }

  // 2. Agrupar usuarios por set de group IDs idénticos
  const groupKey = (ids: number[]) => ids.sort((a, b) => a - b).join(',');
  const sameSetGroups = new Map<string, { sortedGroupIds: number[]; users: { userId: number; username: string; displayName: string }[] }>();

  for (const [userId, info] of userScopes) {
    const key = groupKey([...info.groupIds]);
    let group = sameSetGroups.get(key);
    if (!group) {
      group = { sortedGroupIds: info.groupIds.sort((a, b) => a - b), users: [] };
      sameSetGroups.set(key, group);
    }
    group.users.push({ userId, username: info.username, displayName: info.displayName });
  }

  // 3. Filtrar solo grupos con >1 usuario (colas compartidas potenciales)
  const sharedGroups = [...sameSetGroups.values()].filter(g => g.users.length > 1);

  if (sharedGroups.length === 0) {
    console.log('No se encontraron priorizadores con sectores compartidos. Nada que migrar.');
    await rt.close();
    return;
  }

  console.log(`Se encontraron ${sharedGroups.length} grupo(s) de priorizadores con sectores idénticos.\n`);

  // 4. Para cada grupo, contar rankings activos por usuario y determinar acción
  const reports: GroupReport[] = [];

  for (const group of sharedGroups) {
    const userIds = group.users.map(u => Number(u.userId));
    for (const id of userIds) {
      if (!Number.isInteger(id) || id <= 0) {
        console.error(`ERROR: user_id inválido (${id}, type: ${typeof id}) en el grupo con sectores [${group.sortedGroupIds.join(', ')}]. Abortando.`);
        process.exitCode = 1;
        return;
      }
    }


    const userIdsJson = JSON.stringify(userIds);

    const countRows = await rt.query(`
      SELECT [owner_user_id], COUNT(*) AS [cnt]
      FROM [prioglpi].[ticket_ranking]
      WHERE [owner_user_id] IN (
        SELECT CAST([value] AS int) FROM OPENJSON(@userIdsJson)
      ) AND [is_active] = 1
      GROUP BY [owner_user_id]
    `, [{ name: 'userIdsJson', type: 'nvarchar', nullable: false, value: userIdsJson, length: 'MAX' } as SqlParameter]);

    const countMap = new Map<number, number>();
    for (const r of countRows) {
      countMap.set(Number(r['owner_user_id']), r['cnt'] as number);
    }

    const peers: PeerInfo[] = [];
    for (const user of group.users) {
      const uid = Number(user.userId);
      const cnt = countMap.get(uid) ?? 0;
      peers.push({
        userId: uid,
        username: user.username,
        displayName: user.displayName,
        activeRankingCount: cnt
      });
    }

    const peersWithRankings = peers.filter(p => p.activeRankingCount > 0);

    // Determinar canonical: menor id del grupo
    const canonicalUser = peers.reduce((a, b) => a.userId < b.userId ? a : b);

    let action: GroupReport['action'];
    let details: string;

    if (peersWithRankings.length === 0) {
      action = 'no_rankings';
      details = 'Ningún usuario tiene rankings activos. Sin acción necesaria.';
    } else if (peersWithRankings.length === 1) {
      const owner = peersWithRankings[0]!;
      if (owner.userId === canonicalUser.userId) {
        action = 'already_canonical';
        details = `Rankings ya pertenecen al canonical (user_id=${owner.userId}).`;
      } else {
        action = 'migrate';
        details = `Mover ${owner.activeRankingCount} ranking(s) de user_id=${owner.userId} (${owner.username}) → canonical user_id=${canonicalUser.userId} (${canonicalUser.username}).`;
      }
    } else {
      action = 'conflict';
      const conflictDetails = peersWithRankings.map(p => `user_id=${p.userId} (${p.username}): ${p.activeRankingCount} rankings`).join(', ');
      details = `CONFLICTO: Múltiples usuarios con rankings activos: ${conflictDetails}. NO se modificará automáticamente. Resolver manualmente.`;
    }

    reports.push({
      sortedGroupIds: group.sortedGroupIds,
      canonicalUserId: canonicalUser.userId,
      canonicalUsername: canonicalUser.username,
      peers,
      action,
      details
    });
  }

  // 5. Imprimir reporte
  for (const report of reports) {
    console.log(`--- Grupo: glpi_group_ids = [${report.sortedGroupIds.join(', ')}] ---`);
    console.log(`  Canonical: user_id=${report.canonicalUserId} (${report.canonicalUsername})`);
    console.log(`  Peers:`);
    for (const p of report.peers) {
      console.log(`    - user_id=${p.userId} (${p.username} / ${p.displayName}): ${p.activeRankingCount} ranking(s) activo(s)`);
    }
    console.log(`  Acción: [${report.action.toUpperCase()}] ${report.details}`);
    console.log('');
  }

  // 6. Ejecutar migraciones si --apply
  const migratable = reports.filter(r => r.action === 'migrate');
  const conflicts = reports.filter(r => r.action === 'conflict');

  if (conflicts.length > 0) {
    console.log(`⚠️  ${conflicts.length} grupo(s) con CONFLICTO. Requieren resolución manual.`);
  }

  if (migratable.length === 0) {
    console.log('No hay migraciones seguras pendientes.');
    await rt.close();
    return;
  }

  if (!applyMode) {
    console.log(`\n${migratable.length} migración(es) pendiente(s). Ejecutar con --apply para aplicar.`);
    await rt.close();
    return;
  }

  console.log(`\nAplicando ${migratable.length} migración(es) segura(s)...\n`);

  for (const report of migratable) {
    const sourceUser = report.peers.find(p => p.activeRankingCount > 0 && p.userId !== report.canonicalUserId);
    if (!sourceUser) {
      console.log(`  [SKIP] Grupo [${report.sortedGroupIds.join(',')}]: no se encontró usuario fuente.`);
      continue;
    }

    try {
      await rt.withTransaction({ isolation: 'serializable' }, async (tx) => {
        // Verificar que el canonical no tiene rankings activos (idempotencia)
        const checkRows = await tx.query(`
          SELECT COUNT(*) AS [cnt]
          FROM [prioglpi].[ticket_ranking]
          WHERE [owner_user_id] = @canonicalUserId AND [is_active] = 1
        `, [{ name: 'canonicalUserId', type: 'int', nullable: false, value: report.canonicalUserId } as SqlParameter]);

        const existingCount = (checkRows[0]?.['cnt'] as number) ?? 0;
        if (existingCount > 0) {
          console.log(`  [SKIP] Grupo [${report.sortedGroupIds.join(',')}]: el canonical user_id=${report.canonicalUserId} ya tiene ${existingCount} ranking(s). Podría ser conflicto. Saltando.`);
          return;
        }

        // Mover rankings del source al canonical
        const affected = await tx.execute(`
          UPDATE [prioglpi].[ticket_ranking]
          SET [owner_user_id] = @canonicalUserId
          WHERE [owner_user_id] = @sourceUserId AND [is_active] = 1
        `, [
          { name: 'canonicalUserId', type: 'int', nullable: false, value: report.canonicalUserId } as SqlParameter,
          { name: 'sourceUserId', type: 'int', nullable: false, value: sourceUser.userId } as SqlParameter
        ]);

        console.log(`  [OK] Grupo [${report.sortedGroupIds.join(',')}]: ${affected} ranking(s) movido(s) de user_id=${sourceUser.userId} → user_id=${report.canonicalUserId}.`);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [ERROR] Grupo [${report.sortedGroupIds.join(',')}]: ${msg}`);
    }
  }

  console.log('\nMigración completada.');
  await rt.close();
}

void main().catch((err) => {
  console.error('Error fatal:', err);
  process.exitCode = 1;
});
