import type { ISqlServerSession, SqlParameter } from '../sqlserver-runtime-contract';
import type { AuditQueryParams } from '@/lib/audit-query';
import type { HumanizedAudit } from '@/lib/audit-humanizer';
import { isValidCalendarDate } from '@/lib/audit-query';
import { safeParseJson } from '@/lib/secret-sanitizer';
import { describeAppActivity } from '@/lib/app-activity-humanizer';

const ENTITY_LABELS: Record<string, string> = {
  ranking: 'PriorizaciÃ³n',
  coordination: 'CoordinaciÃ³n',
  user: 'Usuario',
  sync: 'SincronizaciÃ³n',
  authentication: 'AutenticaciÃ³n',
  app_navigation: 'Navegacion PrioGLPI',
  ticket: 'Tickets',
};

const ACTION_LABELS: Record<string, string> = {
  ranking_reorder: 'ReordenÃ³ prioridades',
  ranking_position_change: 'CambiÃ³ posiciÃ³n en ranking',
  ranking_remove: 'EliminÃ³ de ranking',
  ranking_auto_deactivate: 'DesactivaciÃ³n automÃ¡tica de ranking',
  ranking_remediation: 'RemediaciÃ³n de ranking',
  coordination_update: 'ActualizÃ³ coordinaciÃ³n',
  user_create: 'CreÃ³ usuario',
  user_update: 'ActualizÃ³ usuario',
  user_activate: 'ActivÃ³ usuario',
  user_deactivate: 'DesactivÃ³ usuario',
  user_role_change: 'CambiÃ³ rol de usuario',
  user_scopes_change: 'CambiÃ³ alcances de usuario',
  user_referent_change: 'CambiÃ³ asignaciÃ³n de referente',
  manual_sync_success: 'SincronizaciÃ³n manual exitosa',
  manual_sync_error: 'Error en sincronizaciÃ³n manual',
  login_success: 'Inicio de sesiÃ³n exitoso',
  login_failure: 'Intento de inicio de sesiÃ³n fallido',
  auth_unavailable: 'Servicio de autenticaciÃ³n no disponible',
  logout_success: 'Cerro sesion',
  app_page_view: 'Visito pantalla',
  ticket_list_view: 'Consulto bandeja',
  ticket_detail_view: 'Consulto detalle de ticket',
  glpi_ticket_open: 'Abrio ticket en GLPI',
};

export class SqlServerOperationalAuditReadRepository {
  constructor(private readonly session: ISqlServerSession) {}

  private parsePositiveInt(value: unknown): number {
    if (typeof value === 'number') {
      if (Number.isSafeInteger(value) && value >= 1 && value <= 2147483647) {
        return value;
      }
    } else if (typeof value === 'string') {
      if (/^[1-9]\d*$/.test(value)) {
        const num = Number(value);
        if (Number.isSafeInteger(num) && num >= 1 && num <= 2147483647) {
          return num;
        }
      }
    }
    throw new Error('ID numÃ©rico entero positivo invÃ¡lido.');
  }

  private parseNullablePositiveInt(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    return this.parsePositiveInt(value);
  }

  private parseNonNegativeInt(value: unknown): number {
    if (typeof value === 'number') {
      if (Number.isSafeInteger(value) && value >= 0 && value <= 2147483647) {
        return value;
      }
    } else if (typeof value === 'string') {
      if (/^0$|^[1-9]\d*$/.test(value)) {
        const num = Number(value);
        if (Number.isSafeInteger(num) && num >= 0 && num <= 2147483647) {
          return num;
        }
      }
    }
    throw new Error('COUNT o entero no negativo invÃ¡lido.');
  }

