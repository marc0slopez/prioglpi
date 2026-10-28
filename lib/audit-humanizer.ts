import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { safeParseJson } from './secret-sanitizer';

export interface HumanizedAudit {
  id: number;
  createdAtIso: string;
  actionCanonical: string;
  entityTypeCanonical: string;
  entityIdOriginal: string;
  userId: number | null;
  actorName: string;
  actorUsername: string;
  actionLabel: string;
  entityLabel: string;
  targetId: string;
  sectorName: string;
  summary: string;
  beforeSummary: string;
  afterSummary: string;
  beforeData: unknown;
  afterData: unknown;
  previousComment: string;
  newComment: string;
}

const ENTITY_LABELS: Record<string, string> = {
  ranking: 'PriorizaciÃ³n',
  coordination: 'CoordinaciÃ³n',
  user: 'Usuario',
  sync: 'SincronizaciÃ³n',
  authentication: 'AutenticaciÃ³n',
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
};

export async function humanizeAuditLogs(
  logs: (Prisma.AuditLogGetPayload<{ include: { user: true } }> | {
    id: number;
    userId: number | null;
    action: string;
    entityType: string;
    entityId: string;
    beforeJson: string | null;
    afterJson: string | null;
    createdAt: Date;
    actorName: string | null;
    actorUsername: string | null;
    user?: { displayName: string; username: string } | null;
  })[]
): Promise<HumanizedAudit[]> {
  const groupIds = new Set<number>();
  const ticketIds = new Set<number>();

  for (const log of logs) {
    if (log.entityType === 'ranking') {
      if (log.action === 'ranking_reorder') {
        const gid = parseInt(log.entityId, 10);
        if (!isNaN(gid)) groupIds.add(gid);
      } else if (log.entityId.includes('/')) {
        const [gidStr, tidStr] = log.entityId.split('/');
        const gid = parseInt(gidStr, 10);
        const tid = parseInt(tidStr, 10);
        if (!isNaN(gid)) groupIds.add(gid);
        if (!isNaN(tid)) ticketIds.add(tid);
      }
    } else if (log.entityType === 'coordination') {
      const tid = parseInt(log.entityId, 10);
      if (!isNaN(tid)) ticketIds.add(tid);
    }
  }

  const groupMap = new Map<number, string>();
  if (groupIds.size > 0) {
    const groups = await prisma.glpiGroupCache.findMany({
      where: { groupId: { in: Array.from(groupIds) } },
      select: { groupId: true, name: true }
    });
    for (const g of groups) groupMap.set(g.groupId, g.name);
  }

  const ticketMap = new Map<number, string>();
  if (ticketIds.size > 0) {
    const tickets = await prisma.glpiTicketCache.findMany({
      where: { ticketId: { in: Array.from(ticketIds) } },
      select: { ticketId: true, title: true }
    });
    for (const t of tickets) ticketMap.set(t.ticketId, t.title);
  }

  return logs.map((log) => {
    const beforeData = safeParseJson(log.beforeJson);
    const afterData = safeParseJson(log.afterJson);

    const actorName = log.actorName || log.user?.displayName || (log.userId === null ? 'AnÃ³nimo' : `Usuario #${log.userId}`);
    const actorUsername = log.actorUsername || log.user?.username || 'anÃ³nimo';

    const entityLabel = ENTITY_LABELS[log.entityType] || log.entityType;
    const actionLabel = ACTION_LABELS[log.action] || log.action;

    let targetId = `#${log.entityId}`;
    let sectorName = '-';
    let summary = `${actionLabel} en ${entityLabel}`;
    let beforeSummary = '';
    let afterSummary = '';
    let previousComment = '';
    let newComment = '';

    if (log.entityType === 'ranking') {
      if (log.action === 'ranking_reorder') {
        const gid = parseInt(log.entityId, 10);
        sectorName = groupMap.get(gid) || `Grupo #${gid}`;
        targetId = `Grupo #${gid}`;
        const items = Array.isArray(afterData) ? afterData.length : (Array.isArray(beforeData) ? beforeData.length : 0);
        summary = `Reordenamiento de ${items} tickets en grupo ${sectorName}`;
        beforeSummary = 'Orden anterior';
        afterSummary = 'Nuevo orden de priorizaciÃ³n';
      } else if (log.entityId.includes('/')) {
        const [gidStr, tidStr] = log.entityId.split('/');
        const gid = parseInt(gidStr, 10);
        const tid = parseInt(tidStr, 10);
        sectorName = groupMap.get(gid) || `Grupo #${gid}`;
        targetId = `#${tid}`;
        const title = ticketMap.get(tid) || `Ticket #${tid}`;
        if (log.action === 'ranking_position_change') {
          const bPos = (beforeData as Record<string, unknown>)?.rankPosition ?? '-';
          const aPos = (afterData as Record<string, unknown>)?.rankPosition ?? '-';
          summary = `MoviÃ³ ticket #${tid} (${title}) de pos. ${bPos} a ${aPos} en ${sectorName}`;
          beforeSummary = `PosiciÃ³n: ${bPos}`;
          afterSummary = `PosiciÃ³n: ${aPos}`;
        } else if (log.action === 'ranking_remove' || log.action === 'ranking_auto_deactivate') {
          summary = `RemoviÃ³ ticket #${tid} (${title}) del ranking de ${sectorName}`;
          beforeSummary = `Activo en ranking`;
          afterSummary = `Desactivado`;
        }
      }
    } else if (log.entityType === 'coordination') {
      targetId = `#${log.entityId}`;
      const tid = parseInt(log.entityId, 10);
      const title = ticketMap.get(tid) || `Ticket #${tid}`;
      const bProg = (beforeData as Record<string, unknown>)?.progressPercent ?? '-';
      const aProg = (afterData as Record<string, unknown>)?.progressPercent ?? '-';
      previousComment = String((beforeData as Record<string, unknown>)?.coordinatorComment || '');
      newComment = String((afterData as Record<string, unknown>)?.coordinatorComment || '');
      summary = `ActualizÃ³ coordinaciÃ³n de ticket #${tid} (${title}): avance ${bProg}% a ${aProg}%`;
      beforeSummary = `Avance: ${bProg}%${previousComment ? ` - Comentario: "${previousComment.slice(0, 40)}..."` : ''}`;
      afterSummary = `Avance: ${aProg}%${newComment ? ` - Comentario: "${newComment.slice(0, 40)}..."` : ''}`;
    } else if (log.entityType === 'user') {
      targetId = `Usuario #${log.entityId}`;
      const aObj = (afterData || {}) as Record<string, unknown>;
      const bObj = (beforeData || {}) as Record<string, unknown>;
      if (log.action === 'user_create') {
        summary = `CreÃ³ usuario ${aObj.username || targetId} (${aObj.role || ''})`;
        afterSummary = `Rol: ${aObj.role}`;
      } else if (log.action === 'user_role_change') {
        summary = `CambiÃ³ rol de usuario #${log.entityId} de ${bObj.role} a ${aObj.role}`;
        beforeSummary = `Rol: ${bObj.role}`;
        afterSummary = `Rol: ${aObj.role}`;
      } else if (log.action === 'user_activate') {
        summary = `ActivÃ³ al usuario #${log.entityId}`;
        afterSummary = 'Activo';
      } else if (log.action === 'user_deactivate') {
        summary = `DesactivÃ³ al usuario #${log.entityId}`;
        afterSummary = 'Inactivo';
      } else if (log.action === 'user_scopes_change') {
        summary = `ModificÃ³ sectores asignados al usuario #${log.entityId}`;
        beforeSummary = `Sectores anteriores: ${JSON.stringify(bObj.scopes || [])}`;
        afterSummary = `Nuevos sectores: ${JSON.stringify(aObj.scopes || [])}`;
      } else if (log.action === 'user_referent_change') {
        summary = `ModificÃ³ asignaciÃ³n real de referente para el usuario #${log.entityId}`;
        beforeSummary = `Alcances anteriores: ${JSON.stringify(bObj.scopes || [])}`;
        afterSummary = `Nuevos alcances: ${JSON.stringify(aObj.scopes || [])}`;
      }
    } else if (log.entityType === 'sync') {
      targetId = 'GLPI Sync';
      if (log.action === 'manual_sync_success') {
        const fetched = (afterData as Record<string, unknown>)?.ticketsFetched ?? '-';
        summary = `SincronizaciÃ³n manual completada con Ã©xito (${fetched} tickets)`;
        afterSummary = `${fetched} tickets sincronizados`;
      } else {
        const err = (afterData as Record<string, unknown>)?.errorMessage || 'Error desconocido';
        summary = `Fallo en sincronizaciÃ³n manual: ${err}`;
        afterSummary = String(err);
      }
    } else if (log.entityType === 'authentication') {
      targetId = log.actorUsername || 'AnÃ³nimo';
      if (log.action === 'login_success') {
        summary = `Login exitoso para usuario "${targetId}"`;
        afterSummary = `Origen: ${(afterData as Record<string, unknown>)?.authSource || 'local'}`;
      } else if (log.action === 'login_failure') {
        const res = (afterData as Record<string, unknown>)?.result || 'fallo';
        const reason = (afterData as Record<string, unknown>)?.reason || '';
        summary = `Login fallido para "${targetId}": ${res} ${reason}`;
        afterSummary = `${res} ${reason}`;
      } else {
        summary = `Servicio de autenticaciÃ³n no disponible`;
        afterSummary = `Error en directorio LDAP/AD`;
      }
    }

    return {
      id: log.id,
      createdAtIso: log.createdAt.toISOString(),
      actionCanonical: log.action,
      entityTypeCanonical: log.entityType,
      entityIdOriginal: log.entityId,
      userId: log.userId,
      actorName,
      actorUsername,
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
    };
  });
}
