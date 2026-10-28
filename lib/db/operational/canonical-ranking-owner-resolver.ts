import type { ISqlServerSession, SqlParameter } from '../sqlserver-runtime-contract';

/**
 * resolveCanonicalRankingOwner
 *
 * Dado un priorizador (targetUserId), devuelve el owner_user_id canónico
 * que todos los priorizadores activos con exactamente el mismo set de
 * glpi_group_id en user_sector_scope deben usar para leer/escribir rankings.
 *
 * Reglas de selección del canonical:
 *  1. Se obtienen los glpi_group_id (no-null) del target, ordenados.
 *  2. Se buscan todos los priorizadores activos con exactamente ese set.
 *  3. De ese grupo:
 *     a) Si solo uno tiene rankings activos, ese es el canonical.
 *     b) Si ninguno tiene rankings, el de menor app_user.id.
 *     c) Si varios tienen rankings activos, el de menor app_user.id
 *        (el script de migración debe reportar conflicto en ese caso).
 *
 * La función no altera datos. Es segura para uso en transacciones serializable.
 */

function isValidId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 2147483647;
}

function parsePositiveSqlIntResult(value: unknown): number | null {
  if (isValidId(value)) return value;

  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    return isValidId(parsed) ? parsed : null;
  }

  if (typeof value === 'bigint' && value >= 1n && value <= 2147483647n) {
    return Number(value);
  }

  return null;
}

function parseNonNegativeSafeIntResult(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }

  return null;
}

export class CanonicalOwnerResolverError extends Error {
  constructor(
    public readonly code: 'invalid_input' | 'no_scopes' | 'user_not_found' | 'corrupt_data',
    message: string
  ) {
    super(message);
    this.name = 'CanonicalOwnerResolverError';
  }
}

/**
 * Resultado de la resolución canónica.
 * canonicalOwnerUserId: el user_id que se debe usar para leer/escribir rankings.
 * sortedGroupIds: el set de glpi_group_id que define esta cola.
 * peerUserIds: todos los user_ids del grupo de gemelos (incluye el canonical).
 */
export interface CanonicalOwnerResult {
  readonly canonicalOwnerUserId: number;
  readonly sortedGroupIds: readonly number[];
  readonly peerUserIds: readonly number[];
}

