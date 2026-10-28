import type { ISqlServerSession, SqlParameter } from '../sqlserver-runtime-contract';
import type { IOperationalTicketListContextRepository } from './operational-ticket-list-context-repository';
import type { OperationalActiveReferentContext } from './operational-ticket-list-context-types';
import { OperationalTicketListContextError } from './operational-ticket-list-context-types';

export class SqlServerOperationalTicketListContextRepository implements IOperationalTicketListContextRepository {
  constructor(private readonly session: ISqlServerSession) {}

  private validateSafeInt(val: unknown): val is number {
    return typeof val === 'number' && Number.isSafeInteger(val) && val >= 1 && val <= 2147483647;
  }

  private parseSafeInt(value: unknown): number | null {
    if (this.validateSafeInt(value)) return value;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;

    const parsed = Number(value);
    return this.validateSafeInt(parsed) ? parsed : null;
  }

  private isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
  }

  async findActiveReferentContext(referentUserId: unknown): Promise<OperationalActiveReferentContext | null> {
    if (!this.validateSafeInt(referentUserId)) {
      throw new OperationalTicketListContextError('invalid_input', 'Invalid referentUserId');
    }

    const sql = `
      WITH ReferentGroups AS (
        SELECT a.[glpi_group_id]
        FROM [prioglpi].[sector_referent_assignment] a
        WHERE a.[referent_user_id] = @referentUserId
          AND a.[glpi_group_id] IS NOT NULL
          AND a.[glpi_group_id] > 0

        UNION

        SELECT s.[glpi_group_id]
        FROM [prioglpi].[user_sector_scope] s
        WHERE s.[user_id] = @referentUserId
          AND s.[glpi_group_id] IS NOT NULL
          AND s.[glpi_group_id] > 0
      )
      SELECT
        u.[id] AS user_id,
        rg.[glpi_group_id] AS glpi_group_id
      FROM [prioglpi].[app_user] u
      LEFT JOIN ReferentGroups rg ON 1 = 1
      WHERE u.[id] = @referentUserId
        AND u.[role] IN (N'referente', N'priorizador')
        AND u.[is_active] = 1
      ORDER BY rg.[glpi_group_id] ASC
    `;

    const params: SqlParameter[] = [{ name: 'referentUserId', type: 'int', nullable: false, value: referentUserId }];
    const rows = await this.session.query(sql, params);

    if (!Array.isArray(rows)) {
      throw new OperationalTicketListContextError('corrupt_data', 'Invalid query result structure');
    }

    if (rows.length === 0) return null;

    const groupIds: number[] = [];
    let expectedUserId: number | null = null;
    let lastGroupId = -1;
    let hasNullGroup = false;

    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        throw new OperationalTicketListContextError('corrupt_data', 'Invalid row in result set');
      }

      const uId = this.parseSafeInt(row.user_id);
      if (uId === null) {
        throw new OperationalTicketListContextError('corrupt_data', 'Invalid user_id in result');
      }

      if (expectedUserId === null) {
        expectedUserId = uId;
        if (expectedUserId !== referentUserId) {
          throw new OperationalTicketListContextError('corrupt_data', 'Mismatched user_id');
        }
      } else if (uId !== expectedUserId) {
        throw new OperationalTicketListContextError('corrupt_data', 'Ambiguous user_id');
      }

      const gIdRaw = row.glpi_group_id;
      if (gIdRaw !== null) {
        const gId = this.parseSafeInt(gIdRaw);
        if (gId === null) {
          throw new OperationalTicketListContextError('corrupt_data', 'Invalid glpi_group_id in result');
        }
        if (gId <= lastGroupId) {
          throw new OperationalTicketListContextError('corrupt_data', 'Unordered or duplicate group');
        }
        groupIds.push(gId);
        lastGroupId = gId;
      } else {
        hasNullGroup = true;
      }
    }

    if (hasNullGroup && rows.length > 1) {
      throw new OperationalTicketListContextError('corrupt_data', 'Mixed or multiple null groups in result');
    }

    if (expectedUserId === null) {
      throw new OperationalTicketListContextError('corrupt_data', 'Missing user_id in processed rows');
    }

    return {
      userId: expectedUserId,
      groupIds: Object.freeze(groupIds)
    };
  }

  async isActiveNonReferentRequesterInGroups(requesterGlpiUserId: unknown, groupIds: unknown): Promise<boolean> {
    if (!this.validateSafeInt(requesterGlpiUserId)) {
      throw new OperationalTicketListContextError('invalid_input', 'Invalid requesterGlpiUserId');
    }

    if (!this.isUnknownArray(groupIds)) {
      throw new OperationalTicketListContextError('invalid_input', 'groupIds must be an array');
    }

    if (groupIds.length === 0) return false;

    if (groupIds.length > 200) {
      throw new OperationalTicketListContextError('invalid_input', 'Exceeded maximum groupIds (200)');
    }

    const uniqueSet = new Set<number>();
    const params: SqlParameter[] = [
      { name: 'requesterGlpiUserId', type: 'int', nullable: false, value: requesterGlpiUserId }
    ];

    const groupNames: string[] = [];
    for (let i = 0; i < groupIds.length; i++) {
      const gId = groupIds[i];
      if (!this.validateSafeInt(gId)) {
        throw new OperationalTicketListContextError('invalid_input', 'Invalid group ID in array');
      }
      if (uniqueSet.has(gId)) {
        throw new OperationalTicketListContextError('invalid_input', 'Duplicate group ID in array');
      }
      uniqueSet.add(gId);

      const paramName = `group${i}`;
      groupNames.push(`@${paramName}`);
      params.push({ name: paramName, type: 'int', nullable: false, value: gId });
    }

    const inClause = groupNames.join(', ');
    const sql = `
      SELECT CAST(CASE WHEN EXISTS (
        SELECT 1
        FROM [prioglpi].[glpi_user_cache] c
        WHERE c.[glpi_user_id] = @requesterGlpiUserId
          AND c.[is_active] = 1
          AND EXISTS (
            SELECT 1
            FROM [prioglpi].[glpi_user_group_membership] m
            WHERE m.[user_id] = c.[glpi_user_id]
              AND m.[group_id] IN (${inClause})
          )
          AND NOT EXISTS (
            SELECT 1
            FROM [prioglpi].[app_user] au
            INNER JOIN [prioglpi].[user_sector_scope] sc ON au.[id] = sc.[user_id]
            WHERE au.[glpi_user_id] = c.[glpi_user_id]
              AND au.[is_active] = 1
              AND au.[role] = N'referente'
              AND sc.[glpi_group_id] IN (${inClause})
          )
      ) THEN 1 ELSE 0 END AS BIT) AS is_allowed
    `;

    const rows = await this.session.query(sql, params);

    if (!Array.isArray(rows)) {
      throw new OperationalTicketListContextError('corrupt_data', 'Invalid query result structure');
    }

    if (rows.length !== 1) {
      throw new OperationalTicketListContextError('corrupt_data', 'Expected exactly one row');
    }

    const row = rows[0];
    if (!row || typeof row !== 'object') {
      throw new OperationalTicketListContextError('corrupt_data', 'Invalid row in result set');
    }

    const isAllowedRaw = row.is_allowed;

    if (isAllowedRaw === true || isAllowedRaw === 1) return true;
    if (isAllowedRaw === false || isAllowedRaw === 0) return false;

    throw new OperationalTicketListContextError('corrupt_data', 'Invalid BIT value for is_allowed');
  }
}
