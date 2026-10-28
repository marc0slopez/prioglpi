import type { ISqlServerSession, SqlParameter, SqlRow } from '../sqlserver-runtime-contract';
import type { IOperationalTicketListFilterRepository } from './operational-ticket-list-filter-repository';
import { OperationalTicketListFilterError } from './operational-ticket-list-filter-types';

export class SqlServerOperationalTicketListFilterRepository implements IOperationalTicketListFilterRepository {
  constructor(private readonly session: ISqlServerSession) {}

  private validateSafeInt(val: unknown): val is number {
    return typeof val === 'number' && Number.isSafeInteger(val) && val >= 1 && val <= 2147483647;
  }

  private validateSafeIntOrNull(val: unknown): val is number | null {
    if (val === null) return true;
    return this.validateSafeInt(val);
  }

  private validateText(text: unknown): text is string {
    if (typeof text !== 'string') return false;
    if (text.length === 0 || text.length > 1000) return false;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code <= 31 || code === 127) return false;
    }
    return true;
  }

  private escapeLike(text: string): string {
    return text
      .replace(/~/g, '~~')
      .replace(/%/g, '~%')
      .replace(/_/g, '~_')
      .replace(/\[/g, '~[');
  }

  private parseRows(rows: SqlRow[]): readonly number[] {
    if (!Array.isArray(rows)) {
      throw new OperationalTicketListFilterError('corrupt_data', 'Invalid result set');
    }
    const result: number[] = [];
    let lastId = -1;
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        throw new OperationalTicketListFilterError('corrupt_data', 'Invalid row format');
      }
      const tId = row.ticket_id;
      if (typeof tId !== 'number' || !this.validateSafeInt(tId)) {
        throw new OperationalTicketListFilterError('corrupt_data', 'Invalid ticket_id in row');
      }
      if (tId <= lastId) {
        throw new OperationalTicketListFilterError('corrupt_data', 'Unordered or duplicate ticket_id');
      }
      result.push(tId);
      lastId = tId;
    }
    return Object.freeze(result);
  }

  async listHistoricalRankedTicketIdsByReferent(referentUserId: unknown): Promise<readonly number[]> {
    if (!this.validateSafeInt(referentUserId)) {
      throw new OperationalTicketListFilterError('invalid_input', 'Invalid referentUserId');
    }
    const sql = `
      SELECT DISTINCT [ticket_id]
      FROM [prioglpi].[ticket_ranking]
      WHERE [is_active] = 0
        AND [updated_by_user_id] = @referentUserId
      ORDER BY [ticket_id] ASC
    `;
    const params: SqlParameter[] = [{ name: 'referentUserId', type: 'int', nullable: false, value: referentUserId }];
    return this.parseRows(await this.session.query(sql, params));
  }

  async listTicketIdsByDirectTechnician(technicianGlpiUserId: unknown): Promise<readonly number[]> {
    if (!this.validateSafeInt(technicianGlpiUserId)) {
      throw new OperationalTicketListFilterError('invalid_input', 'Invalid technicianGlpiUserId');
    }
    const sql = `
      SELECT DISTINCT [ticket_id]
      FROM [prioglpi].[glpi_ticket_user_actor]
      WHERE [glpi_user_id] = @technicianGlpiUserId
        AND [actor_type] = 2
      ORDER BY [ticket_id] ASC
    `;
    const params: SqlParameter[] = [{ name: 'technicianGlpiUserId', type: 'int', nullable: false, value: technicianGlpiUserId }];
    return this.parseRows(await this.session.query(sql, params));
  }

  async listTicketIdsByRequester(requesterGlpiUserId: unknown): Promise<readonly number[]> {
    if (!this.validateSafeInt(requesterGlpiUserId)) {
      throw new OperationalTicketListFilterError('invalid_input', 'Invalid requesterGlpiUserId');
    }
    const sql = `
      SELECT DISTINCT [ticket_id]
      FROM [prioglpi].[glpi_ticket_user_actor]
      WHERE [glpi_user_id] = @requesterGlpiUserId
        AND [actor_type] = 1
      ORDER BY [ticket_id] ASC
    `;
    const params: SqlParameter[] = [{ name: 'requesterGlpiUserId', type: 'int', nullable: false, value: requesterGlpiUserId }];
    return this.parseRows(await this.session.query(sql, params));
  }

  async listTicketIdsAssignedToActiveUsersInGroup(groupId: unknown): Promise<readonly number[]> {
    if (!this.validateSafeInt(groupId)) {
      throw new OperationalTicketListFilterError('invalid_input', 'Invalid groupId');
    }
    const sql = `
      SELECT DISTINCT actor.[ticket_id]
      FROM [prioglpi].[glpi_user_group_membership] membership
      INNER JOIN [prioglpi].[glpi_user_cache] cache ON cache.[glpi_user_id] = membership.[user_id]
      INNER JOIN [prioglpi].[glpi_ticket_user_actor] actor ON actor.[glpi_user_id] = cache.[glpi_user_id]
      WHERE membership.[group_id] = @groupId
        AND cache.[is_active] = 1
        AND actor.[actor_type] = 2
      ORDER BY actor.[ticket_id] ASC
    `;
    const params: SqlParameter[] = [{ name: 'groupId', type: 'int', nullable: false, value: groupId }];
    return this.parseRows(await this.session.query(sql, params));
  }

  async listTicketIdsByCanonicalTechnician(technicianGlpiUserId: unknown): Promise<readonly number[]> {
    if (!this.validateSafeIntOrNull(technicianGlpiUserId)) {
      throw new OperationalTicketListFilterError('invalid_input', 'Invalid technicianGlpiUserId');
    }

    const sql = `
      WITH ValidTechs AS (
        SELECT cache.[glpi_user_id]
        FROM [prioglpi].[glpi_user_group_membership] membership
        INNER JOIN [prioglpi].[glpi_user_cache] cache ON cache.[glpi_user_id] = membership.[user_id]
        WHERE membership.[group_id] = 30
          AND cache.[is_active] = 1
          AND cache.[glpi_user_id] <> 231
          AND LOWER(cache.[display_name]) NOT LIKE N'%julián cancio%'
          AND LOWER(cache.[display_name]) NOT LIKE N'%julian cancio%'
          AND LOWER(cache.[display_name]) NOT LIKE N'%joel lugo%'
          AND LOWER(cache.[display_name]) NOT LIKE N'%guillermo kunz%'
          AND NOT EXISTS (
            SELECT 1
            FROM [prioglpi].[app_user] au
            WHERE au.[glpi_user_id] = cache.[glpi_user_id]
              AND au.[role] = N'referente'
          )
      )
      SELECT cache.[ticket_id]
      FROM [prioglpi].[glpi_ticket_cache] cache
      OUTER APPLY (
        SELECT TOP (1) actor.[glpi_user_id] AS canonical_tech_id
        FROM [prioglpi].[glpi_ticket_user_actor] actor
        INNER JOIN ValidTechs vt ON vt.[glpi_user_id] = actor.[glpi_user_id]
        WHERE actor.[ticket_id] = cache.[ticket_id]
          AND actor.[actor_type] = 2
        ORDER BY actor.[id] ASC
      ) AS CanonicalTech
      WHERE cache.[is_sistemas_scope] = 1
        AND (
          (
            @technicianGlpiUserId IS NULL
            AND CanonicalTech.[canonical_tech_id] IS NULL
          )
          OR CanonicalTech.[canonical_tech_id] = @technicianGlpiUserId
        )
      ORDER BY cache.[ticket_id] ASC
    `;
    const params: SqlParameter[] = [{ name: 'technicianGlpiUserId', type: 'int', nullable: true, value: technicianGlpiUserId }];
    return this.parseRows(await this.session.query(sql, params));
  }

  async listTicketIdsByFollowupText(text: unknown, visibility: unknown): Promise<readonly number[]> {
    if (!this.validateText(text)) {
      throw new OperationalTicketListFilterError('invalid_input', 'Invalid followup text');
    }
    if (visibility !== 'all' && visibility !== 'public_only' && visibility !== 'private_only') {
      throw new OperationalTicketListFilterError('invalid_input', 'Invalid visibility value');
    }
    const safeText = this.escapeLike(text);

    let visFilter = '';
    if (visibility === 'public_only') visFilter = 'AND [is_private] = 0';
    else if (visibility === 'private_only') visFilter = 'AND [is_private] = 1';

    const sql = `
      SELECT DISTINCT [ticket_id]
      FROM [prioglpi].[glpi_followup_cache]
      WHERE [content_plain] LIKE N'%' + @pattern + N'%' ESCAPE N'~'
        ${visFilter}
      ORDER BY [ticket_id] ASC
    `;
    const params: SqlParameter[] = [{ name: 'pattern', type: 'nvarchar', length: 2000, nullable: false, value: safeText }];
    return this.parseRows(await this.session.query(sql, params));
  }

  async listTicketIdsByActivityText(text: unknown, visibility: unknown): Promise<readonly number[]> {
    if (!this.validateText(text)) {
      throw new OperationalTicketListFilterError('invalid_input', 'Invalid activity text');
    }
    if (visibility !== 'all' && visibility !== 'public_only') {
      throw new OperationalTicketListFilterError('invalid_input', 'Invalid activity visibility');
    }
    const safeText = this.escapeLike(text);

    let visFilter = '';
    if (visibility === 'public_only') visFilter = 'AND [is_private] = 0';

    const sql = `
      SELECT [ticket_id]
      FROM [prioglpi].[glpi_followup_cache]
      WHERE [content_plain] LIKE N'%' + @pattern + N'%' ESCAPE N'~'
        ${visFilter}
      UNION
      SELECT [ticket_id]
      FROM [prioglpi].[glpi_task_cache]
      WHERE [content_plain] LIKE N'%' + @pattern + N'%' ESCAPE N'~'
        ${visFilter}
      ORDER BY [ticket_id] ASC
    `;
    const params: SqlParameter[] = [{ name: 'pattern', type: 'nvarchar', length: 2000, nullable: false, value: safeText }];
    return this.parseRows(await this.session.query(sql, params));
  }

  async listTicketIdsBySoporteDycosGroup(): Promise<readonly number[]> {
    const sql = `
      SELECT DISTINCT actor.[ticket_id]
      FROM [prioglpi].[glpi_ticket_group_actor] actor
      INNER JOIN [prioglpi].[glpi_group_cache] grp ON grp.[group_id] = actor.[group_id]
      WHERE actor.[actor_type] = 2
        AND (
          LOWER(grp.[complete_name]) LIKE N'%soporte dycos%'
          OR LOWER(grp.[name]) LIKE N'%soporte dycos%'
        )
      UNION
      SELECT DISTINCT ua.[ticket_id]
      FROM [prioglpi].[glpi_ticket_user_actor] ua
      INNER JOIN [prioglpi].[glpi_user_group_membership] m ON m.[user_id] = ua.[glpi_user_id]
      INNER JOIN [prioglpi].[glpi_group_cache] grp ON grp.[group_id] = m.[group_id]
      INNER JOIN [prioglpi].[glpi_user_cache] uc ON uc.[glpi_user_id] = ua.[glpi_user_id]
      WHERE ua.[actor_type] = 2
        AND uc.[is_active] = 1
        AND (
          LOWER(grp.[complete_name]) LIKE N'%soporte dycos%'
          OR LOWER(grp.[name]) LIKE N'%soporte dycos%'
        )
      ORDER BY [ticket_id] ASC
    `;
    return this.parseRows(await this.session.query(sql, []));
  }
}
