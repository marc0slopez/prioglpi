import type { ISqlServerSession, SqlRow } from '../sqlserver-runtime-contract';
import type { IOperationalTicketReadRepository } from './operational-ticket-read-repository';
import { OperationalTicketReadError } from './operational-ticket-read-repository';
import type {
  OperationalTicket,
  OperationalTicketRanking,
  OperationalTicketCoordination,
  OperationalFollowup,
  OperationalTask,
  OperationalUnrankedTicketItem,
  OperationalUnrankedTicketPage
} from './operational-ticket-types';

export class SqlServerOperationalTicketReadRepository implements IOperationalTicketReadRepository {
  constructor(private readonly session: ISqlServerSession) {}

  private parseSqlInt(value: unknown): number | null {
    if (
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= -2147483648 &&
      value <= 2147483647
    ) return value;

    if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)$/.test(value)) return null;

    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= -2147483648 && parsed <= 2147483647
      ? parsed
      : null;
  }

  private validateTicketId(ticketId: number): void {
    if (typeof ticketId !== 'number' || !Number.isSafeInteger(ticketId) || ticketId < 1 || ticketId > 2147483647) {
      throw new OperationalTicketReadError('invalid_input', 'Invalid ticketId');
    }
  }

  private getString(row: SqlRow, col: string): string {
    const val = row[col];
    if (typeof val !== 'string') throw new OperationalTicketReadError('corrupt_data', 'Invalid string');
    return val;
  }

  private getNullableString(row: SqlRow, col: string): string | null {
    const val = row[col];
    if (val === null) return null;
    if (typeof val !== 'string') throw new OperationalTicketReadError('corrupt_data', 'Invalid nullable string');
    return val;
  }

  private getInt(row: SqlRow, col: string): number {
    const val = this.parseSqlInt(row[col]);
    if (val === null) {
      throw new OperationalTicketReadError('corrupt_data', 'Invalid int');
    }
    return val;
  }

  private getPositiveInt(row: SqlRow, col: string): number {
    const val = this.getInt(row, col);
    if (val <= 0) throw new OperationalTicketReadError('corrupt_data', 'Invalid positive int');
    return val;
  }

  private getNullableInt(row: SqlRow, col: string): number | null {
    const raw = row[col];
    if (raw === null) return null;
    const val = this.parseSqlInt(raw);
    if (val === null) {
      throw new OperationalTicketReadError('corrupt_data', 'Invalid nullable int');
    }
    return val;
  }

  private getNullablePositiveInt(row: SqlRow, col: string): number | null {
    const val = this.getNullableInt(row, col);
    if (val !== null && val <= 0) {
      throw new OperationalTicketReadError('corrupt_data', 'Invalid nullable positive int');
    }
    return val;
  }

  private getProgressPercent(row: SqlRow, col: string): number {
    const val = this.getInt(row, col);
    if (val < 0 || val > 100) {
      throw new OperationalTicketReadError('corrupt_data', 'Invalid progress percent');
    }
    return val;
  }

  private getBit(row: SqlRow, col: string): boolean {
    const val = row[col];
    if (val === true) return true;
    if (val === false) return false;
    if (val === 1) return true;
    if (val === 0) return false;
    throw new OperationalTicketReadError('corrupt_data', 'Invalid bit');
  }

  private getDate(row: SqlRow, col: string): Date {
    const val = row[col];
    if (!(val instanceof Date) || Number.isNaN(val.getTime())) {
      throw new OperationalTicketReadError('corrupt_data', 'Invalid date');
    }
    return new Date(val.getTime());
  }

  private mapRowToTicket(row: SqlRow): OperationalTicket {
    const ticketId = this.getPositiveInt(row, 'ticket_id');
    const mapped: OperationalTicket = {
      ticketId,
      title: this.getString(row, 'title'),
      contentPlain: this.getString(row, 'content_plain'),
      status: this.getInt(row, 'status'),
      statusLabel: this.getString(row, 'status_label'),
      type: this.getInt(row, 'type'),
      typeLabel: this.getString(row, 'type_label'),
      priority: this.getInt(row, 'priority'),
      priorityLabel: this.getString(row, 'priority_label'),
      openedAt: this.getString(row, 'opened_at'),
      updatedAtGlpi: this.getString(row, 'updated_at_glpi'),
      solvedAt: this.getNullableString(row, 'solved_at'),
      closedAt: this.getNullableString(row, 'closed_at'),
      requesterName: this.getString(row, 'requester_name'),
      requesterGroup: this.getString(row, 'requester_group'),
      assignedTechnician: this.getString(row, 'assigned_technician'),
      assignedGroupIds: this.getString(row, 'assigned_group_ids'),
      assignedGroupNames: this.getString(row, 'assigned_group_names'),
      detectedSector: this.getString(row, 'detected_sector'),
      isSistemasScope: this.getBit(row, 'is_sistemas_scope'),
      isTecnologiaScope: this.getBit(row, 'is_tecnologia_scope'),
      webUrl: this.getString(row, 'web_url'),
      syncedAt: this.getDate(row, 'synced_at'),
      requesterUserId: this.getNullablePositiveInt(row, 'requester_user_id'),
      requesterGroupId: this.getNullablePositiveInt(row, 'requester_group_id'),
      detectedSectorGroupId: this.getNullablePositiveInt(row, 'detected_sector_group_id'),
      detectedSectorName: this.getNullableString(row, 'detected_sector_name'),
      sectorSource: this.getNullableString(row, 'sector_source'),
      categoryId: this.getNullableInt(row, 'category_id'),
      entityId: this.getNullableInt(row, 'entity_id'),
      locationId: this.getNullableInt(row, 'location_id'),
      requestTypeId: this.getNullableInt(row, 'request_type_id'),
      urgency: this.getNullableInt(row, 'urgency'),
      impact: this.getNullableInt(row, 'impact'),
      glpiPriority: this.getNullableInt(row, 'glpi_priority')
    };
    return mapped;
  }

  private mapRowToCoordination(row: SqlRow, isAlias: boolean = false): OperationalTicketCoordination {
    const p = isAlias ? 'coordination_' : '';
    const commentField = isAlias ? 'coordination_comment' : 'coordinator_comment';
    const ticketId = this.getPositiveInt(row, p + 'ticket_id');
    const mapped: OperationalTicketCoordination = {
      id: this.getPositiveInt(row, p + 'id'),
      ticketId,
      progressPercent: this.getProgressPercent(row, p + 'progress_percent'),
      coordinatorComment: this.getString(row, commentField),
      estimatedDeliveryDate: this.getNullableString(row, p + 'estimated_delivery_date'),
      updatedByUserId: this.getPositiveInt(row, p + 'updated_by_user_id'),
      updatedAt: this.getDate(row, p + 'updated_at')
    };
    return mapped;
  }

  async findTicketById(ticketId: number): Promise<OperationalTicket | null> {
    this.validateTicketId(ticketId);

    const sql = `
      SELECT TOP (2)
        [ticket_id], [title], [content_plain], [status], [status_label],
        [type], [type_label], [priority], [priority_label], [opened_at],
        [updated_at_glpi], [solved_at], [closed_at], [requester_name],
        [requester_group], [assigned_technician], [assigned_group_ids],
        [assigned_group_names], [detected_sector], [is_sistemas_scope],
        [is_tecnologia_scope], [web_url], [synced_at], [requester_user_id],
        [requester_group_id], [detected_sector_group_id], [detected_sector_name],
        [sector_source], [category_id], [entity_id], [location_id],
        [request_type_id], [urgency], [impact], [glpi_priority]
      FROM [prioglpi].[glpi_ticket_cache]
      WHERE [ticket_id] = @ticketId
    `;
    const rows = await this.session.query(sql, [{ name: 'ticketId', type: 'int', nullable: false, value: ticketId }]);

    if (rows.length === 0) return null;
    if (rows.length > 1) throw new OperationalTicketReadError('ambiguous_result', 'Multiple tickets found');

    const mapped = this.mapRowToTicket(rows[0]);

    if (mapped.ticketId !== ticketId) {
      throw new OperationalTicketReadError('corrupt_data', 'Mismatch ticketId in findTicketById');
    }

    return mapped;
  }

  async listActiveRankingsByTicketId(ticketId: number): Promise<readonly OperationalTicketRanking[]> {
    this.validateTicketId(ticketId);

    const sql = `
      SELECT
        [id], [ticket_id], [sector_name], [glpi_group_id], [rank_position],
        [created_by_user_id], [updated_by_user_id], [created_at], [updated_at], [is_active]
      FROM [prioglpi].[ticket_ranking]
      WHERE [ticket_id] = @ticketId AND [is_active] = 1
      ORDER BY [rank_position] ASC, [ticket_id] ASC, [id] ASC
    `;
    const rows = await this.session.query(sql, [{ name: 'ticketId', type: 'int', nullable: false, value: ticketId }]);

    const results: OperationalTicketRanking[] = [];
    for (const row of rows) {
      const isActive = this.getBit(row, 'is_active');
      if (isActive !== true) {
        throw new OperationalTicketReadError('corrupt_data', 'Ranking is_active must be true');
      }

      const mapped: OperationalTicketRanking = {
        id: this.getPositiveInt(row, 'id'),
        ticketId: this.getPositiveInt(row, 'ticket_id'),
        sectorName: this.getString(row, 'sector_name'),
        glpiGroupId: this.getPositiveInt(row, 'glpi_group_id'),
        rankPosition: this.getPositiveInt(row, 'rank_position'),
        createdByUserId: this.getPositiveInt(row, 'created_by_user_id'),
        updatedByUserId: this.getPositiveInt(row, 'updated_by_user_id'),
        createdAt: this.getDate(row, 'created_at'),
        updatedAt: this.getDate(row, 'updated_at'),
        isActive
      };

      if (mapped.ticketId !== ticketId) {
        throw new OperationalTicketReadError('corrupt_data', 'Mismatch ticketId in listActiveRankingsByTicketId');
      }

      if (results.length > 0) {
        const prev = results[results.length - 1];
        if (mapped.rankPosition < prev.rankPosition) {
          throw new OperationalTicketReadError('corrupt_data', 'Out of order rankPosition');
        }
        if (mapped.rankPosition === prev.rankPosition) {
          if (mapped.id <= prev.id) {
            throw new OperationalTicketReadError('corrupt_data', 'Out of order id within rankPosition');
          }
        }
      }

      results.push(mapped);
    }

    return results;
  }

  async findCoordinationByTicketId(ticketId: number): Promise<OperationalTicketCoordination | null> {
    this.validateTicketId(ticketId);

    const sql = `
      SELECT TOP (2)
        [id], [ticket_id], [progress_percent], [coordinator_comment],
        [estimated_delivery_date], [updated_by_user_id], [updated_at]
      FROM [prioglpi].[ticket_coordination]
      WHERE [ticket_id] = @ticketId
    `;
    const rows = await this.session.query(sql, [{ name: 'ticketId', type: 'int', nullable: false, value: ticketId }]);

    if (rows.length === 0) return null;
    if (rows.length > 1) throw new OperationalTicketReadError('ambiguous_result', 'Multiple coordinations found');

    const mapped = this.mapRowToCoordination(rows[0], false);

    if (mapped.ticketId !== ticketId) {
      throw new OperationalTicketReadError('corrupt_data', 'Mismatch ticketId in findCoordinationByTicketId');
    }

    return mapped;
  }

  async listFollowupsByTicketId(ticketId: number): Promise<readonly OperationalFollowup[]> {
    this.validateTicketId(ticketId);

    const sql = `
      SELECT
        [followup_id], [ticket_id], [author], [content_plain],
        [is_private], [created_at], [updated_at]
      FROM [prioglpi].[glpi_followup_cache]
      WHERE [ticket_id] = @ticketId
      ORDER BY [created_at] ASC, [followup_id] ASC
    `;
    const rows = await this.session.query(sql, [{ name: 'ticketId', type: 'int', nullable: false, value: ticketId }]);

    const results: OperationalFollowup[] = [];
    for (const row of rows) {
      const mapped: OperationalFollowup = {
        followupId: this.getPositiveInt(row, 'followup_id'),
        ticketId: this.getPositiveInt(row, 'ticket_id'),
        author: this.getNullableString(row, 'author'),
        contentPlain: this.getString(row, 'content_plain'),
        isPrivate: this.getBit(row, 'is_private'),
        createdAt: this.getDate(row, 'created_at'),
        updatedAt: this.getDate(row, 'updated_at')
      };

      if (mapped.ticketId !== ticketId) {
        throw new OperationalTicketReadError('corrupt_data', 'Mismatch ticketId in listFollowupsByTicketId');
      }

      if (results.length > 0) {
        const prev = results[results.length - 1];
        if (mapped.createdAt.getTime() < prev.createdAt.getTime()) {
          throw new OperationalTicketReadError('corrupt_data', 'Out of order createdAt in followups');
        }
        if (mapped.createdAt.getTime() === prev.createdAt.getTime()) {
          if (mapped.followupId <= prev.followupId) {
            throw new OperationalTicketReadError('corrupt_data', 'Out of order followupId within createdAt');
          }
        }
      }

      results.push(mapped);
    }

    return results;
  }

  async listTasksByTicketId(ticketId: number): Promise<readonly OperationalTask[]> {
    this.validateTicketId(ticketId);

    const sql = `
      SELECT
        [task_id], [ticket_id], [author], [technician], [tech_group],
        [content_plain], [is_private], [state], [created_at], [updated_at]
      FROM [prioglpi].[glpi_task_cache]
      WHERE [ticket_id] = @ticketId
      ORDER BY [created_at] ASC, [task_id] ASC
    `;
    const rows = await this.session.query(sql, [{ name: 'ticketId', type: 'int', nullable: false, value: ticketId }]);

    const results: OperationalTask[] = [];
    for (const row of rows) {
      const mapped: OperationalTask = {
        taskId: this.getPositiveInt(row, 'task_id'),
        ticketId: this.getPositiveInt(row, 'ticket_id'),
        author: this.getNullableString(row, 'author'),
        technician: this.getNullableString(row, 'technician'),
        techGroup: this.getNullableString(row, 'tech_group'),
        contentPlain: this.getString(row, 'content_plain'),
        isPrivate: this.getBit(row, 'is_private'),
        state: this.getInt(row, 'state'),
        createdAt: this.getDate(row, 'created_at'),
        updatedAt: this.getDate(row, 'updated_at')
      };

      if (mapped.ticketId !== ticketId) {
        throw new OperationalTicketReadError('corrupt_data', 'Mismatch ticketId in listTasksByTicketId');
      }

      if (results.length > 0) {
        const prev = results[results.length - 1];
        if (mapped.createdAt.getTime() < prev.createdAt.getTime()) {
          throw new OperationalTicketReadError('corrupt_data', 'Out of order createdAt in tasks');
        }
        if (mapped.createdAt.getTime() === prev.createdAt.getTime()) {
          if (mapped.taskId <= prev.taskId) {
            throw new OperationalTicketReadError('corrupt_data', 'Out of order taskId within createdAt');
          }
        }
      }

      results.push(mapped);
    }

    return results;
  }

  private isUnrankedPageInput(val: unknown): val is { glpiGroupId: unknown; ownerUserId: unknown; page: unknown; limit: unknown } {
    return typeof val === 'object' && val !== null && !Array.isArray(val) &&
      'glpiGroupId' in val && 'ownerUserId' in val && 'page' in val && 'limit' in val;
  }

  async listUnrankedTicketsPage(input: unknown): Promise<OperationalUnrankedTicketPage> {
    if (!this.isUnrankedPageInput(input)) {
      throw new OperationalTicketReadError('invalid_input', 'Invalid input structure for listUnrankedTicketsPage');
    }

    if (
      typeof input.glpiGroupId !== 'number' || !Number.isSafeInteger(input.glpiGroupId) || input.glpiGroupId < 1 || input.glpiGroupId > 2147483647 ||
      typeof input.ownerUserId !== 'number' || !Number.isSafeInteger(input.ownerUserId) || input.ownerUserId < 1 || input.ownerUserId > 2147483647 ||
      typeof input.page !== 'number' || !Number.isSafeInteger(input.page) || input.page < 1 || input.page > 2147483647 ||
      typeof input.limit !== 'number' || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 200
    ) {
      throw new OperationalTicketReadError('invalid_input', 'Invalid input for listUnrankedTicketsPage');
    }

    const glpiGroupId = input.glpiGroupId;
    const ownerUserId = input.ownerUserId;
    const page = input.page;
    const limit = input.limit;

    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647) {
      throw new OperationalTicketReadError('invalid_input', 'Offset overflow in listUnrankedTicketsPage');
    }

    const sqlCount = `
      SELECT COUNT(*) as total
      FROM [prioglpi].[glpi_ticket_cache] t
      WHERE t.[is_sistemas_scope] = 1
        AND t.[status] IN (1, 2, 3, 4)
        AND t.[detected_sector_group_id] = @glpiGroupId
        AND NOT EXISTS (
          SELECT 1
          FROM [prioglpi].[ticket_ranking] r
          WHERE r.[ticket_id] = t.[ticket_id]
            AND r.[is_active] = 1
            AND r.[owner_user_id] = @ownerUserId
        )
    `;

    const countRows = await this.session.query(sqlCount, [
      { name: 'glpiGroupId', type: 'int', nullable: false, value: glpiGroupId },
      { name: 'ownerUserId', type: 'int', nullable: false, value: ownerUserId }
    ]);
    if (countRows.length !== 1) {
      throw new OperationalTicketReadError('corrupt_data', 'Count query returned malformed result');
    }

    const total = this.parseSqlInt(countRows[0]['total']);
    if (total === null || total < 0) {
      throw new OperationalTicketReadError('corrupt_data', 'Invalid total count');
    }

    const sqlData = `
      SELECT
        t.[ticket_id], t.[title], t.[content_plain], t.[status], t.[status_label],
        t.[type], t.[type_label], t.[priority], t.[priority_label], t.[opened_at],
        t.[updated_at_glpi], t.[solved_at], t.[closed_at], t.[requester_name],
        t.[requester_group], t.[assigned_technician], t.[assigned_group_ids],
        t.[assigned_group_names], t.[detected_sector], t.[is_sistemas_scope],
        t.[is_tecnologia_scope], t.[web_url], t.[synced_at], t.[requester_user_id],
        t.[requester_group_id], t.[detected_sector_group_id], t.[detected_sector_name],
        t.[sector_source], t.[category_id], t.[entity_id], t.[location_id],
        t.[request_type_id], t.[urgency], t.[impact], t.[glpi_priority],
        c.[id] AS coordination_id,
        c.[ticket_id] AS coordination_ticket_id,
        c.[progress_percent] AS coordination_progress_percent,
        c.[coordinator_comment] AS coordination_comment,
        c.[estimated_delivery_date] AS coordination_estimated_delivery_date,
        c.[updated_by_user_id] AS coordination_updated_by_user_id,
        c.[updated_at] AS coordination_updated_at
      FROM [prioglpi].[glpi_ticket_cache] t
      LEFT JOIN [prioglpi].[ticket_coordination] c ON c.[ticket_id] = t.[ticket_id]
      WHERE t.[is_sistemas_scope] = 1
        AND t.[status] IN (1, 2, 3, 4)
        AND t.[detected_sector_group_id] = @glpiGroupId
        AND NOT EXISTS (
          SELECT 1
          FROM [prioglpi].[ticket_ranking] r
          WHERE r.[ticket_id] = t.[ticket_id]
            AND r.[is_active] = 1
            AND r.[owner_user_id] = @ownerUserId
        )
      ORDER BY t.[opened_at] DESC, t.[ticket_id] DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    const dataRows = await this.session.query(sqlData, [
      { name: 'glpiGroupId', type: 'int', nullable: false, value: glpiGroupId },
      { name: 'ownerUserId', type: 'int', nullable: false, value: ownerUserId },
      { name: 'offset', type: 'int', nullable: false, value: offset },
      { name: 'limit', type: 'int', nullable: false, value: limit }
    ]);

    const items: OperationalUnrankedTicketItem[] = [];
    const seenIds = new Set<number>();

    for (const row of dataRows) {
      const ticket = this.mapRowToTicket(row);

      if (seenIds.has(ticket.ticketId)) {
        throw new OperationalTicketReadError('corrupt_data', 'Duplicate ticket ID in listUnrankedTicketsPage');
      }
      seenIds.add(ticket.ticketId);

      if (ticket.isSistemasScope !== true) {
        throw new OperationalTicketReadError('corrupt_data', 'Ticket is not in sistemas scope');
      }

      if (![1, 2, 3, 4].includes(ticket.status)) {
        throw new OperationalTicketReadError('corrupt_data', 'Ticket status invalid');
      }

      if (ticket.detectedSectorGroupId !== glpiGroupId) {
        throw new OperationalTicketReadError('corrupt_data', 'Ticket detectedSectorGroupId mismatch');
      }

      let coordination: OperationalTicketCoordination | null = null;
      if (row['coordination_id'] !== null) {
        coordination = this.mapRowToCoordination(row, true);
        if (coordination.ticketId !== ticket.ticketId) {
          throw new OperationalTicketReadError('corrupt_data', 'Coordination ticketId mismatch');
        }
      } else {
        if (
          row['coordination_ticket_id'] !== null ||
          row['coordination_progress_percent'] !== null ||
          row['coordination_comment'] !== null ||
          row['coordination_estimated_delivery_date'] !== null ||
          row['coordination_updated_by_user_id'] !== null ||
          row['coordination_updated_at'] !== null
        ) {
          throw new OperationalTicketReadError('corrupt_data', 'Partial nulls in coordination LEFT JOIN');
        }
      }

      items.push({ ticket, coordination });
    }

    if (total === 0 && items.length !== 0) {
      throw new OperationalTicketReadError('corrupt_data', 'Zero total but returned items');
    }

    if (items.length > limit) {
      throw new OperationalTicketReadError('corrupt_data', 'Too many items returned');
    }

    if (total < items.length) {
      throw new OperationalTicketReadError('corrupt_data', 'Total count smaller than items array');
    }

    return { items, total, page, limit };
  }
}
