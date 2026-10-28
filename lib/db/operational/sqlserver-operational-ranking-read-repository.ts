import type { ISqlServerSession, SqlParameter } from '../sqlserver-runtime-contract';
import type { IOperationalRankingReadRepository } from './operational-ranking-read-repository';
import { OperationalRankingReadError } from './operational-ranking-read-repository';
import type {
  OperationalRankingListItem,
  OperationalRankingListTicket,
  OperationalRankingListCoordination
} from './operational-ranking-list-types';

function isPositiveSqlInt(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 1 && val <= 2147483647;
}

function parsePositiveSqlIntResult(value: unknown): number | null {
  if (isPositiveSqlInt(value)) return value;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;

  const parsed = Number(value);
  return isPositiveSqlInt(parsed) ? parsed : null;
}

function isSqlInt(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= -2147483648 && val <= 2147483647;
}

function isValidDate(val: unknown): val is Date {
  return val instanceof Date && !isNaN(val.getTime());
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// validateGroupIds removed as we now filter by ownerUserId

const EXPECTED_KEYS: readonly string[] = Object.freeze([
  'ranking_id', 'ranking_ticket_id', 'ranking_sector_name', 'ranking_glpi_group_id',
  'ranking_rank_position', 'ranking_is_active', 'ranking_created_at', 'ranking_updated_at',
  'ranking_created_by', 'ranking_updated_by', 'ranking_priority_set_by',
  'ticket_id', 'ticket_title', 'ticket_status', 'ticket_status_label', 'ticket_type', 'ticket_type_label', 'ticket_priority',
  'ticket_opened_at', 'ticket_requester_name', 'ticket_assigned_technician',
  'ticket_detected_sector', 'ticket_web_url', 'ticket_is_sistemas_scope',
  'coordination_id', 'coordination_ticket_id', 'coordination_progress_percent',
  'coordination_comment', 'coordination_estimated_delivery_date', 'coordination_updated_at'
]);

function parseRankingRows(rows: readonly unknown[]): readonly OperationalRankingListItem[] {
  const rankings: OperationalRankingListItem[] = [];
  const seenRankIds = new Set<number>();
  const seenTicketIds = new Set<number>();

  let expectedRank = -1;
  let lastTicketId = -1;
  let lastRankingId = -1;
  let isFirst = true;

  for (const row of rows) {
    if (!isRecord(row)) {
      throw new OperationalRankingReadError('corrupt_data', 'Invalid row type');
    }
    const keys = Object.keys(row);
    if (keys.length !== 30) {
      throw new OperationalRankingReadError('corrupt_data', 'Invalid columns length');
    }
    for (let i = 0; i < 30; i++) {
      if (!Object.prototype.hasOwnProperty.call(row, EXPECTED_KEYS[i])) {
        throw new OperationalRankingReadError('corrupt_data', 'Missing expected column');
      }
    }

    const {
      ranking_id, ranking_ticket_id, ranking_sector_name, ranking_glpi_group_id,
      ranking_rank_position, ranking_is_active, ranking_created_at, ranking_updated_at,
      ranking_created_by, ranking_updated_by, ranking_priority_set_by,
      ticket_id, ticket_title, ticket_status, ticket_status_label, ticket_type, ticket_type_label, ticket_priority,
      ticket_opened_at, ticket_requester_name, ticket_assigned_technician,
      ticket_detected_sector, ticket_web_url, ticket_is_sistemas_scope,
      coordination_id, coordination_ticket_id, coordination_progress_percent,
      coordination_comment, coordination_estimated_delivery_date, coordination_updated_at
    } = row;

    const rankingId = parsePositiveSqlIntResult(ranking_id);
    if (rankingId === null) throw new OperationalRankingReadError('corrupt_data', 'Invalid ranking_id');
    if (!isPositiveSqlInt(ranking_ticket_id)) throw new OperationalRankingReadError('corrupt_data', 'Invalid ranking_ticket_id');
    if (typeof ranking_sector_name !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid ranking_sector_name');
    if (!isPositiveSqlInt(ranking_glpi_group_id)) throw new OperationalRankingReadError('corrupt_data', 'Invalid ranking_glpi_group_id');
    if (!isPositiveSqlInt(ranking_rank_position)) throw new OperationalRankingReadError('corrupt_data', 'Invalid ranking_rank_position');
    if (ranking_is_active !== true && ranking_is_active !== 1) throw new OperationalRankingReadError('corrupt_data', 'Invalid ranking_is_active');
    if (!isValidDate(ranking_created_at)) throw new OperationalRankingReadError('corrupt_data', 'Invalid ranking_created_at');
    if (!isValidDate(ranking_updated_at)) throw new OperationalRankingReadError('corrupt_data', 'Invalid ranking_updated_at');
    if (typeof ranking_created_by !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid ranking_created_by');
    if (typeof ranking_updated_by !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid ranking_updated_by');
    if (typeof ranking_priority_set_by !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid ranking_priority_set_by');

    // Filter by allowedOwnerUserId removed since we now filter by glpi_group_id

    if (!isPositiveSqlInt(ticket_id)) throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_id');
    if (ticket_id !== ranking_ticket_id) throw new OperationalRankingReadError('corrupt_data', 'Ticket ID mismatch');
    if (typeof ticket_title !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_title');
    if (typeof ticket_status !== 'number' || !Number.isSafeInteger(ticket_status)) throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_status');
    if (ticket_status !== 1 && ticket_status !== 2 && ticket_status !== 3 && ticket_status !== 4) throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_status value');
    if (typeof ticket_status_label !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_status_label');
    if (typeof ticket_type !== 'number' || !Number.isSafeInteger(ticket_type)) throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_type');
    if (typeof ticket_type_label !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_type_label');
    if (!isSqlInt(ticket_priority)) throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_priority');
    if (typeof ticket_opened_at !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_opened_at');
    if (typeof ticket_requester_name !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_requester_name');
    if (typeof ticket_assigned_technician !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_assigned_technician');
    if (typeof ticket_detected_sector !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_detected_sector');
    if (typeof ticket_web_url !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_web_url');
    if (ticket_is_sistemas_scope !== true && ticket_is_sistemas_scope !== 1) throw new OperationalRankingReadError('corrupt_data', 'Invalid ticket_is_sistemas_scope');

    let coordination: OperationalRankingListCoordination | null = null;
    const isCoordNull = coordination_id === null;

    if (isCoordNull) {
      if (
        coordination_ticket_id !== null ||
        coordination_progress_percent !== null ||
        coordination_comment !== null ||
        coordination_estimated_delivery_date !== null ||
        coordination_updated_at !== null
      ) {
        throw new OperationalRankingReadError('corrupt_data', 'Partial null coordination');
      }
    } else {
      if (parsePositiveSqlIntResult(coordination_id) === null) throw new OperationalRankingReadError('corrupt_data', 'Invalid coordination_id');
      if (!isPositiveSqlInt(coordination_ticket_id)) throw new OperationalRankingReadError('corrupt_data', 'Invalid coordination_ticket_id');
      if (coordination_ticket_id !== ranking_ticket_id) throw new OperationalRankingReadError('corrupt_data', 'Coordination ticket ID mismatch');
      if (typeof coordination_progress_percent !== 'number' || !Number.isSafeInteger(coordination_progress_percent) || coordination_progress_percent < 0 || coordination_progress_percent > 100) throw new OperationalRankingReadError('corrupt_data', 'Invalid coordination_progress_percent');
      if (typeof coordination_comment !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid coordination_comment');
      if (coordination_estimated_delivery_date !== null && typeof coordination_estimated_delivery_date !== 'string') throw new OperationalRankingReadError('corrupt_data', 'Invalid coordination_estimated_delivery_date');
      if (!isValidDate(coordination_updated_at)) throw new OperationalRankingReadError('corrupt_data', 'Invalid coordination_updated_at');

      coordination = Object.freeze({
        progressPercent: coordination_progress_percent,
        coordinatorComment: coordination_comment.slice(),
        estimatedDeliveryDate: coordination_estimated_delivery_date !== null ? coordination_estimated_delivery_date.slice() : null,
        updatedAt: new Date(coordination_updated_at.getTime())
      });
    }

    if (seenRankIds.has(rankingId)) {
      throw new OperationalRankingReadError('corrupt_data', 'Duplicate ranking_id');
    }
    seenRankIds.add(rankingId);

    if (seenTicketIds.has(ticket_id)) {
      throw new OperationalRankingReadError('corrupt_data', 'Duplicate ticket in owner queue');
    }
    seenTicketIds.add(ticket_id);

    if (isFirst) {
      expectedRank = ranking_rank_position;
      lastTicketId = ticket_id;
      lastRankingId = rankingId;
      isFirst = false;
    } else {
      const isOrdered =
        ranking_rank_position > expectedRank ||
        (ranking_rank_position === expectedRank && (
          ticket_id > lastTicketId ||
          (ticket_id === lastTicketId && rankingId > lastRankingId)
        ));
      if (!isOrdered) {
        throw new OperationalRankingReadError('corrupt_data', 'Out of order result');
      }
      expectedRank = ranking_rank_position;
      lastTicketId = ticket_id;
      lastRankingId = rankingId;
    }

    const ticket: OperationalRankingListTicket = Object.freeze({
      ticketId: ticket_id,
      title: ticket_title.slice(),
      status: ticket_status,
      statusLabel: ticket_status_label.slice(),
      type: ticket_type,
      typeLabel: ticket_type_label.slice(),
      priority: ticket_priority,
      openedAt: ticket_opened_at.slice(),
      requesterName: ticket_requester_name.slice(),
      assignedTechnician: ticket_assigned_technician.slice(),
      detectedSector: ticket_detected_sector.slice(),
      webUrl: ticket_web_url.slice(),
      coordination
    });

    const item: OperationalRankingListItem = Object.freeze({
      id: rankingId,
      ticketId: ranking_ticket_id,
      sectorName: ranking_sector_name.slice(),
      glpiGroupId: ranking_glpi_group_id,
      rankPosition: ranking_rank_position,
      isActive: true,
      createdBy: ranking_created_by.slice(),
      updatedBy: ranking_updated_by.slice(),
      prioritySetBy: ranking_priority_set_by.slice(),
      createdAt: new Date(ranking_created_at.getTime()),
      updatedAt: new Date(ranking_updated_at.getTime()),
      ticket
    });

    rankings.push(item);
  }

  return Object.freeze(rankings);
}

export class SqlServerOperationalRankingReadRepository implements IOperationalRankingReadRepository {
  constructor(private readonly session: ISqlServerSession) {}

  async listActiveRankings(ownerUserId: number | readonly number[] | null): Promise<readonly OperationalRankingListItem[]> {
    if (Array.isArray(ownerUserId)) throw new OperationalRankingReadError('invalid_input', 'Legacy group filtering is not supported by owner queues');
    if (ownerUserId !== null && !isPositiveSqlInt(ownerUserId)) throw new OperationalRankingReadError('invalid_input', 'Invalid ownerUserId');
    const params: SqlParameter[] = ownerUserId === null ? [] : [{ name: 'ownerUserId', type: 'int', nullable: false, value: ownerUserId }];
    const filterClause = ownerUserId === null ? '(1=0)' : 'r.[owner_user_id] = @ownerUserId';

    const sql = `
      SELECT
        r.[id] AS [ranking_id],
        r.[ticket_id] AS [ranking_ticket_id],
        r.[sector_name] AS [ranking_sector_name],
        r.[glpi_group_id] AS [ranking_glpi_group_id],
        r.[rank_position] AS [ranking_rank_position],
        r.[is_active] AS [ranking_is_active],
        r.[created_at] AS [ranking_created_at],
        r.[updated_at] AS [ranking_updated_at],
        created_user.[display_name] AS [ranking_created_by],
        updated_user.[display_name] AS [ranking_updated_by],
        priority_user.[display_name] AS [ranking_priority_set_by],
        t.[ticket_id] AS [ticket_id],
        t.[title] AS [ticket_title],
        t.[status] AS [ticket_status],
        t.[status_label] AS [ticket_status_label],
        t.[type] AS [ticket_type],
        t.[type_label] AS [ticket_type_label],
        t.[priority] AS [ticket_priority],
        t.[opened_at] AS [ticket_opened_at],
        t.[requester_name] AS [ticket_requester_name],
        t.[assigned_technician] AS [ticket_assigned_technician],
        t.[detected_sector] AS [ticket_detected_sector],
        t.[web_url] AS [ticket_web_url],
        t.[is_sistemas_scope] AS [ticket_is_sistemas_scope],
        c.[id] AS [coordination_id],
        c.[ticket_id] AS [coordination_ticket_id],
        c.[progress_percent] AS [coordination_progress_percent],
        c.[coordinator_comment] AS [coordination_comment],
        c.[estimated_delivery_date] AS [coordination_estimated_delivery_date],
        c.[updated_at] AS [coordination_updated_at]
      FROM [prioglpi].[ticket_ranking] r
      INNER JOIN [prioglpi].[glpi_ticket_cache] t ON r.[ticket_id] = t.[ticket_id]
      INNER JOIN [prioglpi].[app_user] created_user ON r.[created_by_user_id] = created_user.[id]
      INNER JOIN [prioglpi].[app_user] updated_user ON r.[updated_by_user_id] = updated_user.[id]
      INNER JOIN [prioglpi].[app_user] priority_user ON r.[priority_set_by_user_id] = priority_user.[id]
      LEFT JOIN [prioglpi].[ticket_coordination] c ON r.[ticket_id] = c.[ticket_id]
      WHERE r.[is_active] = 1
        AND t.[is_sistemas_scope] = 1
        AND t.[status] IN (1, 2, 3, 4)
        AND ${filterClause}
      ORDER BY
        r.[rank_position] ASC,
        r.[ticket_id] ASC,
        r.[id] ASC
    `;

    const rows = await this.session.query(sql, params);
    return parseRankingRows(rows);
  }
}