  private buildWhereSql(params: AuditQueryParams): { sql: string, parameters: SqlParameter[] } {
    const conditions: string[] = [];
    const parameters: SqlParameter[] = [];

    if (params.user && params.user.trim() !== '') {
      const val = params.user.trim();
      if (/^\d+$/.test(val)) {
        const num = Number(val);
        if (!Number.isSafeInteger(num)) throw new Error('user_id invÃ¡lido');
        conditions.push(`a.[user_id] = @userId`);
        parameters.push({ name: 'userId', type: 'int', nullable: false, value: num });
      } else {
        conditions.push(`LOWER(a.[actor_username]) = @actorUsername`);
        parameters.push({ name: 'actorUsername', type: 'nvarchar', nullable: false, value: val.toLowerCase(), length: 255 });
      }
    }

    if (params.entityType && params.entityType.trim() !== '') {
      conditions.push(`a.[entity_type] = @entityType`);
      parameters.push({ name: 'entityType', type: 'nvarchar', nullable: false, value: params.entityType.trim(), length: 50 });
    }

    if (params.action && params.action.trim() !== '') {
      conditions.push(`a.[action] = @action`);
      parameters.push({ name: 'action', type: 'nvarchar', nullable: false, value: params.action.trim(), length: 50 });
    }

    if (params.ticketId && params.ticketId.trim() !== '') {
      const val = params.ticketId.trim();
      if (!/^\d+$/.test(val)) {
        throw new Error('ticketId debe ser numÃ©rico');
      }
      conditions.push(`(
        a.[entity_id] = @ticketIdStr
        OR a.[entity_id] LIKE @ticketIdSuffix
        OR a.[before_json] LIKE @ticketIdJson1
        OR a.[before_json] LIKE @ticketIdJson2
        OR a.[after_json] LIKE @ticketIdJson1
        OR a.[after_json] LIKE @ticketIdJson2
      )`);
      parameters.push({ name: 'ticketIdStr', type: 'nvarchar', nullable: false, value: val, length: 255 });
      parameters.push({ name: 'ticketIdSuffix', type: 'nvarchar', nullable: false, value: '%/' + val, length: 255 });
      parameters.push({ name: 'ticketIdJson1', type: 'nvarchar', nullable: false, value: '%"ticketId":' + val + ',%', length: 'MAX' });
      parameters.push({ name: 'ticketIdJson2', type: 'nvarchar', nullable: false, value: '%"ticketId":' + val + '}%', length: 'MAX' });
    }

    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (params.from && params.from.trim() !== '') {
      const fromStr = params.from.trim();
      if (!isValidCalendarDate(fromStr)) throw new Error(`Fecha 'from' invÃ¡lida en calendario: ${fromStr}`);
      const match = fromStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        fromDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 3, 0, 0, 0));
      }
    }

    if (params.to && params.to.trim() !== '') {
      const toStr = params.to.trim();
      if (!isValidCalendarDate(toStr)) throw new Error(`Fecha 'to' invÃ¡lida en calendario: ${toStr}`);
      const match = toStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        toDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1, 3, 0, 0, 0));
      }
    }

    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      throw new Error('El rango de fechas es invÃ¡lido: from es posterior a to');
    }

    if (fromDate) {
      conditions.push(`a.[created_at] >= @fromDate`);
      parameters.push({ name: 'fromDate', type: 'datetime2', nullable: false, value: fromDate, scale: 3 });
    }
    if (toDate) {
      conditions.push(`a.[created_at] < @toDate`);
      parameters.push({ name: 'toDate', type: 'datetime2', nullable: false, value: toDate, scale: 3 });
    }

    return { sql: conditions.length > 0 ? conditions.join(' AND ') : '1=1', parameters };
  }

  async countAudits(params: AuditQueryParams): Promise<number> {
    const { sql, parameters } = this.buildWhereSql(params);
    const rows = await this.session.query(`SELECT COUNT(*) as cnt FROM [prioglpi].[audit_log] a WHERE ${sql}`, parameters);
    if (rows.length !== 1) throw new Error('Fallo al contar auditorÃ­a');
    return this.parseNonNegativeInt(rows[0].cnt);
  }

  async countAuditsSnapshot(params: AuditQueryParams, snapshotCreatedAt: Date, snapshotId: number): Promise<number> {
    const validSnapId = this.parsePositiveInt(snapshotId);
    const { sql, parameters } = this.buildWhereSql(params);
    const snapshotSql = `(a.[created_at] < @snapDate OR (a.[created_at] = @snapDate AND a.[id] <= @snapId))`;
    parameters.push({ name: 'snapDate', type: 'datetime2', nullable: false, value: snapshotCreatedAt, scale: 3 });
    parameters.push({ name: 'snapId', type: 'int', nullable: false, value: validSnapId });

    const finalSql = sql === '1=1' ? snapshotSql : `${sql} AND ${snapshotSql}`;
    const rows = await this.session.query(`SELECT COUNT(*) as cnt FROM [prioglpi].[audit_log] a WHERE ${finalSql}`, parameters);
    if (rows.length !== 1) throw new Error('Fallo al contar auditorÃ­a por snapshot');
    return this.parseNonNegativeInt(rows[0].cnt);
  }

  async getMaxLog(params: AuditQueryParams): Promise<{ createdAt: Date; id: number } | null> {
    const { sql, parameters } = this.buildWhereSql(params);
    const rows = await this.session.query(`
      SELECT TOP (1) a.[created_at], a.[id]
      FROM [prioglpi].[audit_log] a
      WHERE ${sql}
      ORDER BY a.[created_at] DESC, a.[id] DESC
    `, parameters);
    if (rows.length === 0) return null;
    const r = rows[0];
    if (!(r.created_at instanceof Date)) throw new Error('created_at invÃ¡lido');
    const id = this.parsePositiveInt(r.id);
    return { createdAt: r.created_at, id };
  }

  async searchAuditsHumanized(params: AuditQueryParams, page: number, limit: number): Promise<HumanizedAudit[]> {
    const validPage = this.parsePositiveInt(page);
    const validLimit = this.parsePositiveInt(limit);
    const { sql, parameters } = this.buildWhereSql(params);
    const skip = (validPage - 1) * validLimit;

    const rows = await this.session.query(`
      SELECT
        a.[id], a.[user_id], a.[action], a.[entity_type], a.[entity_id],
        a.[before_json], a.[after_json], a.[created_at], a.[actor_name], a.[actor_username],
        u.[display_name] as user_display_name, u.[username] as user_username
      FROM [prioglpi].[audit_log] a
      LEFT JOIN [prioglpi].[app_user] u ON a.[user_id] = u.[id]
      WHERE ${sql}
      ORDER BY a.[created_at] DESC, a.[id] DESC
      OFFSET @offset ROWS
      FETCH NEXT @fetch ROWS ONLY
    `, [...parameters, { name: 'offset', type: 'int', nullable: false, value: skip }, { name: 'fetch', type: 'int', nullable: false, value: validLimit }]);

    return this.humanizeRows(rows);
  }

  async streamAuditsHumanized(
    params: AuditQueryParams,
    snapshotCreatedAt: Date,
    snapshotId: number,
    take: number,
    lastSeenCreatedAt: Date | null,
    lastSeenId: number | null
  ): Promise<HumanizedAudit[]> {
    const validSnapId = this.parsePositiveInt(snapshotId);
    const validTake = this.parsePositiveInt(take);
    const validLastSeenId = lastSeenId !== null ? this.parsePositiveInt(lastSeenId) : null;
    const { sql, parameters } = this.buildWhereSql(params);

    let snapshotSql = `(a.[created_at] < @snapDate OR (a.[created_at] = @snapDate AND a.[id] <= @snapId))`;
    parameters.push({ name: 'snapDate', type: 'datetime2', nullable: false, value: snapshotCreatedAt, scale: 3 });
    parameters.push({ name: 'snapId', type: 'int', nullable: false, value: validSnapId });

    if (lastSeenCreatedAt && validLastSeenId !== null) {
      snapshotSql += ` AND (a.[created_at] < @lastDate OR (a.[created_at] = @lastDate AND a.[id] < @lastId))`;
      parameters.push({ name: 'lastDate', type: 'datetime2', nullable: false, value: lastSeenCreatedAt, scale: 3 });
      parameters.push({ name: 'lastId', type: 'int', nullable: false, value: validLastSeenId });
    }

    const finalSql = sql === '1=1' ? snapshotSql : `(${sql}) AND ${snapshotSql}`;
    parameters.push({ name: 'takeLimit', type: 'int', nullable: false, value: validTake });

    const rows = await this.session.query(`
      SELECT TOP (@takeLimit)
        a.[id], a.[user_id], a.[action], a.[entity_type], a.[entity_id],
        a.[before_json], a.[after_json], a.[created_at], a.[actor_name], a.[actor_username],
        u.[display_name] as user_display_name, u.[username] as user_username
      FROM [prioglpi].[audit_log] a
      LEFT JOIN [prioglpi].[app_user] u ON a.[user_id] = u.[id]
      WHERE ${finalSql}
      ORDER BY a.[created_at] DESC, a.[id] DESC
    `, parameters);

    return this.humanizeRows(rows);
  }

  private async humanizeRows(rows: Record<string, unknown>[]): Promise<HumanizedAudit[]> {
    if (rows.length === 0) return [];

    const groupIds = new Set<number>();
    const ticketIds = new Set<number>();

    for (const log of rows) {
      if (typeof log.entity_type !== 'string' || typeof log.entity_id !== 'string') continue;

      if (log.entity_type === 'ranking') {
        if (log.action === 'ranking_reorder') {
          const gid = Number(log.entity_id);
          if (Number.isSafeInteger(gid)) groupIds.add(gid);
        } else if (log.entity_id.includes('/')) {
          const [gidStr, tidStr] = log.entity_id.split('/');
          const gid = Number(gidStr);
          const tid = Number(tidStr);
          if (Number.isSafeInteger(gid)) groupIds.add(gid);
          if (Number.isSafeInteger(tid)) ticketIds.add(tid);
        }
      } else if (log.entity_type === 'coordination') {
        const tid = Number(log.entity_id);
        if (Number.isSafeInteger(tid)) ticketIds.add(tid);
      }
    }

    const groupMap = new Map<number, string>();
    if (groupIds.size > 0) {
      const gids = Array.from(groupIds);
      const gidParams = gids.map((g, i) => ({ name: `g${i}`, type: 'int' as const, nullable: false, value: g }));
      const pNames = gidParams.map(p => `@${p.name}`).join(', ');
      const groupRows = await this.session.query(`SELECT [group_id], [name] FROM [prioglpi].[glpi_group_cache] WHERE [group_id] IN (${pNames})`, gidParams);
      for (const r of groupRows) {
        if (r.group_id !== null && r.group_id !== undefined && typeof r.name === 'string') {
          groupMap.set(this.parsePositiveInt(r.group_id), r.name);
        }
      }
    }

    const ticketMap = new Map<number, string>();
    if (ticketIds.size > 0) {
      const tids = Array.from(ticketIds);
      const tidParams = tids.map((t, i) => ({ name: `t${i}`, type: 'int' as const, nullable: false, value: t }));
      const pNames = tidParams.map(p => `@${p.name}`).join(', ');
      const ticketRows = await this.session.query(`SELECT [ticket_id], [title] FROM [prioglpi].[glpi_ticket_cache] WHERE [ticket_id] IN (${pNames})`, tidParams);
      for (const r of ticketRows) {
        if (r.ticket_id !== null && r.ticket_id !== undefined && typeof r.title === 'string') {
          ticketMap.set(this.parsePositiveInt(r.ticket_id), r.title);
        }
      }
    }

    const out: HumanizedAudit[] = [];

    for (const log of rows) {
      const id = this.parsePositiveInt(log.id);
      const userId = this.parseNullablePositiveInt(log.user_id);
      if (typeof log.action !== 'string' || typeof log.entity_type !== 'string' || typeof log.entity_id !== 'string') {
        throw new Error('Tipo de columna de auditorÃ­a invÃ¡lido');
      }
      if (!(log.created_at instanceof Date)) throw new Error('created_at no es Date');
      const bjson = typeof log.before_json === 'string' ? log.before_json : null;
      const ajson = typeof log.after_json === 'string' ? log.after_json : null;

      const beforeData = safeParseJson(bjson);
      const afterData = safeParseJson(ajson);

      const actorNameStr = typeof log.actor_name === 'string' ? log.actor_name : (typeof log.user_display_name === 'string' ? log.user_display_name : (log.user_id === null ? 'AnÃ³nimo' : `Usuario #${log.user_id}`));
      const actorUsernameStr = typeof log.actor_username === 'string' ? log.actor_username : (typeof log.user_username === 'string' ? log.user_username : 'anÃ³nimo');

      const entityLabel = ENTITY_LABELS[log.entity_type] || log.entity_type;
      const actionLabel = ACTION_LABELS[log.action] || log.action;

      let targetId = `#${log.entity_id}`;
      let sectorName = '-';
      let summary = `${actionLabel} en ${entityLabel}`;
      let beforeSummary = '';
      let afterSummary = '';
      let previousComment = '';
      let newComment = '';

      if (log.entity_type === 'ranking') {
        if (log.action === 'ranking_reorder') {
          const gid = Number(log.entity_id);
          sectorName = groupMap.get(gid) || `Grupo #${gid}`;
          targetId = `Grupo #${gid}`;
          const items = Array.isArray(afterData) ? afterData.length : (Array.isArray(beforeData) ? beforeData.length : 0);
          summary = `Reordenamiento de ${items} tickets en grupo ${sectorName}`;
          beforeSummary = 'Orden anterior';
          afterSummary = 'Nuevo orden de priorizaciÃ³n';
        } else if (log.entity_id.includes('/')) {
          const [gidStr, tidStr] = log.entity_id.split('/');
          const gid = Number(gidStr);
          const tid = Number(tidStr);
          sectorName = groupMap.get(gid) || `Grupo #${gid}`;
          targetId = `#${tid}`;
          const title = ticketMap.get(tid) || `Ticket #${tid}`;
          if (log.action === 'ranking_position_change') {
            const bPos = (beforeData && typeof beforeData === 'object' && 'rankPosition' in beforeData) ? (beforeData as Record<string, unknown>).rankPosition : '-';
            const aPos = (afterData && typeof afterData === 'object' && 'rankPosition' in afterData) ? (afterData as Record<string, unknown>).rankPosition : '-';
            summary = `MoviÃ³ ticket #${tid} (${title}) de pos. ${bPos} a ${aPos} en ${sectorName}`;
            beforeSummary = `PosiciÃ³n: ${bPos}`;
            afterSummary = `PosiciÃ³n: ${aPos}`;
          } else if (log.action === 'ranking_remove' || log.action === 'ranking_auto_deactivate') {
            summary = `RemoviÃ³ ticket #${tid} (${title}) del ranking de ${sectorName}`;
            beforeSummary = `Activo en ranking`;
            afterSummary = `Desactivado`;
          }
        }
      } else if (log.entity_type === 'coordination') {
        targetId = `#${log.entity_id}`;
        const tid = Number(log.entity_id);
        const title = ticketMap.get(tid) || `Ticket #${tid}`;
        const bProg = (beforeData && typeof beforeData === 'object' && 'progressPercent' in beforeData) ? (beforeData as Record<string, unknown>).progressPercent : '-';
        const aProg = (afterData && typeof afterData === 'object' && 'progressPercent' in afterData) ? (afterData as Record<string, unknown>).progressPercent : '-';
        previousComment = String((beforeData && typeof beforeData === 'object' && 'coordinatorComment' in beforeData) ? (beforeData as Record<string, unknown>).coordinatorComment || '' : '');
        newComment = String((afterData && typeof afterData === 'object' && 'coordinatorComment' in afterData) ? (afterData as Record<string, unknown>).coordinatorComment || '' : '');
        summary = `ActualizÃ³ coordinaciÃ³n de ticket #${tid} (${title}): avance ${bProg}% a ${aProg}%`;
        beforeSummary = `Avance: ${bProg}%${previousComment ? ` - Comentario: "${previousComment.slice(0, 40)}..."` : ''}`;
        afterSummary = `Avance: ${aProg}%${newComment ? ` - Comentario: "${newComment.slice(0, 40)}..."` : ''}`;
      } else if (log.entity_type === 'user') {
        targetId = `Usuario #${log.entity_id}`;
        const aObj = (afterData && typeof afterData === 'object' ? afterData : {}) as Record<string, unknown>;
        const bObj = (beforeData && typeof beforeData === 'object' ? beforeData : {}) as Record<string, unknown>;
        if (log.action === 'user_create') {
          summary = `CreÃ³ usuario ${aObj.username || targetId} (${aObj.role || ''})`;
          afterSummary = `Rol: ${aObj.role}`;
        } else if (log.action === 'user_role_change') {
          summary = `CambiÃ³ rol de usuario #${log.entity_id} de ${bObj.role} a ${aObj.role}`;
          beforeSummary = `Rol: ${bObj.role}`;
          afterSummary = `Rol: ${aObj.role}`;
        } else if (log.action === 'user_activate') {
          summary = `ActivÃ³ al usuario #${log.entity_id}`;
          afterSummary = 'Activo';
        } else if (log.action === 'user_deactivate') {
          summary = `DesactivÃ³ al usuario #${log.entity_id}`;
          afterSummary = 'Inactivo';
        } else if (log.action === 'user_scopes_change') {
          summary = `ModificÃ³ sectores asignados al usuario #${log.entity_id}`;
          beforeSummary = `Sectores anteriores: ${JSON.stringify(bObj.scopes || [])}`;
          afterSummary = `Nuevos sectores: ${JSON.stringify(aObj.scopes || [])}`;
        } else if (log.action === 'user_referent_change') {
          summary = `ModificÃ³ asignaciÃ³n real de referente para el usuario #${log.entity_id}`;
          beforeSummary = `Alcances anteriores: ${JSON.stringify(bObj.scopes || [])}`;
          afterSummary = `Nuevos alcances: ${JSON.stringify(aObj.scopes || [])}`;
        }
      } else if (log.entity_type === 'sync') {
        targetId = 'GLPI Sync';
        if (log.action === 'manual_sync_success') {
          const aObj = (afterData && typeof afterData === 'object' ? afterData : {}) as Record<string, unknown>;
          const fetched = aObj.ticketsFetched ?? '-';
          summary = `SincronizaciÃ³n manual completada con Ã©xito (${fetched} tickets)`;
          afterSummary = `${fetched} tickets sincronizados`;
        } else {
          const aObj = (afterData && typeof afterData === 'object' ? afterData : {}) as Record<string, unknown>;
          const err = aObj.errorMessage || 'Error desconocido';
          summary = `Fallo en sincronizaciÃ³n manual: ${err}`;
          afterSummary = String(err);
        }
      } else if (log.entity_type === 'authentication') {
        targetId = typeof log.actor_username === 'string' ? log.actor_username : 'AnÃ³nimo';
        if (log.action === 'login_success') {
          const aObj = (afterData && typeof afterData === 'object' ? afterData : {}) as Record<string, unknown>;
          summary = `Login exitoso para usuario "${targetId}"`;
          afterSummary = `Origen: ${aObj.authSource || 'local'}`;
        } else if (log.action === 'login_failure') {
          const aObj = (afterData && typeof afterData === 'object' ? afterData : {}) as Record<string, unknown>;
          const res = aObj.result || 'fallo';
          const reason = aObj.reason || '';
          summary = `Login fallido para "${targetId}": ${res} ${reason}`;
          afterSummary = `${res} ${reason}`;
        } else if (log.action === 'logout_success') {
          summary = `Cerro sesion el usuario "${targetId}"`;
          afterSummary = 'Sesion finalizada';
        } else {
          summary = `Servicio de autenticaciÃ³n no disponible`;
          afterSummary = `Error en directorio LDAP/AD`;
        }
      } else if (log.entity_type === 'app_navigation' || log.entity_type === 'ticket') {
        const detail = describeAppActivity(log.action, log.entity_id, afterData);
        if (detail) {
          targetId = detail.targetId;
          summary = detail.summary;
          afterSummary = detail.afterSummary;
        }
      }

      out.push({
        id,
        createdAtIso: log.created_at.toISOString(),
        actionCanonical: log.action,
        entityTypeCanonical: log.entity_type,
        entityIdOriginal: log.entity_id,
        userId,
        actorName: actorNameStr,
        actorUsername: actorUsernameStr,
        actionLabel,
        entityLabel,
        targetId,
        sectorName,
        summary,
        beforeSummary,
        afterSummary,
        beforeData,
        afterData,
        previousComment,
        newComment,
      });
    }

    return out;
  }
}
