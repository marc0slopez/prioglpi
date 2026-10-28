import type {
  OperationalTicketListActor,
  OperationalTicketListParseResult,
  OperationalTicketSectorFilter
} from './operational-ticket-list-types';

function parsePositiveInt(val: string | null): number | null {
  if (val === null) return null;
  if (!/^[1-9]\d*$/.test(val)) return null;
  const num = Number(val);
  if (!Number.isSafeInteger(num) || num > 2147483647) return null;
  return num;
}

function parseStrictBoolean(val: string | null): boolean | null {
  if (val === 'true') return true;
  if (val === 'false') return false;
  return null;
}

function normalizeString(val: string | null): string | null {
  if (val === null) return null;
  if (val === '') return null;
  return val;
}

function isValidDateString(val: string | null): boolean {
  if (val === null) return true;
  const num = Date.parse(val);
  return Number.isFinite(num);
}

export function parseOperationalTicketListQuery(
  params: URLSearchParams,
  actor: OperationalTicketListActor
): OperationalTicketListParseResult {
  for (const id of actor.sectorGroupIds) {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
      return { status: 'error', httpStatus: 403, error: 'Invalid sector group ID in actor' };
    }
  }
  const uniqueGroups = new Set(actor.sectorGroupIds);
  if (uniqueGroups.size !== actor.sectorGroupIds.length) {
    return { status: 'error', httpStatus: 403, error: 'Duplicate sector group ID in actor' };
  }

  const pageStr = params.get('page');
  const limitStr = params.get('limit');
  let page = 1;
  if (pageStr !== null) {
    const p = parsePositiveInt(pageStr);
    if (p === null) return { status: 'error', httpStatus: 400, error: 'Invalid page' };
    page = p;
  }

  let limit = 50;
  if (limitStr !== null) {
    const l = parsePositiveInt(limitStr);
    if (l === null) return { status: 'error', httpStatus: 400, error: 'Invalid limit' };
    limit = l > 200 ? 200 : l;
  }

  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset) || offset > 2147483647) {
    return { status: 'error', httpStatus: 400, error: 'Offset overflow' };
  }

  let view: 'open' | 'history' | 'all' = 'open';
  const viewStr = params.get('view');
  if (viewStr === 'open' || viewStr === 'history' || viewStr === 'all') {
    view = viewStr;
  } else if (viewStr !== null) {
    return { status: 'error', httpStatus: 400, error: 'Invalid view' };
  }

  let priority: 'ranked' | 'unranked' | 'all' = 'all';
  const priorityStr = params.get('priority');
  if (priorityStr === 'ranked' || priorityStr === 'unranked' || priorityStr === 'all') {
    priority = priorityStr;
  } else if (priorityStr !== null) {
    return { status: 'error', httpStatus: 400, error: 'Invalid priority' };
  }

  const statusStr = params.get('status');
  let status: number | null = null;
  if (statusStr !== null) {
    status = parsePositiveInt(statusStr);
    if (status === null || status < 1 || status > 6) {
      return { status: 'error', httpStatus: 400, error: 'Invalid status' };
    }
  }

  const referentUserIdStr = params.get('referentUserId');
  const referentUserId = referentUserIdStr === 'all' ? null : parsePositiveInt(referentUserIdStr);
  if (referentUserIdStr !== null && referentUserIdStr !== 'all' && referentUserId === null) {
    return { status: 'error', httpStatus: 400, error: 'Invalid referentUserId' };
  }

  const technicianIdStr = params.get('technicianId');
  const technicianId = technicianIdStr === 'todos' ? null : parsePositiveInt(technicianIdStr);
  if (technicianIdStr !== null && technicianIdStr !== 'todos' && technicianId === null) {
    return { status: 'error', httpStatus: 400, error: 'Invalid technicianId' };
  }

  const ticketId = parsePositiveInt(params.get('ticketId'));
  if (params.get('ticketId') !== null && ticketId === null) return { status: 'error', httpStatus: 400, error: 'Invalid ticketId' };

  const requesterId = parsePositiveInt(params.get('requesterId'));
  if (params.get('requesterId') !== null && requesterId === null) return { status: 'error', httpStatus: 400, error: 'Invalid requesterId' };

  const categoryId = parsePositiveInt(params.get('categoryId'));
  if (params.get('categoryId') !== null && categoryId === null) return { status: 'error', httpStatus: 400, error: 'Invalid categoryId' };

  const entityId = parsePositiveInt(params.get('entityId'));
  if (params.get('entityId') !== null && entityId === null) return { status: 'error', httpStatus: 400, error: 'Invalid entityId' };

  const locationId = parsePositiveInt(params.get('locationId'));
  if (params.get('locationId') !== null && locationId === null) return { status: 'error', httpStatus: 400, error: 'Invalid locationId' };

  const type = parsePositiveInt(params.get('type'));
  if (params.get('type') !== null && type === null) return { status: 'error', httpStatus: 400, error: 'Invalid type' };

  const glpiPriority = parsePositiveInt(params.get('glpiPriority'));
  if (params.get('glpiPriority') !== null && glpiPriority === null) return { status: 'error', httpStatus: 400, error: 'Invalid glpiPriority' };

  const sectorGroupIdStr = params.get('sectorGroupId');
  let sectorGroupId: number | null = null;
  if (sectorGroupIdStr !== null) {
    sectorGroupId = parsePositiveInt(sectorGroupIdStr);
    if (sectorGroupId === null) return { status: 'error', httpStatus: 400, error: 'Invalid sectorGroupId' };
  }

  const from = normalizeString(params.get('from'));
  const to = normalizeString(params.get('to'));
  const toExclusive = normalizeString(params.get('toExclusive'));
  const updatedFrom = normalizeString(params.get('updatedFrom'));
  const updatedTo = normalizeString(params.get('updatedTo'));

  if (!isValidDateString(from) || !isValidDateString(to) || !isValidDateString(toExclusive) || !isValidDateString(updatedFrom) || !isValidDateString(updatedTo)) {
    return { status: 'error', httpStatus: 400, error: 'Invalid date format' };
  }

  if (to !== null && toExclusive !== null) {
    return { status: 'error', httpStatus: 400, error: 'to and toExclusive mutually exclusive' };
  }

  const search = normalizeString(params.get('search'));
  const title = normalizeString(params.get('title'));
  const description = normalizeString(params.get('description'));
  const notes = normalizeString(params.get('notes'));
  const comments = normalizeString(params.get('comments'));

  const isCoordinatorLike = actor.role === 'coordinador_sistemas' || actor.role === 'tecnico_sistemas';

  if (notes !== null && actor.role !== 'admin' && !isCoordinatorLike) {
    return { status: 'error', httpStatus: 403, error: 'notes requires admin or coordinador' };
  }

  const isActiveRankingStr = params.get('isActiveRanking');
  const isUnrankedStr = params.get('isUnranked');
  const hasTPRStr = params.get('hasTPR');
  const tprVencidaStr = params.get('tprVencida');
  const unassignedTechnicianStr = params.get('unassignedTechnician');

  const boolStrArr = [isActiveRankingStr, isUnrankedStr, hasTPRStr, tprVencidaStr, unassignedTechnicianStr];
  for (const b of boolStrArr) {
    if (b !== null && parseStrictBoolean(b) === null) {
      return { status: 'error', httpStatus: 400, error: 'Invalid boolean' };
    }
  }

  const isActiveRanking = parseStrictBoolean(isActiveRankingStr) || false;
  const isUnranked = parseStrictBoolean(isUnrankedStr) || false;
  const hasTPR = parseStrictBoolean(hasTPRStr) || false;
  const tprVencida = parseStrictBoolean(tprVencidaStr) || false;
  const unassignedTechnician = parseStrictBoolean(unassignedTechnicianStr) || false;

  const soporteDycosStr = params.get('soporteDycos');
  let soporteDycosFilter = false;
  if (soporteDycosStr !== null) {
    const parsed = parseStrictBoolean(soporteDycosStr);
    if (parsed === null) return { status: 'error', httpStatus: 400, error: 'Invalid soporteDycos' };
    soporteDycosFilter = parsed;
  }

  if (isActiveRanking && isUnranked) {
    return { status: 'error', httpStatus: 400, error: 'isActiveRanking and isUnranked mutually exclusive' };
  }
  if (technicianId !== null && unassignedTechnician) {
    return { status: 'error', httpStatus: 400, error: 'technicianId and unassignedTechnician mutually exclusive' };
  }
  if (soporteDycosFilter && technicianId !== null) {
    return { status: 'error', httpStatus: 400, error: 'soporteDycos and technicianId mutually exclusive' };
  }
  if (soporteDycosFilter && unassignedTechnician) {
    return { status: 'error', httpStatus: 400, error: 'soporteDycos and unassignedTechnician mutually exclusive' };
  }

  const isDrillDown = isActiveRanking || isUnranked || hasTPR || tprVencida;
  if (isDrillDown && (status === 5 || status === 6)) {
    return { status: 'error', httpStatus: 400, error: 'Drill down does not accept status 5 or 6' };
  }

  const canSeePrivate = actor.role === 'admin' || isCoordinatorLike;

  const sectorStr = normalizeString(params.get('sector'));
  let sector: OperationalTicketSectorFilter = { type: 'all' };

  if (actor.role === 'admin') {
    if (sectorStr !== null && sectorStr !== 'todos') {
      const parsedSector = parsePositiveInt(sectorStr);
      if (parsedSector !== null) {
        sector = { type: 'group_id', id: parsedSector };
      } else {
        sector = { type: 'name', name: sectorStr };
      }
    }
  } else if (isCoordinatorLike) {
    sector = { type: 'all' };
  } else {
    // referente or supervisor
    if (sectorGroupId !== null && !actor.sectorGroupIds.includes(sectorGroupId)) {
      return { status: 'error', httpStatus: 403, error: 'sectorGroupId outside scope' };
    }
    if (sectorStr !== null && sectorStr !== 'todos') {
      const parsedSector = parsePositiveInt(sectorStr);
      if (parsedSector !== null) {
        if (!actor.sectorGroupIds.includes(parsedSector)) {
          return { status: 'error', httpStatus: 403, error: 'sector outside scope' };
        }
        sector = { type: 'group_id', id: parsedSector };
      } else {
        return { status: 'error', httpStatus: 403, error: 'Name sector not allowed' };
      }
    }
  }

  return {
    status: 'success',
    query: {
      actor: { role: actor.role, sectorGroupIds: Object.freeze([...actor.sectorGroupIds]) },
      view,
      priority,
      page,
      limit,
      offset,
      status,
      referentUserId,
      ticketId,
      technicianId,
      requesterId,
      categoryId,
      entityId,
      locationId,
      type,
      glpiPriority,
      sectorGroupId,
      sector,
      from,
      to,
      toExclusive,
      updatedFrom,
      updatedTo,
      search,
      title,
      description,
      notes,
      comments,
      isActiveRanking,
      isUnranked,
      hasTPR,
      tprVencida,
      unassignedTechnician,
      soporteDycosFilter,
      canSeePrivate,
      isDrillDown
    }
  };
}
