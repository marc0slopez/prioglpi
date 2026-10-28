import { OperationalTicketListExecutionError } from './operational-ticket-list-execution-types';
import type { OperationalTicketListResponseTicket } from './operational-ticket-list-execution-types';
import type { SqlRow } from '../sqlserver-runtime-contract';
import { parseOperationalTicketAssignedGroups, OperationalTicketDetailError } from './operational-ticket-detail';
import type {
  OperationalTicketRanking,
  OperationalTicketCoordination,
  OperationalTicket
} from './operational-ticket-types';

export function mapOperationalTicketListRow(
  row: SqlRow,
  branch: 'ranked' | 'unranked'
): OperationalTicketListResponseTicket {
  if (!row || typeof row !== 'object') {
    throw new OperationalTicketListExecutionError('corrupt_data', 'Row is not an object');
  }

  const getInt = (val: unknown): number => {
    if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < -2147483648 || val > 2147483647) {
      throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid int');
    }
    return val;
  };

  const getIntNullable = (val: unknown): number | null => {
    if (val === null) return null;
    return getInt(val);
  };

  const getPosInt = (val: unknown): number => {
    const n = getInt(val);
    if (n <= 0) throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid positive int');
    return n;
  };

  const getPosIntNullable = (val: unknown): number | null => {
    if (val === null) return null;
    return getPosInt(val);
  };
  const getResultIdNullable = (val: unknown): number | null => {
    if (val === null) return null;
    if (typeof val === 'number' && Number.isSafeInteger(val) && val >= 1 && val <= 2147483647) return val;
    if (typeof val === 'string' && /^[1-9]\d*$/.test(val)) {
      const parsed = Number(val);
      if (Number.isSafeInteger(parsed) && parsed <= 2147483647) return parsed;
    }
    throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid result id');
  };

  const getString = (val: unknown): string => {
    if (typeof val !== 'string') throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid string');
    return val;
  };

  const getStringNullable = (val: unknown): string | null => {
    if (val === null) return null;
    return getString(val);
  };

  const getBit = (val: unknown): boolean => {
    if (val === true || val === 1) return true;
    if (val === false || val === 0) return false;
    throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid bit');
  };

  const getDate = (val: unknown): Date => {
    if (!(val instanceof Date) || !Number.isFinite(val.getTime())) {
      throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid date');
    }
    return new Date(val.getTime());
  };

  const getDateNullable = (val: unknown): Date | null => {
    if (val === null) return null;
    return getDate(val);
  };

  const rawStatus = getInt(row.status);
  if (rawStatus !== 1 && rawStatus !== 2 && rawStatus !== 3 && rawStatus !== 4 && rawStatus !== 5 && rawStatus !== 6) {
    throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid status');
  }
  const status = rawStatus;

  const rawTicket: OperationalTicket = {
    ticketId: getPosInt(row.ticket_id),
    title: getString(row.title),
    contentPlain: getString(row.content_plain),
    status: status,
    statusLabel: getString(row.status_label),
    type: getInt(row.type),
    typeLabel: getString(row.type_label),
    priority: getInt(row.priority),
    priorityLabel: getString(row.priority_label),
    openedAt: getString(row.opened_at),
    updatedAtGlpi: getString(row.updated_at_glpi),
    solvedAt: getStringNullable(row.solved_at),
    closedAt: getStringNullable(row.closed_at),
    requesterName: getString(row.requester_name),
    requesterGroup: getString(row.requester_group),
    assignedTechnician: getString(row.assigned_technician),
    assignedGroupIds: getString(row.assigned_group_ids),
    assignedGroupNames: getString(row.assigned_group_names),
    detectedSector: getString(row.detected_sector),
    isSistemasScope: getBit(row.is_sistemas_scope),
    isTecnologiaScope: getBit(row.is_tecnologia_scope),
    webUrl: getString(row.web_url),
    syncedAt: getDate(row.synced_at),
    requesterUserId: getPosIntNullable(row.requester_user_id),
    requesterGroupId: getPosIntNullable(row.requester_group_id),
    detectedSectorGroupId: getPosIntNullable(row.detected_sector_group_id),
    detectedSectorName: getStringNullable(row.detected_sector_name),
    sectorSource: getStringNullable(row.sector_source),
    categoryId: getIntNullable(row.category_id),
    entityId: getIntNullable(row.entity_id),
    locationId: getIntNullable(row.location_id),
    requestTypeId: getIntNullable(row.request_type_id),
    urgency: getIntNullable(row.urgency),
    impact: getIntNullable(row.impact),
    glpiPriority: getIntNullable(row.glpi_priority)
  };

  let parsedGroups;
  try {
    parsedGroups = parseOperationalTicketAssignedGroups(rawTicket);
  } catch (err: unknown) {
    if (err instanceof OperationalTicketDetailError) {
      throw new OperationalTicketListExecutionError('corrupt_data', 'Corrupt assigned groups');
    }
    throw err;
  }

  const rId = getResultIdNullable(row.ranking_id);
  const rTicketId = getPosIntNullable(row.ranking_ticket_id);
  const rSector = getStringNullable(row.ranking_sector_name);
  const rGlpiGroupId = getPosIntNullable(row.ranking_glpi_group_id);
  const rRankPos = getPosIntNullable(row.ranking_rank_position);
  const rCreatedBy = getPosIntNullable(row.ranking_created_by_user_id);
  const rUpdatedBy = getPosIntNullable(row.ranking_updated_by_user_id);
  const rCreatedAt = getDateNullable(row.ranking_created_at);
  const rUpdatedAt = getDateNullable(row.ranking_updated_at);
  const rIsActive = row.ranking_is_active !== null ? getBit(row.ranking_is_active) : null;

  let rankings: readonly OperationalTicketRanking[] = [];
  if (branch === 'ranked') {
    if (rId === null || rTicketId === null || rSector === null || rGlpiGroupId === null ||
        rRankPos === null || rCreatedBy === null || rUpdatedBy === null ||
        rCreatedAt === null || rUpdatedAt === null || rIsActive === null) {
      throw new OperationalTicketListExecutionError('corrupt_data', 'Partial null ranking in ranked branch');
    }
    if (rTicketId !== rawTicket.ticketId) {
      throw new OperationalTicketListExecutionError('corrupt_data', 'Ranking ticketId mismatch');
    }
    const rank: OperationalTicketRanking = Object.freeze({
      id: rId,
      ticketId: rTicketId,
      sectorName: rSector,
      glpiGroupId: rGlpiGroupId,
      rankPosition: rRankPos,
      createdByUserId: rCreatedBy,
      updatedByUserId: rUpdatedBy,
      createdAt: rCreatedAt,
      updatedAt: rUpdatedAt,
      isActive: rIsActive
    });
    rankings = Object.freeze([rank]);
  } else {
    if (rId !== null || rTicketId !== null || rSector !== null || rGlpiGroupId !== null ||
        rRankPos !== null || rCreatedBy !== null || rUpdatedBy !== null ||
        rCreatedAt !== null || rUpdatedAt !== null || rIsActive !== null) {
      throw new OperationalTicketListExecutionError('corrupt_data', 'NonNull ranking in unranked branch');
    }
    rankings = Object.freeze([]);
  }

  const cId = getResultIdNullable(row.coordination_id);
  const cTicketId = getPosIntNullable(row.coordination_ticket_id);
  const cProgress = getIntNullable(row.coordination_progress_percent);
  const cComment = getStringNullable(row.coordination_comment);
  const cEstDate = getStringNullable(row.coordination_estimated_delivery_date);
  const cUpdatedBy = getPosIntNullable(row.coordination_updated_by_user_id);
  const cUpdatedAt = getDateNullable(row.coordination_updated_at);

  let coordination: OperationalTicketCoordination | null = null;
  if (cId === null && cTicketId === null && cProgress === null && cComment === null && cEstDate === null && cUpdatedBy === null && cUpdatedAt === null) {
    coordination = null;
  } else if (cId !== null && cTicketId !== null && cProgress !== null && cComment !== null && cUpdatedBy !== null && cUpdatedAt !== null) {
    if (cProgress < 0 || cProgress > 100) throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid coordination progress');
    if (cTicketId !== rawTicket.ticketId) throw new OperationalTicketListExecutionError('corrupt_data', 'Coordination ticketId mismatch');
    coordination = Object.freeze({
      id: cId,
      ticketId: cTicketId,
      progressPercent: cProgress,
      coordinatorComment: cComment,
      estimatedDeliveryDate: cEstDate,
      updatedByUserId: cUpdatedBy,
      updatedAt: cUpdatedAt
    });
  } else {
    throw new OperationalTicketListExecutionError('corrupt_data', 'Partial null coordination');
  }

  const ticket: OperationalTicketListResponseTicket = {
    ticketId: rawTicket.ticketId,
    title: rawTicket.title,
    contentPlain: rawTicket.contentPlain,
    status: rawTicket.status,
    statusLabel: rawTicket.statusLabel,
    type: rawTicket.type,
    typeLabel: rawTicket.typeLabel,
    priority: rawTicket.priority,
    priorityLabel: rawTicket.priorityLabel,
    openedAt: rawTicket.openedAt,
    updatedAtGlpi: rawTicket.updatedAtGlpi,
    solvedAt: rawTicket.solvedAt,
    closedAt: rawTicket.closedAt,
    requesterName: rawTicket.requesterName,
    requesterGroup: rawTicket.requesterGroup,
    assignedTechnician: rawTicket.assignedTechnician,
    assignedGroupIds: Object.freeze([...parsedGroups.assignedGroupIds]),
    assignedGroupNames: Object.freeze([...parsedGroups.assignedGroupNames]),
    detectedSector: rawTicket.detectedSector,
    isSistemasScope: rawTicket.isSistemasScope,
    isTecnologiaScope: rawTicket.isTecnologiaScope,
    webUrl: rawTicket.webUrl,
    syncedAt: rawTicket.syncedAt,
    requesterUserId: rawTicket.requesterUserId,
    requesterGroupId: rawTicket.requesterGroupId,
    detectedSectorGroupId: rawTicket.detectedSectorGroupId,
    detectedSectorName: rawTicket.detectedSectorName,
    sectorSource: rawTicket.sectorSource,
    categoryId: rawTicket.categoryId,
    entityId: rawTicket.entityId,
    locationId: rawTicket.locationId,
    requestTypeId: rawTicket.requestTypeId,
    urgency: rawTicket.urgency,
    impact: rawTicket.impact,
    glpiPriority: rawTicket.glpiPriority,
    rankings,
    coordination
  };

  return Object.freeze(ticket);
}
