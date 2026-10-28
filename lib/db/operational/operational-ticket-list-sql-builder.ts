import type { SqlParameter } from '../sqlserver-runtime-contract';
import type { OperationalTicketListExecutionPlan } from './operational-ticket-list-plan-types';
import type {
  OperationalSqlStatement,
  OperationalTicketListCountProgram,
  OperationalTicketListBranch
} from './operational-ticket-list-sql-types';
import { OperationalTicketListSqlError } from './operational-ticket-list-sql-types';

export function buildOperationalTicketListCountProgram(
  plan: OperationalTicketListExecutionPlan,
  todayArgentina: string
): OperationalTicketListCountProgram {
  validateTodayArgentina(todayArgentina);
  validatePlan(plan);
  const priority = plan.query.priority;
  return Object.freeze({
    rankedCount: priority === 'ranked' || priority === 'all'
      ? buildQuery(plan, 'ranked', todayArgentina, true, 0, 50)
      : null,
    unrankedCount: priority === 'unranked' || priority === 'all'
      ? buildQuery(plan, 'unranked', todayArgentina, true, 0, 50)
      : null
  });
}

export function buildOperationalTicketListPageStatement(
  plan: OperationalTicketListExecutionPlan,
  branch: OperationalTicketListBranch,
  offset: number,
  limit: number,
  todayArgentina: string
): OperationalSqlStatement {
  validateTodayArgentina(todayArgentina);
  validatePlan(plan);
  if (
    (plan.query.priority === 'ranked' && branch !== 'ranked') ||
    (plan.query.priority === 'unranked' && branch !== 'unranked')
  ) {
    throw new OperationalTicketListSqlError('unsupported_branch', 'Branch unsupported for this priority');
  }
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647) {
    throw new OperationalTicketListSqlError('invalid_pagination', 'Invalid offset');
  }
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new OperationalTicketListSqlError('invalid_pagination', 'Invalid limit');
  }
  return buildQuery(plan, branch, todayArgentina, false, offset, limit);
}

function validateTodayArgentina(dateStr: string) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new OperationalTicketListSqlError('invalid_plan', 'Invalid date format');
  }
  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(5, 7), 10);
  const day = parseInt(dateStr.substring(8, 10), 10);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new OperationalTicketListSqlError('invalid_plan', 'Invalid date values');
  }
  const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]) {
    throw new OperationalTicketListSqlError('invalid_plan', 'Invalid day for month');
  }
}

function validateOrderedArray(arr: readonly unknown[]): void {
  if (!Array.isArray(arr)) throw new OperationalTicketListSqlError('invalid_plan', 'Not an array');
  let last = -1;
  for (const v of arr) {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > 2147483647) {
      throw new OperationalTicketListSqlError('invalid_plan', 'Invalid ID in array');
    }
    if (v <= last) {
      throw new OperationalTicketListSqlError('invalid_plan', 'Array must be strictly ascending unique positive integers');
    }
    last = v;
  }
}

function validateUnorderedArray(arr: readonly unknown[]): void {
  if (!Array.isArray(arr)) throw new OperationalTicketListSqlError('invalid_plan', 'Not an array');
  const seen = new Set<number>();
  for (const v of arr) {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > 2147483647) {
      throw new OperationalTicketListSqlError('invalid_plan', 'Invalid ID in array');
    }
    if (seen.has(v)) {
      throw new OperationalTicketListSqlError('invalid_plan', 'Duplicate ID in array');
    }
    seen.add(v);
  }
}