export async function resolveCanonicalRankingOwner(
  targetUserId: number,
  session: ISqlServerSession
): Promise<CanonicalOwnerResult> {
  if (!isValidId(targetUserId)) {
    throw new CanonicalOwnerResolverError('invalid_input', 'Invalid targetUserId');
  }

  // 1. Obtener glpi_group_id del target (solo no-null)
  const scopeRows = await session.query(`
    SELECT s.[glpi_group_id]
    FROM [prioglpi].[user_sector_scope] s
    INNER JOIN [prioglpi].[app_user] u ON u.[id] = s.[user_id]
    WHERE s.[user_id] = @targetUserId
      AND s.[glpi_group_id] IS NOT NULL
      AND u.[is_active] = 1
      AND u.[role] = 'priorizador'
    ORDER BY s.[glpi_group_id] ASC
  `, [
    { name: 'targetUserId', type: 'int', nullable: false, value: targetUserId }
  ]);

  if (scopeRows.length === 0) {
    // El usuario no tiene scopes con glpi_group_id o no es priorizador activo.
    // Devolver el mismo userId como canonical (aislado).
    return Object.freeze({
      canonicalOwnerUserId: targetUserId,
      sortedGroupIds: Object.freeze([]),
      peerUserIds: Object.freeze([targetUserId])
    });
  }

  const sortedGroupIds: number[] = [];
  for (const row of scopeRows) {
    const gid = parsePositiveSqlIntResult(row['glpi_group_id']);
    if (gid === null) {
      throw new CanonicalOwnerResolverError('corrupt_data', 'Invalid glpi_group_id in user_sector_scope');
    }
    sortedGroupIds.push(gid);
  }

  // Verificar unicidad y orden
  for (let i = 1; i < sortedGroupIds.length; i++) {
    if (sortedGroupIds[i]! <= sortedGroupIds[i - 1]!) {
      throw new CanonicalOwnerResolverError('corrupt_data', 'Duplicate or unordered glpi_group_id in user_sector_scope');
    }
  }

  const groupCount = sortedGroupIds.length;

  // 2. Buscar todos los priorizadores activos con exactamente este set de group IDs.
  //    Un usuario es "gemelo" si:
  //    - tiene exactamente groupCount scopes con glpi_group_id no-null
  //    - todos sus glpi_group_id están en nuestro set
  //
  //    Construimos un IN clause dinámico con parámetros.

  const groupParams: SqlParameter[] = [
    { name: 'groupCount', type: 'int', nullable: false, value: groupCount }
  ];
  const groupInClauses: string[] = [];
  for (let i = 0; i < sortedGroupIds.length; i++) {
    const paramName = `g${i}`;
    groupParams.push({ name: paramName, type: 'int', nullable: false, value: sortedGroupIds[i]! });
    groupInClauses.push(`@${paramName}`);
  }

  // Query que encuentra priorizadores activos con exactamente el mismo set de group IDs
  // La lógica:
  //   - COUNT de scopes no-null del candidato que estén en nuestro set = groupCount
  //   - COUNT total de scopes no-null del candidato = groupCount
  //   Esto garantiza match exacto (ni más, ni menos, ni diferentes).
  const peersSql = `
    SELECT
      u.[id] AS [user_id],
      (
        SELECT COUNT(*)
        FROM [prioglpi].[ticket_ranking] r
        WHERE r.[owner_user_id] = u.[id] AND r.[is_active] = 1
      ) AS [active_ranking_count]
    FROM [prioglpi].[app_user] u
    WHERE u.[is_active] = 1
      AND u.[role] = 'priorizador'
      AND (
        SELECT COUNT(*)
        FROM [prioglpi].[user_sector_scope] s
        WHERE s.[user_id] = u.[id]
          AND s.[glpi_group_id] IS NOT NULL
      ) = @groupCount
      AND (
        SELECT COUNT(*)
        FROM [prioglpi].[user_sector_scope] s
        WHERE s.[user_id] = u.[id]
          AND s.[glpi_group_id] IN (${groupInClauses.join(', ')})
      ) = @groupCount
    ORDER BY u.[id] ASC
  `;

  const peerRows = await session.query(peersSql, groupParams);

  if (peerRows.length === 0) {
    // No debería pasar porque al menos el target debería aparecer,
    // pero defensivamente devolvemos el target.
    return Object.freeze({
      canonicalOwnerUserId: targetUserId,
      sortedGroupIds: Object.freeze(sortedGroupIds),
      peerUserIds: Object.freeze([targetUserId])
    });
  }

  // Parsear y validar resultados
  const peers: { userId: number; activeRankingCount: number }[] = [];
  for (const row of peerRows) {
    const uid = parsePositiveSqlIntResult(row['user_id']);
    const cnt = parseNonNegativeSafeIntResult(row['active_ranking_count']);
    if (uid === null) {
      throw new CanonicalOwnerResolverError('corrupt_data', 'Invalid user_id in peer query');
    }
    if (cnt === null) {
      throw new CanonicalOwnerResolverError('corrupt_data', 'Invalid active_ranking_count in peer query');
    }
    peers.push({ userId: uid, activeRankingCount: cnt });
  }

  const peerUserIds = Object.freeze(peers.map(p => p.userId));

  // 3. Elegir canonical owner
  const peersWithRankings = peers.filter(p => p.activeRankingCount > 0);

  let canonicalOwnerUserId: number;

  if (peersWithRankings.length === 1) {
    // Solo uno tiene rankings → ese es el canonical.
    canonicalOwnerUserId = peersWithRankings[0]!.userId;
  } else if (peersWithRankings.length === 0) {
    // Nadie tiene rankings → menor id.
    canonicalOwnerUserId = peers[0]!.userId;
  } else {
    // Varios tienen rankings → menor id (runtime fallback;
    // el script de migración reporta este caso como conflicto).
    canonicalOwnerUserId = peers[0]!.userId;
  }

  return Object.freeze({
    canonicalOwnerUserId,
    sortedGroupIds: Object.freeze(sortedGroupIds),
    peerUserIds
  });
}
