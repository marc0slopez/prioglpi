import type { ISqlServerSession, SqlParameter } from '../sqlserver-runtime-contract';
import { filterValidTechUsers, getCanonicalTechnician } from '../../ticket-helpers';

export interface CoordinatorMetricsInput {
  period: string;
  range: { start: string; end: string };
  status?: number;
  view: string;
  unassignedTechnician: boolean;
  technicianId?: number;
  sectorGroupId?: number;
  requesterId?: number;
}

export interface ReferentMetricsInput {
  range: { start: string; end: string };
  status?: number;
  sectorGroupId?: number;
  userRole: string;
  userSectorGroupIds: number[];
  ownerUserId: number;
  technicianId?: number;
  unassignedTechnician?: boolean;
  requesterId?: number;
}

export interface SupervisorMetricsInput {
  range: { start: string; end: string };
  status?: number;
  requester?: string;
  userRole: string;
  userSectorGroupIds: number[];
}

export class SqlServerOperationalMetricsRepository {
  constructor(private readonly session: ISqlServerSession) {}

  private getTodayStr(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
  }

  // --- 1. COORDINATOR METRICS ---
  public async getCoordinatorMetrics(input: CoordinatorMetricsInput) {
    const params: SqlParameter[] = [];

    let statusFilterClause = '';
    if (input.status !== undefined) {
      statusFilterClause = ' AND t.[status] = @status';
      params.push({ name: 'status', type: 'int', nullable: false, value: input.status });
    }

    let crossFilterJoins = '';
    let crossFilterWhere = '';

    if (input.requesterId !== undefined) {
      crossFilterJoins += ' INNER JOIN [prioglpi].[glpi_ticket_user_actor] cxreq ON t.[ticket_id] = cxreq.[ticket_id] AND cxreq.[actor_type] = 1 AND cxreq.[glpi_user_id] = @requesterId ';
      params.push({ name: 'requesterId', type: 'int', nullable: false, value: input.requesterId });
    }
    if (input.technicianId !== undefined) {
      crossFilterJoins += ' INNER JOIN [prioglpi].[glpi_ticket_user_actor] cxtech ON t.[ticket_id] = cxtech.[ticket_id] AND cxtech.[actor_type] = 2 AND cxtech.[glpi_user_id] = @technicianId ';
      params.push({ name: 'technicianId', type: 'int', nullable: false, value: input.technicianId });
    }
    if (input.sectorGroupId !== undefined) {
      crossFilterWhere += ' AND t.[detected_sector_group_id] = @sectorGroupId ';
      params.push({ name: 'sectorGroupId', type: 'int', nullable: false, value: input.sectorGroupId });
    }
    if (input.unassignedTechnician) {
      crossFilterWhere += ' AND NOT EXISTS (SELECT 1 FROM [prioglpi].[glpi_ticket_user_actor] untech WHERE untech.[ticket_id] = t.[ticket_id] AND untech.[actor_type] = 2) ';
    }

    // A. Backlog tickets (is_sistemas_scope = 1, status IN (1, 2, 3, 4))
    const backlogSql = `
      SELECT
        t.[ticket_id],
        c.[progress_percent],
        CASE WHEN EXISTS (SELECT 1 FROM [prioglpi].[ticket_ranking] r WHERE r.[ticket_id] = t.[ticket_id] AND r.[is_active] = 1) THEN 1 ELSE 0 END AS [has_ranking]
      FROM [prioglpi].[glpi_ticket_cache] t
      ${crossFilterJoins}
      LEFT JOIN [prioglpi].[ticket_coordination] c ON t.[ticket_id] = c.[ticket_id]
      WHERE t.[is_sistemas_scope] = 1 AND t.[status] IN (1, 2, 3, 4)
        ${statusFilterClause} ${crossFilterWhere};
    `;
    const backlogRows = await this.session.query(backlogSql, params);

    let prioritized = 0;
    let totalProgress = 0;

    for (const r of backlogRows) {
      if (r['has_ranking'] === 1) prioritized++;
      const progress = typeof r['progress_percent'] === 'number' ? r['progress_percent'] : 0;
      totalProgress += progress;
    }
    const backlogLength = backlogRows.length;
    const avancePromedio = backlogLength > 0 ? Math.round(totalProgress / backlogLength) : 0;

    // B. KPI Ingresados (opened_at in range)
    const ingresadosSql = `
      SELECT COUNT(*) AS [c]
      FROM [prioglpi].[glpi_ticket_cache] t
      ${crossFilterJoins}
      WHERE t.[is_sistemas_scope] = 1 AND t.[opened_at] >= @start AND t.[opened_at] < @end
        ${statusFilterClause} ${crossFilterWhere};
    `;
    const ingresadosParams = [...params,
      { name: 'start', type: 'nvarchar' as const, length: 50, nullable: false, value: input.range.start },
      { name: 'end', type: 'nvarchar' as const, length: 50, nullable: false, value: input.range.end }
    ];
    const ingresadosRows = await this.session.query(ingresadosSql, ingresadosParams);
    const kpiIngresadosCount = typeof ingresadosRows[0]?.['c'] === 'number' ? ingresadosRows[0]['c'] : 0;

    // C. Valid Technicians
    const group30MembersSql = `
      SELECT [user_id] FROM [prioglpi].[glpi_user_group_membership] WHERE [group_id] = 30;
    `;
    const group30Rows = await this.session.query(group30MembersSql);
    const techUserIds = group30Rows.map(r => Number(r['user_id'])).filter(id => Number.isSafeInteger(id) && id > 0);

    let activeTechUsers: { glpiUserId: number; displayName: string }[] = [];
    if (techUserIds.length > 0) {
      const activeTechSql = `
        SELECT [glpi_user_id], [display_name]
        FROM [prioglpi].[glpi_user_cache]
        WHERE [is_active] = 1 AND [glpi_user_id] IN (${techUserIds.map((_, i) => `@uid${i}`).join(', ')});
      `;
      const activeTechParams: SqlParameter[] = techUserIds.map((id, i) => ({
        name: `uid${i}`, type: 'int', nullable: false, value: id
      }));
      const activeTechRows = await this.session.query(activeTechSql, activeTechParams);
      activeTechUsers = activeTechRows.map(r => ({
        glpiUserId: Number(r['glpi_user_id']),
        displayName: String(r['display_name'])
      }));
    }

    const referentesSql = `
      SELECT [glpi_user_id] FROM [prioglpi].[app_user] WHERE [role] = 'referente' AND [glpi_user_id] IS NOT NULL;
    `;
    const referentesRows = await this.session.query(referentesSql);
    const referenteSet = new Set<number>(referentesRows.map(r => Number(r['glpi_user_id'])).filter(id => id > 0));

    const validTechs = filterValidTechUsers(activeTechUsers, referenteSet).sort((a, b) => a.displayName.localeCompare(b.displayName));

    if (input.technicianId !== undefined) {
      if (!validTechs.some(v => v.glpiUserId === input.technicianId)) {
        throw new Error('FORBIDDEN_TECHNICIAN');
      }
    }

    // D. Canonical Tech Map
    const activeTechSet = new Set<number>(validTechs.map(t => t.glpiUserId));
    const techActorsSql = `
      SELECT [ticket_id], [glpi_user_id]
      FROM [prioglpi].[glpi_ticket_user_actor]
      WHERE [actor_type] = 2
      ORDER BY [id] ASC;
    `;
    const techActorRows = await this.session.query(techActorsSql);
    const ticketTechsMap = new Map<number, { glpiUserId: number }[]>();
    for (const a of techActorRows) {
      const tid = Number(a['ticket_id']);
      const uid = Number(a['glpi_user_id']);
      let arr = ticketTechsMap.get(tid);
      if (!arr) { arr = []; ticketTechsMap.set(tid, arr); }
      arr.push({ glpiUserId: uid });
    }

    const allSistemasTicketsSql = `
      SELECT [ticket_id] FROM [prioglpi].[glpi_ticket_cache] WHERE [is_sistemas_scope] = 1;
    `;
    const allSistemasRows = await this.session.query(allSistemasTicketsSql);
    const canonicalMap = new Map<number, number | null>();
    for (const row of allSistemasRows) {
      const tid = Number(row['ticket_id']);
      const actors = ticketTechsMap.get(tid) || [];
      canonicalMap.set(tid, getCanonicalTechnician(actors, activeTechSet));
    }

    // E. Temporal Universe
    let temporalViewClause = '';
    if (input.view === 'open') temporalViewClause = ' AND t.[status] IN (1, 2, 3, 4)';
    if (input.view === 'history') temporalViewClause = ' AND t.[status] IN (5, 6)';

    const temporalSql = `
      SELECT t.[ticket_id], t.[status], t.[status_label], t.[detected_sector], t.[detected_sector_group_id]
      FROM [prioglpi].[glpi_ticket_cache] t
      ${crossFilterJoins}
      WHERE t.[is_sistemas_scope] = 1
        ${temporalViewClause}
        ${statusFilterClause} ${crossFilterWhere}
        AND (
          (t.[status] IN (1, 2, 3, 4) AND t.[opened_at] >= @start AND t.[opened_at] < @end) OR
          (t.[status] = 5 AND t.[solved_at] >= @start AND t.[solved_at] < @end) OR
          (t.[status] = 6 AND t.[closed_at] >= @start AND t.[closed_at] < @end)
        );
    `;
    const temporalRows = await this.session.query(temporalSql, ingresadosParams);

    const temporalTickets = temporalRows.map(r => ({
      ticketId: Number(r['ticket_id']),
      status: Number(r['status']),
      statusLabel: String(r['status_label']),
      detectedSector: typeof r['detected_sector'] === 'string' && r['detected_sector'].trim() ? r['detected_sector'] : 'Sin sector',
      detectedSectorGroupId: typeof r['detected_sector_group_id'] === 'number' ? r['detected_sector_group_id'] : null
    }));

    // Compute byStatus
    const byStatusObj: Record<string, { count: number; id: number }> = {};
    for (const t of temporalTickets) {
      const cTech = canonicalMap.get(t.ticketId) ?? null;
      if (input.unassignedTechnician && cTech !== null) continue;
      if (input.technicianId !== undefined && cTech !== input.technicianId) continue;
      const label = t.statusLabel || `Estado ${t.status}`;
      if (!byStatusObj[label]) byStatusObj[label] = { count: 0, id: t.status };
      byStatusObj[label].count++;
    }

    // Compute byTechnician
    const byTechnicianObj: Record<string, { count: number; id: number | 'unassigned' }> = {};
    validTechs.forEach(u => {
      byTechnicianObj[u.displayName] = { count: 0, id: u.glpiUserId };
    });
    byTechnicianObj['Sin asignar'] = { count: 0, id: 'unassigned' };

    for (const t of temporalTickets) {
      if (input.status !== undefined && t.status !== input.status) continue;
      const cTech = canonicalMap.get(t.ticketId) ?? null;
      if (cTech === null) {
        byTechnicianObj['Sin asignar'].count++;
      } else {
        const u = validTechs.find(v => v.glpiUserId === cTech);
        if (u) {
          byTechnicianObj[u.displayName].count++;
        } else {
          byTechnicianObj['Sin asignar'].count++;
        }
      }
    }

    const byStatusArray = Object.entries(byStatusObj).map(([label, obj]) => ({ label, count: obj.count, id: obj.id }));
    const byTechnicianArray = Object.entries(byTechnicianObj).map(([name, data]) => ({ name, count: data.count, id: data.id }));

    // Intersected counts for KPIs specific statuses
    let nuevos = 0, enCurso = 0, planificados = 0, espera = 0, resueltos = 0, cerrados = 0;
    for (const t of temporalTickets) {
      if (input.status !== undefined && t.status !== input.status) continue;
      const cTech = canonicalMap.get(t.ticketId) ?? null;
      if (input.unassignedTechnician && cTech !== null) continue;
      if (input.technicianId !== undefined && cTech !== input.technicianId) continue;

      if (t.status === 1) nuevos++;
      if (t.status === 2) enCurso++;
      if (t.status === 3) planificados++;
      if (t.status === 4) espera++;
      if (t.status === 5) resueltos++;
      if (t.status === 6) cerrados++;
    }

    const kpis = {
      ingresados: kpiIngresadosCount,
      backlog: backlogLength,
      nuevos,
      enCurso,
      planificados,
      espera,
      resueltos,
      cerrados,
      conRanking: prioritized,
      avancePromedio,
      etaVencida: null as number | null,
      resueltosPeriodo: resueltos + cerrados,
      tprVencida: null as number | null
    };

    // Compute bySector
    const bySectorObj: Record<string, { count: number; id: number | null }> = {};
    for (const t of temporalTickets) {
      if (input.status !== undefined && t.status !== input.status) continue;
      const cTech = canonicalMap.get(t.ticketId) ?? null;
      if (input.unassignedTechnician && cTech !== null) continue;
      if (input.technicianId !== undefined && cTech !== input.technicianId) continue;
      if (!bySectorObj[t.detectedSector]) bySectorObj[t.detectedSector] = { count: 0, id: t.detectedSectorGroupId };
      bySectorObj[t.detectedSector].count++;
    }
    const bySectorArray = Object.entries(bySectorObj).map(([name, obj]) => ({ name, count: obj.count, id: obj.id }));

    // Compute byRequester from temporal ticket IDs
    const filteredTicketIds = temporalTickets
      .filter(t => {
        if (input.status !== undefined && t.status !== input.status) return false;
        const cTech = canonicalMap.get(t.ticketId) ?? null;
        if (input.unassignedTechnician && cTech !== null) return false;
        if (input.technicianId !== undefined && cTech !== input.technicianId) return false;
        return true;
      })
      .map(t => t.ticketId);

    const byRequesterObj: Record<string, { count: number; id: number | null }> = {};
    if (filteredTicketIds.length > 0) {
      const reqActorParams: SqlParameter[] = filteredTicketIds.map((id, i) => ({
        name: `rqid${i}`, type: 'int' as const, nullable: false, value: id
      }));
      const reqActorSql = `
        SELECT a.[ticket_id], a.[glpi_user_id], u.[display_name]
        FROM [prioglpi].[glpi_ticket_user_actor] a
        JOIN [prioglpi].[glpi_user_cache] u ON a.[glpi_user_id] = u.[glpi_user_id]
        WHERE a.[actor_type] = 1 AND a.[ticket_id] IN (${filteredTicketIds.map((_, i) => `@rqid${i}`).join(', ')})
      `;
      const reqActorRows = await this.session.query(reqActorSql, reqActorParams);
      const ticketRequesterMap = new Map<number, { name: string; id: number }>();
      for (const row of reqActorRows) {
        const tid = Number(row['ticket_id']);
        if (!ticketRequesterMap.has(tid)) {
          ticketRequesterMap.set(tid, { name: String(row['display_name']), id: Number(row['glpi_user_id']) });
        }
      }
      for (const tid of filteredTicketIds) {
        const req = ticketRequesterMap.get(tid);
        const reqName = req ? req.name : 'Sin solicitante';
        const reqId = req ? req.id : null;
        if (!byRequesterObj[reqName]) byRequesterObj[reqName] = { count: 0, id: reqId };
        byRequesterObj[reqName].count++;
      }
    }
    const byRequesterArray = Object.entries(byRequesterObj).map(([name, obj]) => ({ name, count: obj.count, id: obj.id }));

    // Sector options from all unique sectors in temporal data
    const sectorOptionsMap = new Map<number, string>();
    for (const t of temporalTickets) {
      if (t.detectedSectorGroupId !== null && t.detectedSector !== 'Sin sector') {
        sectorOptionsMap.set(t.detectedSectorGroupId, t.detectedSector);
      }
    }
    const sectorOptions = Array.from(sectorOptionsMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

    return {
      total: kpis.ingresados,
      byStatus: byStatusArray,
      byTechnician: byTechnicianArray,
      bySector: bySectorArray,
      byRequester: byRequesterArray,
      sectorOptions,
      prioritized,
      unprioritized: backlogLength - prioritized,
      averageProgress: avancePromedio,
      overdueCount: null as number | null,
      kpis,
      periodRange: input.range,
      backlogTicketIds: [...new Set(backlogRows.map(r => Number(r['ticket_id'])))]
    };
  }

  // --- 2. REFERENT METRICS ---
  public async getReferentMetrics(input: ReferentMetricsInput) {
    const params: SqlParameter[] = [
      { name: 'start', type: 'nvarchar', length: 50, nullable: false, value: input.range.start },
      { name: 'end', type: 'nvarchar', length: 50, nullable: false, value: input.range.end }
    ];

    const isMySector = (groupId: number | null) => {
      if (input.sectorGroupId !== undefined) return groupId === input.sectorGroupId;
      if (input.userRole === 'referente' || input.userRole === 'priorizador') {
        if (input.userSectorGroupIds.length === 0) return false;
        return groupId !== null && input.userSectorGroupIds.includes(groupId);
      }
      return true;
    };

    let statusFilterClause = '';
    if (input.status !== undefined) {
      statusFilterClause = ' AND t.[status] = @status';
      params.push({ name: 'status', type: 'int', nullable: false, value: input.status });
    }

    let crossFilterJoins = '';
    let crossFilterWhere = '';

    if (input.requesterId !== undefined) {
      crossFilterJoins += ' INNER JOIN [prioglpi].[glpi_ticket_user_actor] cxreq ON t.[ticket_id] = cxreq.[ticket_id] AND cxreq.[actor_type] = 1 AND cxreq.[glpi_user_id] = @requesterId ';
      params.push({ name: 'requesterId', type: 'int', nullable: false, value: input.requesterId });
    }
    if (input.technicianId !== undefined) {
      crossFilterJoins += ' INNER JOIN [prioglpi].[glpi_ticket_user_actor] cxtech ON t.[ticket_id] = cxtech.[ticket_id] AND cxtech.[actor_type] = 2 AND cxtech.[glpi_user_id] = @technicianId ';
      params.push({ name: 'technicianId', type: 'int', nullable: false, value: input.technicianId });
    }
    if (input.unassignedTechnician) {
      crossFilterWhere += ' AND NOT EXISTS (SELECT 1 FROM [prioglpi].[glpi_ticket_user_actor] untech WHERE untech.[ticket_id] = t.[ticket_id] AND untech.[actor_type] = 2) ';
    }
    // sectorGroupId is already handled locally via isMySector for charts and KPIs,
    // but to be absolutely sure we don't fetch unnecessary data, we can optionally filter in SQL.
    // However, keeping it local is fine as it preserves the original logic.

    // 1. Ingresados
    const ingresadosSql = `
      SELECT t.[ticket_id], t.[status], t.[status_label], t.[detected_sector], t.[detected_sector_group_id]
      FROM [prioglpi].[glpi_ticket_cache] t
      ${crossFilterJoins}
      WHERE t.[is_sistemas_scope] = 1 AND t.[opened_at] >= @start AND t.[opened_at] < @end
        ${statusFilterClause} ${crossFilterWhere};
    `;
    const ingresadosRows = await this.session.query(ingresadosSql, params.filter(p => p.name === 'start' || p.name === 'end' || p.name === 'status' || p.name === 'requesterId' || p.name === 'technicianId'));

    // 2. Cerrados
    const cerradosSql = `
      SELECT t.[ticket_id], t.[detected_sector_group_id]
      FROM [prioglpi].[glpi_ticket_cache] t
      ${crossFilterJoins}
      WHERE t.[is_sistemas_scope] = 1 AND (
        (t.[status] = 5 AND t.[solved_at] >= @start AND t.[solved_at] < @end) OR
        (t.[status] = 6 AND t.[closed_at] >= @start AND t.[closed_at] < @end)
      ) ${statusFilterClause} ${crossFilterWhere};
    `;
    const cerradosRows = await this.session.query(cerradosSql, params.filter(p => p.name === 'start' || p.name === 'end' || p.name === 'status' || p.name === 'requesterId' || p.name === 'technicianId'));

    // 3. Backlog
    const backlogSql = `
      SELECT
        t.[ticket_id], t.[detected_sector_group_id],
        CASE WHEN EXISTS (SELECT 1 FROM [prioglpi].[ticket_ranking] r WHERE r.[ticket_id] = t.[ticket_id] AND r.[is_active] = 1) THEN 1 ELSE 0 END AS [has_ranking]
      FROM [prioglpi].[glpi_ticket_cache] t
      ${crossFilterJoins}
      WHERE t.[is_sistemas_scope] = 1 AND t.[status] IN (1, 2, 3, 4)
        ${statusFilterClause} ${crossFilterWhere};
    `;
    const backlogRows = await this.session.query(backlogSql, params.filter(p => p.name === 'status' || p.name === 'requesterId' || p.name === 'technicianId'));

    // Compute Dual KPIs
    const kpis = {
      ingresados: { misSectores: 0, general: 0 },
      cerrados: { misSectores: 0, general: 0 },
      backlog: { misSectores: 0, general: 0 },
      conRanking: { misSectores: 0, general: 0 },
      sinRanking: { misSectores: 0, general: 0 }
    };

    ingresadosRows.forEach(r => {
      const gid = typeof r['detected_sector_group_id'] === 'number' ? r['detected_sector_group_id'] : null;
      kpis.ingresados.general++;
      if (isMySector(gid)) kpis.ingresados.misSectores++;
    });

    cerradosRows.forEach(r => {
      const gid = typeof r['detected_sector_group_id'] === 'number' ? r['detected_sector_group_id'] : null;
      kpis.cerrados.general++;
      if (isMySector(gid)) kpis.cerrados.misSectores++;
    });

    backlogRows.forEach(r => {
      const gid = typeof r['detected_sector_group_id'] === 'number' ? r['detected_sector_group_id'] : null;
      kpis.backlog.general++;
      if (isMySector(gid)) kpis.backlog.misSectores++;

      if (r['has_ranking'] === 1) {
        kpis.conRanking.general++;
        if (isMySector(gid)) kpis.conRanking.misSectores++;
      } else {
        kpis.sinRanking.general++;
        if (isMySector(gid)) kpis.sinRanking.misSectores++;
      }
    });

    // Compute Charts from ingresadosRows
    const bySector: Record<string, { count: number; id: number | null }> = {};
    const byStatus: Record<string, { count: number; id: number }> = {};

    // Only process charts for 'misSectores'
    const chartRows = ingresadosRows.filter(r => isMySector(typeof r['detected_sector_group_id'] === 'number' ? r['detected_sector_group_id'] : null));

    const chartTicketIds = chartRows.map(r => Number(r['ticket_id']));
    let requesterMap = new Map<number, { name: string; id: number }>();
    let technicianMap = new Map<number, { name: string; id: number }>();

    if (chartTicketIds.length > 0) {
      const actorParams: SqlParameter[] = chartTicketIds.map((id, i) => ({
        name: `aid${i}`, type: 'int' as const, nullable: false, value: id
      }));
      const actorSql = `
        SELECT a.[ticket_id], a.[actor_type], a.[glpi_user_id], u.[display_name]
        FROM [prioglpi].[glpi_ticket_user_actor] a
        JOIN [prioglpi].[glpi_user_cache] u ON a.[glpi_user_id] = u.[glpi_user_id]
        WHERE a.[ticket_id] IN (${chartTicketIds.map((_, i) => `@aid${i}`).join(', ')})
      `;
      const actorRows = await this.session.query(actorSql, actorParams);

      for (const row of actorRows) {
         const tid = Number(row['ticket_id']);
         const type = Number(row['actor_type']);
         const name = String(row['display_name']);
         const glpiUserId = Number(row['glpi_user_id']);
         if (type === 1 && !requesterMap.has(tid)) requesterMap.set(tid, { name, id: glpiUserId });
         if (type === 2 && !technicianMap.has(tid)) technicianMap.set(tid, { name, id: glpiUserId });
      }
    }

    const byRequester: Record<string, { count: number; id: number | null }> = {};
    const byTechnician: Record<string, { count: number; id: number | null }> = {};

    for (const r of chartRows) {
      const sec = typeof r['detected_sector'] === 'string' && r['detected_sector'].trim() ? r['detected_sector'] : 'Sin sector';
      const secId = typeof r['detected_sector_group_id'] === 'number' ? r['detected_sector_group_id'] : null;
      if (!bySector[sec]) bySector[sec] = { count: 0, id: secId };
      bySector[sec].count++;

      const st = Number(r['status']);
      const label = typeof r['status_label'] === 'string' ? r['status_label'] : `Estado ${st}`;
      if (!byStatus[label]) byStatus[label] = { count: 0, id: st };
      byStatus[label].count++;

      const tid = Number(r['ticket_id']);
      const req = requesterMap.get(tid);
      const reqName = req ? req.name : 'Sin solicitante';
      if (!byRequester[reqName]) byRequester[reqName] = { count: 0, id: req ? req.id : null };
      byRequester[reqName].count++;

      const tech = technicianMap.get(tid);
      const techName = tech ? tech.name : 'Sin asignar';
      if (!byTechnician[techName]) byTechnician[techName] = { count: 0, id: tech ? tech.id : null };
      byTechnician[techName].count++;
    }

    // Query 3: Top 5 Rankings (Filtered by user's sector groups)
    let topGroupFilter = ' AND 1 = 0 ';
    const topParams: SqlParameter[] = [];
    if (input.userSectorGroupIds.length > 0) {
      topGroupFilter = ` AND r.[glpi_group_id] IN (${input.userSectorGroupIds.map((_, i) => `@usg${i}`).join(', ')})`;
      input.userSectorGroupIds.forEach((id, i) => topParams.push({ name: `usg${i}`, type: 'int', nullable: false, value: id }));
    }

    const topRankingsSql = `
      SELECT TOP (5) r.[rank_position], r.[ticket_id], r.[sector_name], t.[title], t.[status_label]
      FROM [prioglpi].[ticket_ranking] r
      INNER JOIN [prioglpi].[glpi_ticket_cache] t ON r.[ticket_id] = t.[ticket_id]
      WHERE r.[is_active] = 1 ${topGroupFilter} AND t.[status] IN (1, 2, 3, 4) AND t.[is_sistemas_scope] = 1
      ORDER BY r.[rank_position] ASC, r.[ticket_id] ASC;
    `;
    const topRows = await this.session.query(topRankingsSql, topParams);
    const topPriorities = topRows.map(r => ({
      position: Number(r['rank_position']),
      ticketId: Number(r['ticket_id']),
      title: String(r['title']),
      sector: String(r['sector_name']),
      status: String(r['status_label'])
    }));

    return {
      total: ingresadosRows.length,
      bySector: Object.entries(bySector).map(([name, obj]) => ({ name, count: obj.count, id: obj.id })),
      byStatus: Object.entries(byStatus).map(([label, obj]) => ({ label, count: obj.count, id: obj.id })),
      byRequester: Object.entries(byRequester).map(([name, obj]) => ({ name, count: obj.count, id: obj.id })),
      byTechnician: Object.entries(byTechnician).map(([name, obj]) => ({ name, count: obj.count, id: obj.id })),
      ranked: kpis.conRanking.misSectores,
      unranked: kpis.sinRanking.misSectores,
      topPriorities,
      kpis,
      periodRange: input.range
    };
  }

  // --- 3. SUPERVISOR METRICS ---
  public async getSupervisorMetrics(input: SupervisorMetricsInput) {
    const todayStr = this.getTodayStr();
    const groupIds = input.userSectorGroupIds.length > 0 ? input.userSectorGroupIds : [-1];

    // Query A: Team memberships
    const memSql = `
      SELECT [user_id] FROM [prioglpi].[glpi_user_group_membership]
      WHERE [group_id] IN (${groupIds.map((_, i) => `@g${i}`).join(', ')});
    `;
    const memParams: SqlParameter[] = groupIds.map((id, i) => ({ name: `g${i}`, type: 'int', nullable: false, value: id }));
    const memRows = await this.session.query(memSql, memParams);
    const memUserIds = memRows.map(r => Number(r['user_id'])).filter(id => id > 0);

    // Query B: Referentes to exclude
    const refSql = `
      SELECT u.[glpi_user_id]
      FROM [prioglpi].[app_user] u
      INNER JOIN [prioglpi].[user_sector_scope] s ON u.[id] = s.[user_id]
      WHERE u.[role] = 'referente' AND u.[is_active] = 1 AND u.[glpi_user_id] IS NOT NULL
        AND s.[glpi_group_id] IN (${groupIds.map((_, i) => `@g${i}`).join(', ')});
    `;
    const refRows = await this.session.query(refSql, memParams);
    const referenteGlpiIds = new Set<number>(refRows.map(r => Number(r['glpi_user_id'])).filter(id => id > 0));

    const teamUserIds = memUserIds.filter(id => !referenteGlpiIds.has(id));

    let activeTeamMembers: { glpiUserId: number; displayName: string }[] = [];
    if (teamUserIds.length > 0) {
      const activeUsersSql = `
        SELECT [glpi_user_id], [display_name]
        FROM [prioglpi].[glpi_user_cache]
        WHERE [is_active] = 1 AND [glpi_user_id] IN (${teamUserIds.map((_, i) => `@tuid${i}`).join(', ')});
      `;
      const activeParams: SqlParameter[] = teamUserIds.map((id, i) => ({ name: `tuid${i}`, type: 'int', nullable: false, value: id }));
      const activeRows = await this.session.query(activeUsersSql, activeParams);
      activeTeamMembers = activeRows.map(r => ({
        glpiUserId: Number(r['glpi_user_id']),
        displayName: String(r['display_name'])
      })).sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    const teamMemberIds = activeTeamMembers.map(u => u.glpiUserId);
    const requesterOptions = activeTeamMembers.map(u => ({ id: u.glpiUserId, name: u.displayName }));

    // Requester filter check
    let requesterTicketIds: number[] | null = null;
    if (input.requester && input.requester !== 'todos') {
      const reqUserId = Number(input.requester);
      if (!teamMemberIds.includes(reqUserId)) {
        throw new Error('FORBIDDEN_REQUESTER');
      }

      const reqActorSql = `
        SELECT [ticket_id] FROM [prioglpi].[glpi_ticket_user_actor]
        WHERE [glpi_user_id] = @reqUserId AND [actor_type] = 1;
      `;
      const reqActorRows = await this.session.query(reqActorSql, [{ name: 'reqUserId', type: 'int', nullable: false, value: reqUserId }]);
      requesterTicketIds = reqActorRows.map(r => Number(r['ticket_id']));
    }

    // Build ticket queries
    let sectorClause = '';
    const ticketParams: SqlParameter[] = [
      { name: 'start', type: 'nvarchar', length: 50, nullable: false, value: input.range.start },
      { name: 'end', type: 'nvarchar', length: 50, nullable: false, value: input.range.end }
    ];

    if (input.userRole === 'referente' || input.userRole === 'priorizador') {
      if (groupIds.length > 0 && groupIds[0] !== -1) {
        sectorClause = ` AND t.[detected_sector_group_id] IN (${groupIds.map((_, i) => `@sg${i}`).join(', ')})`;
        groupIds.forEach((id, i) => ticketParams.push({ name: `sg${i}`, type: 'int', nullable: false, value: id }));
      } else {
        sectorClause = ' AND t.[ticket_id] = -1';
      }
    }

    let requesterClause = '';
    if (requesterTicketIds !== null) {
      if (requesterTicketIds.length === 0) {
        requesterClause = ' AND t.[ticket_id] = -1';
      } else {
        requesterClause = ` AND t.[ticket_id] IN (${requesterTicketIds.map((_, i) => `@rtid${i}`).join(', ')})`;
        requesterTicketIds.forEach((id, i) => ticketParams.push({ name: `rtid${i}`, type: 'int', nullable: false, value: id }));
      }
    }

    let statusClause = ' AND t.[status] IN (1, 2, 3, 4, 5, 6)';
    if (input.status !== undefined) {
      statusClause = ' AND t.[status] = @status';
      ticketParams.push({ name: 'status', type: 'int', nullable: false, value: input.status });
    }

    // Query Ingresados
    const ingresadosSql = `
      SELECT t.[ticket_id], t.[status], t.[status_label]
      FROM [prioglpi].[glpi_ticket_cache] t
      WHERE t.[is_sistemas_scope] = 1 AND t.[opened_at] >= @start AND t.[opened_at] < @end
        ${sectorClause}
        ${requesterClause}
        ${statusClause};
    `;
    const ingresadosRows = await this.session.query(ingresadosSql, ticketParams);

    // Query Backlog
    const backlogParams = ticketParams.filter(p => p.name !== 'start' && p.name !== 'end' && p.name !== 'status');
    const backlogSql = `
      SELECT
        t.[ticket_id],
        c.[progress_percent],
        c.[estimated_delivery_date],
        CASE WHEN r.[id] IS NOT NULL THEN 1 ELSE 0 END AS [has_ranking]
      FROM [prioglpi].[glpi_ticket_cache] t
      LEFT JOIN [prioglpi].[ticket_coordination] c ON t.[ticket_id] = c.[ticket_id]
      LEFT JOIN [prioglpi].[ticket_ranking] r ON t.[ticket_id] = r.[ticket_id] AND r.[is_active] = 1
      WHERE t.[is_sistemas_scope] = 1 AND t.[status] IN (1, 2, 3, 4)
        ${sectorClause}
        ${requesterClause};
    `;
    const backlogRows = await this.session.query(backlogSql, backlogParams);

    // byRequester
    const byRequesterObj: Record<string, { count: number; id: number }> = {};
    activeTeamMembers.forEach(u => {
      byRequesterObj[u.displayName] = { count: 0, id: u.glpiUserId };
    });

    const ingresadosTicketIds = ingresadosRows.map(r => Number(r['ticket_id']));
    if (ingresadosTicketIds.length > 0 && teamMemberIds.length > 0) {
      const userActorsSql = `
        SELECT [ticket_id], [glpi_user_id]
        FROM [prioglpi].[glpi_ticket_user_actor]
        WHERE [actor_type] = 1
          AND [ticket_id] IN (${ingresadosTicketIds.map((_, i) => `@itid${i}`).join(', ')})
          AND [glpi_user_id] IN (${teamMemberIds.map((_, i) => `@tmem${i}`).join(', ')});
      `;
      const actorParams: SqlParameter[] = [
        ...ingresadosTicketIds.map((id, i) => ({ name: `itid${i}`, type: 'int' as const, nullable: false, value: id })),
        ...teamMemberIds.map((id, i) => ({ name: `tmem${i}`, type: 'int' as const, nullable: false, value: id }))
      ];
      const actorRows = await this.session.query(userActorsSql, actorParams);

      const userTicketsMap = new Map<number, Set<number>>();
      for (const a of actorRows) {
        const uid = Number(a['glpi_user_id']);
        const tid = Number(a['ticket_id']);
        let set = userTicketsMap.get(uid);
        if (!set) { set = new Set<number>(); userTicketsMap.set(uid, set); }
        set.add(tid);
      }

      userTicketsMap.forEach((ticketsSet, userId) => {
        const u = activeTeamMembers.find(m => m.glpiUserId === userId);
        if (u) {
          byRequesterObj[u.displayName].count = ticketsSet.size;
        }
      });
    }

    // byStatus
    const byStatusObj: Record<string, { count: number; id: number }> = {};
    for (const r of ingresadosRows) {
      const st = Number(r['status']);
      const label = typeof r['status_label'] === 'string' ? r['status_label'] : `Estado ${st}`;
      if (!byStatusObj[label]) byStatusObj[label] = { count: 0, id: st };
      byStatusObj[label].count++;
    }

    // Backlog KPIs
    let prioritized = 0;
    let totalProgress = 0;
    let tprVencida = 0;

    for (const r of backlogRows) {
      if (r['has_ranking'] === 1) prioritized++;
      const progress = typeof r['progress_percent'] === 'number' ? r['progress_percent'] : 0;
      totalProgress += progress;
      const edd = typeof r['estimated_delivery_date'] === 'string' ? r['estimated_delivery_date'] : null;
      if (edd && edd < todayStr) tprVencida++;
    }
    const backlogLength = backlogRows.length;
    const avancePromedio = backlogLength > 0 ? Math.round(totalProgress / backlogLength) : 0;

    return {
      total: ingresadosRows.length,
      byRequester: Object.entries(byRequesterObj).map(([name, data]) => ({ name, count: data.count, id: data.id })),
      byStatus: Object.entries(byStatusObj).map(([label, obj]) => ({ label, count: obj.count, id: obj.id })),
      periodRange: input.range,
      requesterOptions,
      kpis: {
        ingresados: ingresadosRows.length,
        backlog: backlogLength,
        conPrioridad: prioritized,
        avancePromedio,
        tprVencida
      }
    };
  }
}