function validatePlan(plan: OperationalTicketListExecutionPlan) {
  if (!plan || typeof plan !== 'object') throw new OperationalTicketListSqlError('invalid_plan', 'Invalid plan');
  if (!plan.query || typeof plan.query !== 'object') throw new OperationalTicketListSqlError('invalid_plan', 'Invalid query');
  const q = plan.query;
  if (!q.actor || typeof q.actor !== 'object') throw new OperationalTicketListSqlError('invalid_plan', 'Invalid actor');
  const validRoles = ['admin', 'coordinador_sistemas', 'tecnico_sistemas', 'priorizador', 'referente'];
  if (!validRoles.includes(q.actor.role)) throw new OperationalTicketListSqlError('invalid_plan', 'Invalid role');
  const validViews = ['open', 'history', 'all'];
  if (!validViews.includes(q.view)) throw new OperationalTicketListSqlError('invalid_plan', 'Invalid view');
  const validPriorities = ['ranked', 'unranked', 'all'];
  if (!validPriorities.includes(q.priority)) throw new OperationalTicketListSqlError('invalid_plan', 'Invalid priority');
  if (typeof q.page !== 'number' || !Number.isSafeInteger(q.page) || q.page < 1 || q.page > 2147483647) {
    throw new OperationalTicketListSqlError('invalid_plan', 'Invalid page');
  }
  if (typeof q.limit !== 'number' || !Number.isSafeInteger(q.limit) || q.limit < 1 || q.limit > 200) {
    throw new OperationalTicketListSqlError('invalid_plan', 'Invalid limit');
  }
  if (typeof q.offset !== 'number' || !Number.isSafeInteger(q.offset) || q.offset < 0 || q.offset > 2147483647) {
    throw new OperationalTicketListSqlError('invalid_plan', 'Invalid offset');
  }
  if (q.offset !== (q.page - 1) * q.limit) {
    throw new OperationalTicketListSqlError('invalid_plan', 'Offset does not match page and limit');
  }
  if (q.status !== null) {
    if (typeof q.status !== 'number' || !Number.isSafeInteger(q.status) || q.status < 1 || q.status > 6) {
      throw new OperationalTicketListSqlError('invalid_plan', 'Invalid status');
    }
  }
  const checkScalar = (v: unknown) => {
    if (v !== null && (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > 2147483647)) {
      throw new OperationalTicketListSqlError('invalid_plan', 'Invalid scalar ID');
    }
  };
  checkScalar(q.referentUserId);
  checkScalar(q.ticketId);
  checkScalar(q.technicianId);
  checkScalar(q.requesterId);
  checkScalar(q.categoryId);
  checkScalar(q.entityId);
  checkScalar(q.locationId);
  checkScalar(q.type);
  checkScalar(q.glpiPriority);
  checkScalar(q.sectorGroupId);
  const checkBool = (v: unknown) => {
    if (typeof v !== 'boolean') throw new OperationalTicketListSqlError('invalid_plan', 'Invalid boolean');
  };
  checkBool(q.isActiveRanking);
  checkBool(q.isUnranked);
  checkBool(q.hasTPR);
  checkBool(q.tprVencida);
  checkBool(q.unassignedTechnician);
  checkBool(q.canSeePrivate);
  checkBool(q.isDrillDown);
  const isCoordinatorLike = q.actor.role === 'coordinador_sistemas' || q.actor.role === 'tecnico_sistemas';
  if (q.actor.role === 'admin' || isCoordinatorLike) {
    if (!q.canSeePrivate) throw new OperationalTicketListSqlError('invalid_plan', 'canSeePrivate mismatch');
  } else {
    if (q.canSeePrivate) throw new OperationalTicketListSqlError('invalid_plan', 'canSeePrivate mismatch');
  }
  if (q.isActiveRanking && q.isUnranked) throw new OperationalTicketListSqlError('invalid_plan', 'DrillDown contradiction');
  const drillDownComputed = q.isActiveRanking || q.isUnranked || q.hasTPR || q.tprVencida;
  if (q.isDrillDown !== drillDownComputed) {
    throw new OperationalTicketListSqlError('invalid_plan', 'isDrillDown state invalid');
  }
  if (q.isDrillDown && q.status !== null && (q.status === 5 || q.status === 6)) {
    throw new OperationalTicketListSqlError('invalid_plan', 'DrillDown cannot have status 5 or 6');
  }
  if (q.technicianId !== null && q.unassignedTechnician) {
    throw new OperationalTicketListSqlError('invalid_plan', 'technicianId and unassignedTechnician mutually exclusive');
  }
  const sector = q.sector;
  if (!sector || typeof sector !== 'object') throw new OperationalTicketListSqlError('invalid_plan', 'Invalid sector');
  if (sector.type === 'all') {
    // ok
  } else if (sector.type === 'group_id') {
    checkScalar(sector.id);
  } else if (sector.type === 'name') {
    const sn = sector.name;
    if (typeof sn !== 'string' || sn.length === 0 || sn.length > 255 || /[\x00-\x1F\x7F]/.test(sn)) {
      throw new OperationalTicketListSqlError('invalid_plan', 'Invalid sector name');
    }
  } else {
    throw new OperationalTicketListSqlError('invalid_plan', 'Invalid sector type');
  }
  const checkText = (v: unknown) => {
    if (v !== null) {
      if (typeof v !== 'string' || v.length === 0 || v.length > 1000 || /[\x00-\x1F\x7F]/.test(v)) {
        throw new OperationalTicketListSqlError('invalid_plan', 'Invalid text field');
      }
    }
  };
  checkText(q.title);
  checkText(q.description);
  checkText(q.search);
  checkText(q.notes);
  checkText(q.comments);
  if (q.notes !== null && !q.canSeePrivate) {
    throw new OperationalTicketListSqlError('invalid_plan', 'notes requires canSeePrivate');
  }
  if (q.search === null && plan.activityTextTicketIds !== null) {
    throw new OperationalTicketListSqlError('invalid_plan', 'activityTextTicketIds must be null if search is null');
  }
  if (q.search !== null && plan.activityTextTicketIds === null) {
    throw new OperationalTicketListSqlError('invalid_plan', 'activityTextTicketIds must be an array if search is not null');
  }
  const checkDate = (v: unknown) => {
    if (v !== null) {
      if (typeof v !== 'string' || v.length === 0 || v.length > 50 || /[\x00-\x1F\x7F]/.test(v)) {
        throw new OperationalTicketListSqlError('invalid_plan', 'Invalid date string');
      }
      if (!Number.isFinite(Date.parse(v))) {
        throw new OperationalTicketListSqlError('invalid_plan', 'Invalid date parse');
      }
    }
  };
  checkDate(q.from);
  checkDate(q.to);
  checkDate(q.toExclusive);
  checkDate(q.updatedFrom);
  checkDate(q.updatedTo);
  if (q.to !== null && q.toExclusive !== null) {
    throw new OperationalTicketListSqlError('invalid_plan', 'to and toExclusive mutually exclusive');
  }
  if (plan.referent === null && q.referentUserId !== null) {
    throw new OperationalTicketListSqlError('invalid_plan', 'Referent mismatch');
  }
  if (plan.referent !== null && q.referentUserId === null) {
    throw new OperationalTicketListSqlError('invalid_plan', 'Referent mismatch');
  }
  if (plan.referent !== null && q.referentUserId !== null) {
    if (plan.referent.userId !== q.referentUserId) throw new OperationalTicketListSqlError('invalid_plan', 'Referent ID mismatch');
    validateOrderedArray(plan.referent.activeGroupIds);
    validateOrderedArray(plan.referent.historicalTicketIds);
  }
  if (plan.includeTicketIds !== null) validateOrderedArray(plan.includeTicketIds);
  validateOrderedArray(plan.excludeTicketIds);
  if (plan.activityTextTicketIds !== null) validateOrderedArray(plan.activityTextTicketIds);
  validateUnorderedArray(q.actor.sectorGroupIds);
}

function escapeLike(text: string): string {
  return text.replace(/[~%_\[]/g, c => '~' + c);
}

function buildQuery(
  plan: OperationalTicketListExecutionPlan,
  branch: OperationalTicketListBranch,
  todayArgentina: string,
  isCount: boolean,
  offset: number,
  limit: number
): OperationalSqlStatement {
  const q = plan.query;
  const where: string[] = [];
  const params: SqlParameter[] = [];
  let pIndex = 1;
  function addInt(value: number): string {
    const pName = `op${pIndex++}`;
    params.push(Object.freeze({ name: pName, type: 'int', nullable: false, value }));
    return `@${pName}`;
  }
  function addNVarChar(value: string, length: number | 'MAX'): string {
    const pName = `op${pIndex++}`;
    params.push(Object.freeze({ name: pName, type: 'nvarchar', nullable: false, value, length }));
    return `@${pName}`;
  }
  function addJsonParamUnordered(arr: readonly number[]): string {
    const sorted = [...arr].sort((a,b) => a - b);
    return addNVarChar(JSON.stringify(sorted), 'MAX');
  }
  function addJsonParamOrdered(arr: readonly number[]): string {
    return addNVarChar(JSON.stringify(arr), 'MAX');
  }
  const role = q.actor.role;
  if (role !== 'admin') {
    where.push('t.[is_sistemas_scope] = 1');
    if (role === 'priorizador' || role === 'referente') {
      const groups = q.actor.sectorGroupIds;
      if (groups.length === 0) {
        where.push('1 = 0');
      } else {
        where.push(`EXISTS (SELECT 1 FROM OPENJSON(${addJsonParamUnordered(groups)}) WITH (val INT '$') WHERE val = t.[detected_sector_group_id])`);
      }
    }
  }
  if (q.sectorGroupId !== null) {
    where.push(`t.[detected_sector_group_id] = ${addInt(q.sectorGroupId)}`);
  } else if (q.sector.type === 'group_id') {
    where.push(`t.[detected_sector_group_id] = ${addInt(q.sector.id)}`);
  } else if (q.sector.type === 'name') {
    where.push(`t.[detected_sector] = ${addNVarChar(q.sector.name, 255)}`);
  }
  if (q.ticketId !== null) where.push(`t.[ticket_id] = ${addInt(q.ticketId)}`);
  if (q.categoryId !== null) where.push(`t.[category_id] = ${addInt(q.categoryId)}`);
  if (q.entityId !== null) where.push(`t.[entity_id] = ${addInt(q.entityId)}`);
  if (q.locationId !== null) where.push(`t.[location_id] = ${addInt(q.locationId)}`);
  if (q.type !== null) where.push(`t.[type] = ${addInt(q.type)}`);
  if (q.glpiPriority !== null) where.push(`t.[glpi_priority] = ${addInt(q.glpiPriority)}`);
  if (plan.includeTicketIds !== null) {
    if (plan.includeTicketIds.length === 0) {
      where.push('1 = 0');
    } else {
      where.push(`EXISTS (SELECT 1 FROM OPENJSON(${addJsonParamOrdered(plan.includeTicketIds)}) WITH (val INT '$') WHERE val = t.[ticket_id])`);
    }
  }
  if (plan.excludeTicketIds.length > 0) {
    where.push(`NOT EXISTS (SELECT 1 FROM OPENJSON(${addJsonParamOrdered(plan.excludeTicketIds)}) WITH (val INT '$') WHERE val = t.[ticket_id])`);
  }
  if (q.title !== null) {
    where.push(`t.[title] LIKE N'%' + ${addNVarChar(escapeLike(q.title), 2000)} + N'%' ESCAPE N'~'`);
  }
  if (q.description !== null) {
    where.push(`t.[content_plain] LIKE N'%' + ${addNVarChar(escapeLike(q.description), 2000)} + N'%' ESCAPE N'~'`);
  }
  if (q.search !== null) {
    const esc = addNVarChar(escapeLike(q.search), 2000);
    const orParts = [
      `t.[title] LIKE N'%' + ${esc} + N'%' ESCAPE N'~'`,
      `t.[content_plain] LIKE N'%' + ${esc} + N'%' ESCAPE N'~'`,
      `t.[requester_name] LIKE N'%' + ${esc} + N'%' ESCAPE N'~'`,
      `t.[detected_sector] LIKE N'%' + ${esc} + N'%' ESCAPE N'~'`
    ];
    if (plan.activityTextTicketIds !== null) {
      if (plan.activityTextTicketIds.length > 0) {
        orParts.push(`EXISTS (SELECT 1 FROM OPENJSON(${addJsonParamOrdered(plan.activityTextTicketIds)}) WITH (val INT '$') WHERE val = t.[ticket_id])`);
      }
    }
    where.push(`(${orParts.join(' OR ')})`);
  }
  if (q.updatedFrom !== null) where.push(`t.[updated_at_glpi] >= ${addNVarChar(q.updatedFrom, 50)}`);
  if (q.updatedTo !== null) where.push(`t.[updated_at_glpi] <= ${addNVarChar(q.updatedTo, 50)}`);

  const applyDateLegacy = (dateParam: string, dateType: string) => {
    if (role === 'coordinador_sistemas' || role === 'tecnico_sistemas') {
      where.push(`((t.[status] IN (1,2,3,4) AND t.[opened_at] ${dateType} ${dateParam}) OR (t.[status] = 5 AND t.[solved_at] ${dateType} ${dateParam}) OR (t.[status] = 6 AND t.[closed_at] ${dateType} ${dateParam}))`);
    } else {
      where.push(`t.[opened_at] ${dateType} ${dateParam}`);
    }
  };
  if (q.from !== null) applyDateLegacy(addNVarChar(q.from, 50), '>=');
  if (q.to !== null) applyDateLegacy(addNVarChar(q.to, 50), '<=');
  if (q.toExclusive !== null) applyDateLegacy(addNVarChar(q.toExclusive, 50), '<');

  if (q.isDrillDown) {
    if (q.status !== null) {
      where.push(`t.[status] = ${addInt(q.status)}`);
    } else {
      where.push(`t.[status] IN (1,2,3,4)`);
    }
    if (q.isActiveRanking) {
      where.push(`EXISTS (SELECT 1 FROM [prioglpi].[ticket_ranking] r WHERE r.[ticket_id] = t.[ticket_id] AND r.[is_active] = 1)`);
    }
    if (q.isUnranked) {
      where.push(`NOT EXISTS (SELECT 1 FROM [prioglpi].[ticket_ranking] r WHERE r.[ticket_id] = t.[ticket_id] AND r.[is_active] = 1)`);
    }
    if (q.hasTPR) {
      where.push(`EXISTS (SELECT 1 FROM [prioglpi].[ticket_coordination] c WHERE c.[ticket_id] = t.[ticket_id] AND c.[estimated_delivery_date] IS NOT NULL)`);
    }
    if (q.tprVencida) {
      where.push(`EXISTS (SELECT 1 FROM [prioglpi].[ticket_coordination] c WHERE c.[ticket_id] = t.[ticket_id] AND c.[estimated_delivery_date] < ${addNVarChar(todayArgentina, 10)})`);
    }
  } else {
    if (q.status !== null) {
      const allowed = q.view === 'open' ? [1,2,3,4] : q.view === 'history' ? [5,6] : [1,2,3,4,5,6];
      if (!allowed.includes(q.status)) {
        where.push('1 = 0');
      } else {
        where.push(`t.[status] = ${addInt(q.status)}`);
      }
    } else {
      if (q.view === 'open') where.push(`t.[status] IN (1,2,3,4)`);
      else if (q.view === 'history') where.push(`t.[status] IN (5,6)`);
    }
  }

  function buildRankedCond(p: OperationalTicketListExecutionPlan, active: boolean): string {
    let cond = `EXISTS (SELECT 1 FROM [prioglpi].[ticket_ranking] r WHERE r.[ticket_id] = t.[ticket_id] AND r.[is_active] = ${active ? '1' : '0'}`;
    cond += ')';
    if (p.referent) {
      if (active) {
        const groups = p.referent.activeGroupIds;
        if (groups.length === 0) return '1 = 0';
        cond += ` AND EXISTS (SELECT 1 FROM OPENJSON(${addJsonParamOrdered(groups)}) WITH (val INT '$') WHERE val = t.[detected_sector_group_id])`;
      } else {
        const h = p.referent.historicalTicketIds;
        if (h.length === 0) return '1 = 0';
        cond += ` AND EXISTS (SELECT 1 FROM OPENJSON(${addJsonParamOrdered(h)}) WITH (val INT '$') WHERE val = t.[ticket_id])`;
      }
    }
    return cond;
  }

  function buildUnrankedCond(p: OperationalTicketListExecutionPlan, active: boolean): string {
    let cond = `NOT EXISTS (SELECT 1 FROM [prioglpi].[ticket_ranking] r WHERE r.[ticket_id] = t.[ticket_id] AND r.[is_active] = ${active ? '1' : '0'}`;
    cond += ')';
    if (p.referent) {
      const groups = p.referent.activeGroupIds;
      if (groups.length === 0) return '1 = 0';
      cond += ` AND EXISTS (SELECT 1 FROM OPENJSON(${addJsonParamOrdered(groups)}) WITH (val INT '$') WHERE val = t.[detected_sector_group_id])`;
    }
    return cond;
  }

  let rankingWhere = '';
  if (branch === 'ranked') {
    if (q.view === 'open') {
      rankingWhere = buildRankedCond(plan, true);
    } else if (q.view === 'history') {
      rankingWhere = buildRankedCond(plan, false);
    } else {
      const wOpen = buildRankedCond(plan, true);
      const wHist = buildRankedCond(plan, false);
      rankingWhere = `((t.[status] IN (1,2,3,4) AND ${wOpen}) OR (t.[status] IN (5,6) AND ${wHist}))`;
    }
  } else {
    if (q.view === 'open') {
      rankingWhere = buildUnrankedCond(plan, true);
    } else if (q.view === 'history') {
      rankingWhere = buildUnrankedCond(plan, false);
    } else {
      const wOpen = buildUnrankedCond(plan, true);
      const wHist = buildUnrankedCond(plan, false);
      rankingWhere = `((t.[status] IN (1,2,3,4) AND ${wOpen}) OR (t.[status] IN (5,6) AND ${wHist}))`;
    }
  }
  where.push(rankingWhere);

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  if (isCount) {
    const countSql = `SELECT COUNT(t.[ticket_id]) AS total FROM [prioglpi].[glpi_ticket_cache] t ${whereClause}`;
    return Object.freeze({ sql: countSql, params: Object.freeze([...params]) });
  }

  const tCols = [
    't.[ticket_id]', 't.[title]', 't.[content_plain]', 't.[status]', 't.[status_label]',
    't.[type]', 't.[type_label]', 't.[priority]', 't.[priority_label]',
    't.[opened_at]', 't.[updated_at_glpi]', 't.[solved_at]', 't.[closed_at]',
    't.[requester_name]', 't.[requester_group]', 't.[assigned_technician]',
    't.[assigned_group_ids]', 't.[assigned_group_names]', 't.[detected_sector]',
    't.[is_sistemas_scope]', 't.[is_tecnologia_scope]', 't.[web_url]', 't.[synced_at]',
    't.[requester_user_id]', 't.[requester_group_id]', 't.[detected_sector_group_id]',
    't.[detected_sector_name]', 't.[sector_source]', 't.[category_id]', 't.[entity_id]',
    't.[location_id]', 't.[request_type_id]', 't.[urgency]', 't.[impact]', 't.[glpi_priority]'
  ].join(', ');

  const cCols = [
    'c.[id] AS [coordination_id]',
    'c.[ticket_id] AS [coordination_ticket_id]',
    'c.[progress_percent] AS [coordination_progress_percent]',
    'c.[coordinator_comment] AS [coordination_comment]',
    'c.[estimated_delivery_date] AS [coordination_estimated_delivery_date]',
    'c.[updated_by_user_id] AS [coordination_updated_by_user_id]',
    'c.[updated_at] AS [coordination_updated_at]'
  ].join(', ');

  let rCols = '';
  if (branch === 'ranked') {
    rCols = [
      'r.[id] AS [ranking_id]',
      'r.[ticket_id] AS [ranking_ticket_id]',
      'r.[sector_name] AS [ranking_sector_name]',
      'r.[glpi_group_id] AS [ranking_glpi_group_id]',
      'r.[rank_position] AS [ranking_rank_position]',
      'r.[created_by_user_id] AS [ranking_created_by_user_id]',
      'r.[updated_by_user_id] AS [ranking_updated_by_user_id]',
      'r.[created_at] AS [ranking_created_at]',
      'r.[updated_at] AS [ranking_updated_at]',
      'r.[is_active] AS [ranking_is_active]'
    ].join(', ');
  } else {
    rCols = [
      'CAST(NULL AS INT) AS [ranking_id]',
      'CAST(NULL AS INT) AS [ranking_ticket_id]',
      'CAST(NULL AS NVARCHAR(255)) AS [ranking_sector_name]',
      'CAST(NULL AS INT) AS [ranking_glpi_group_id]',
      'CAST(NULL AS INT) AS [ranking_rank_position]',
      'CAST(NULL AS INT) AS [ranking_created_by_user_id]',
      'CAST(NULL AS INT) AS [ranking_updated_by_user_id]',
      'CAST(NULL AS DATETIME2(3)) AS [ranking_created_at]',
      'CAST(NULL AS DATETIME2(3)) AS [ranking_updated_at]',
      'CAST(NULL AS BIT) AS [ranking_is_active]'
    ].join(', ');
  }

  let fromClause = `[prioglpi].[glpi_ticket_cache] t`;
  if (branch === 'ranked') {
    const applyViewActive = q.view === 'open' ? '1' : q.view === 'history' ? '0' : 'CASE WHEN t.[status] IN (1,2,3,4) THEN 1 ELSE 0 END';
    let authorFilter = '';
    if (plan.referent) {
      if (q.view === 'history') {
        authorFilter = ` AND r.[updated_by_user_id] = ${addInt(plan.referent.userId)}`;
      } else if (q.view === 'all') {
        authorFilter = ` AND (r.[is_active] = 1 OR r.[updated_by_user_id] = ${addInt(plan.referent.userId)})`;
      }
    }
    fromClause += ` OUTER APPLY (
      SELECT
        r.[id], r.[ticket_id], r.[sector_name], r.[glpi_group_id], r.[rank_position],
        r.[created_by_user_id], r.[updated_by_user_id], r.[created_at], r.[updated_at], r.[is_active]
      FROM [prioglpi].[ticket_ranking] r
      WHERE r.[ticket_id] = t.[ticket_id]
        AND r.[is_active] = ${applyViewActive}
        ${authorFilter}
      ORDER BY r.[rank_position] ASC, r.[ticket_id] ASC, r.[id] ASC
      OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY
    ) r`;
  }
  fromClause += ` LEFT JOIN [prioglpi].[ticket_coordination] c ON c.[ticket_id] = t.[ticket_id]`;

  const orderBy = branch === 'ranked'
    ? `ORDER BY [ranking_rank_position] ASC, t.[ticket_id] ASC, [ranking_id] ASC`
    : `ORDER BY t.[opened_at] DESC, t.[ticket_id] DESC`;

  const pageSql = `SELECT ${tCols}, ${rCols}, ${cCols} FROM ${fromClause} ${whereClause} ${orderBy} OFFSET ${addInt(offset)} ROWS FETCH NEXT ${addInt(limit)} ROWS ONLY`;
  return Object.freeze({ sql: pageSql, params: Object.freeze([...params]) });
}
