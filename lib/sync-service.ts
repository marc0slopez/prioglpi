import path from 'path';
import {
  GlpiClient,
  GLPI_STATUS_MAP,
  SISTEMAS_GROUP_ID,
  TECNOLOGIA_GROUP_ID,
  GlpiGroup,
  GlpiUser,
  GlpiGroupUser,
  GlpiTicket,
  GlpiGroupTicket,
  GlpiTicketUser,
  GlpiFollowup,
  GlpiTask
} from './glpi-client';
import { detectSector } from './sector-detector';
import { getSharedSqlServerRuntime } from './db/sqlserver-runtime-factory';
import { SqlServerOperationalSyncRepository } from './db/operational/sqlserver-operational-sync-repository';
import { redactSecrets } from './secret-sanitizer';

// Note: Prisma imports are deliberately removed to satisfy the architectural isolation constraint.
// For QA, Prisma and SQLite adapter are loaded dynamically.
import type { PrismaClient } from '@prisma/client';

interface SyncRefs {
  total: number;
  tickets: Set<number>;
  sistemas: Set<number>;
  tecnologia: Set<number>;
}

interface SnapshotData {
  groups: GlpiGroup[];
  users: GlpiUser[];
  groupUsers: GlpiGroupUser[];
  tickets: GlpiTicket[];
  groupTickets: GlpiGroupTicket[];
  ticketUsers: GlpiTicketUser[];
  followups: GlpiFollowup[];
  tasks: GlpiTask[];
}

function normalizeInt(val: string | number | null | undefined): number {
  return typeof val === 'number' ? val : parseInt(String(val || '0'), 10) || 0;
}

export async function runSync(qaDbUrl?: string): Promise<{ ticketsFetched: number; error?: string }> {
  let prismaTarget: PrismaClient | null = null;

  if (qaDbUrl) {
    const absQa = path.resolve(qaDbUrl.replace('file:', ''));
    const absMain = path.resolve('data/appglpi.sqlite');
    console.log(`[Sync] Resolviendo ruta QA: ${absQa}`);
    if (absQa === absMain) {
      return { ticketsFetched: 0, error: "Aislamiento fallido: La ruta QA apunta a la base de datos principal activa." };
    }
    const { PrismaClient: DynamicPrismaClient } = await import('@prisma/client');
    const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3');
    const adapter = new PrismaBetterSqlite3({ url: `file:${absQa}` });
    prismaTarget = new DynamicPrismaClient({ adapter });
  }

  const client = new GlpiClient();
  const startedAt = new Date();

  try {
    console.log('[Sync] Iniciando sesión GLPI...');
    await client.initSession();

    let preRefs = await getReferences(client);
    console.log(`[Sync] Referencias Pre-Sync: Total ${preRefs.total}, Sistemas ${preRefs.sistemas.size}, Tecnologia ${preRefs.tecnologia.size}`);

    console.log('[Sync] Fase 1: downloadSnapshot...');
    let snapshot = await downloadSnapshot(client);

    let postRefs = await getReferences(client);
    console.log(`[Sync] Referencias Post-Sync: Total ${postRefs.total}, Sistemas ${postRefs.sistemas.size}, Tecnologia ${postRefs.tecnologia.size}`);

    if (!areRefsEqual(preRefs, postRefs)) {
      console.warn("[Sync] Referencias cambiaron durante la descarga. Reintentando una vez...");
      preRefs = await getReferences(client);
      snapshot = await downloadSnapshot(client);
      postRefs = await getReferences(client);
      if (!areRefsEqual(preRefs, postRefs)) {
        throw new Error("source_changed: Las referencias de GLPI cambiaron durante la descarga incluso después del reintento.");
      }
    }

    console.log('[Sync] Fase 2: normalizeSnapshot...');
    const normalized = normalizeSnapshot(client, snapshot);

    console.log('[Sync] Fase 3: validateSnapshot...');
    validateSnapshot(normalized, postRefs);

    console.log('[Sync] Fase 4: persistSnapshot...');

    if (qaDbUrl && prismaTarget) {
      await persistSnapshotQa(prismaTarget, normalized, snapshot, startedAt);
    } else {
      await persistSnapshotSql(normalized, snapshot, startedAt);
    }

    console.log('[Sync] Sincronizacion completada con exito en DB.');
    return { ticketsFetched: normalized.tickets.length };

  } catch (err: unknown) {
    const rawErrorMsg = err instanceof Error ? err.message : String(err);
    const errorMsg = String(redactSecrets(rawErrorMsg));
    console.error('[Sync] Error en la sincronizacion:', errorMsg);
    if (qaDbUrl && prismaTarget) {
      await prismaTarget.syncRun.create({
        data: {
          status: 'error',
          errorMessage: errorMsg.substring(0, 4000),
          ticketsFetched: 0,
          sistemasCount: 0,
          tecnologiaCount: 0,
          startedAt: startedAt,
          finishedAt: new Date(),
          durationMs: 0
        }
      });
    } else if (!qaDbUrl) {
      const rt = getSharedSqlServerRuntime();
      try {
        await SqlServerOperationalSyncRepository.insertSyncRunError(rt, startedAt, errorMsg.substring(0, 4000));
      } catch (logErr) {
        console.error('[Sync] Failed to log sync error to SQL Server:', String(redactSecrets(logErr instanceof Error ? logErr.message : String(logErr))));
      }
    }
    return { ticketsFetched: 0, error: errorMsg };
  } finally {
    await client.killSession();
    if (qaDbUrl && prismaTarget) {
      await prismaTarget.$disconnect();
    }
  }
}

function areRefsEqual(a: SyncRefs, b: SyncRefs): boolean {
  if (a.total !== b.total) return false;
  if (a.tickets.size !== b.tickets.size) return false;
  if (a.sistemas.size !== b.sistemas.size) return false;
  if (a.tecnologia.size !== b.tecnologia.size) return false;
  for (const id of a.tickets) if (!b.tickets.has(id)) return false;
  for (const id of a.sistemas) if (!b.sistemas.has(id)) return false;
  for (const id of a.tecnologia) if (!b.tecnologia.has(id)) return false;
  return true;
}

async function getReferences(client: GlpiClient): Promise<SyncRefs> {
  const tIds = await client.fetchSearchIds('/search/Ticket?is_deleted=0');
  const total = tIds.length;

  const sysIds = await client.fetchSearchIds('/search/Ticket?criteria[0][field]=65&criteria[0][searchtype]=under&criteria[0][value]=30');
  const techIds = await client.fetchSearchIds('/search/Ticket?criteria[0][field]=65&criteria[0][searchtype]=under&criteria[0][value]=32');

  return {
    total,
    tickets: new Set(tIds),
    sistemas: new Set(sysIds),
    tecnologia: new Set(techIds)
  };
}

async function downloadSnapshot(client: GlpiClient): Promise<SnapshotData> {
  const [groups, users, groupUsers, tickets, groupTickets, ticketUsers, followups, tasks] = await Promise.all([
    client.getAll<GlpiGroup>('/Group'),
    client.getAll<GlpiUser>('/User'),
    client.getAll<GlpiGroupUser>('/Group_User'),
    client.getAll<GlpiTicket>('/Ticket'),
    client.getAll<GlpiGroupTicket>('/Group_Ticket'),
    client.getAll<GlpiTicketUser>('/Ticket_User'),
    client.getAll<GlpiFollowup>('/ITILFollowup'),
    client.getAll<GlpiTask>('/TicketTask')
  ]);
  return {
    groups: groups.data,
    users: users.data,
    groupUsers: groupUsers.data,
    tickets: tickets.data,
    groupTickets: groupTickets.data,
    ticketUsers: ticketUsers.data,
    followups: followups.data,
    tasks: tasks.data
  };
}

function normalizeSnapshot(client: GlpiClient, snapshot: SnapshotData) {
  const childrenMap = new Map<number, number[]>();
  for (const g of snapshot.groups) {
    const parentId = normalizeInt(g.groups_id);
    if (parentId > 0) {
      const arr = childrenMap.get(parentId) || [];
      arr.push(g.id);
      childrenMap.set(parentId, arr);
    }
  }

  function getDescendants(root: number): Set<number> {
    const set = new Set<number>();
    set.add(root);
    const queue = [root];
    while(queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const children = childrenMap.get(current) || [];
      for (const child of children) {
        if (!set.has(child)) {
          set.add(child);
          queue.push(child);
        }
      }
    }
    return set;
  }

  const sistemasGroups = getDescendants(SISTEMAS_GROUP_ID);
  const tecnologiaGroups = getDescendants(TECNOLOGIA_GROUP_ID);

  const ticketIds = new Set<number>(snapshot.tickets.map((t: GlpiTicket) => t.id));

  const groupTickets = snapshot.groupTickets.filter((gt: GlpiGroupTicket) => ticketIds.has(gt.tickets_id));
  const ticketUsers = snapshot.ticketUsers.filter((tu: GlpiTicketUser) => ticketIds.has(tu.tickets_id));
  const followups = snapshot.followups.filter((f: GlpiFollowup) => ticketIds.has(f.items_id));
  const tasks = snapshot.tasks.filter((t: GlpiTask) => ticketIds.has(t.tickets_id));

  const gtByTicket = new Map<number, GlpiGroupTicket[]>();
  for (const gt of groupTickets) {
    const arr = gtByTicket.get(gt.tickets_id) || [];
    arr.push(gt);
    gtByTicket.set(gt.tickets_id, arr);
  }

  const tuByTicket = new Map<number, GlpiTicketUser[]>();
  for (const tu of ticketUsers) {
    const arr = tuByTicket.get(tu.tickets_id) || [];
    arr.push(tu);
    tuByTicket.set(tu.tickets_id, arr);
  }

  const userMemberships = new Map<number, number[]>();
  for (const gu of snapshot.groupUsers) {
    const arr = userMemberships.get(gu.users_id) || [];
    arr.push(gu.groups_id);
    userMemberships.set(gu.users_id, arr);
  }

  const userMap = new Map<number, GlpiUser>(snapshot.users.map((u: GlpiUser) => [u.id, u]));
  const groupMap = new Map<number, GlpiGroup>(snapshot.groups.map((g: GlpiGroup) => [g.id, g]));

  // Pre-compute Soporte Dycos group IDs and user IDs (detected by name, not hardcoded ID)
  const soporteDycosGroupIds = new Set<number>(
    snapshot.groups
      .filter(g => {
        const n = ((g.completename || g.name) ?? '').toLowerCase();
        return n.includes('soporte dycos');
      })
      .map(g => g.id)
  );
  const soporteDycosUserIds = new Set<number>(
    snapshot.groupUsers
      .filter(gu => soporteDycosGroupIds.has(gu.groups_id))
      .map(gu => gu.users_id)
  );

  const normalizedTickets = snapshot.tickets.map((t: GlpiTicket) => {
    const gt = gtByTicket.get(t.id) || [];
    const tu = tuByTicket.get(t.id) || [];

    const activeGroupIdsType3 = gt.filter((g: GlpiGroupTicket) => g.type === 3).map((g: GlpiGroupTicket) => normalizeInt(g.groups_id));
    const activeGroupIdsType2 = gt.filter((g: GlpiGroupTicket) => g.type === 2).map((g: GlpiGroupTicket) => normalizeInt(g.groups_id));

    const activeGroupNamesType2 = activeGroupIdsType2.map((id: number) => {
        const g = groupMap.get(id);
        return g ? (g.completename || g.name) : `Group ${id}`;
    });

    // Scope por grupos asignados al ticket (actor_type=2 y 3 en Group_Ticket).
    let isSistemas = activeGroupIdsType3.some((id: number) => sistemasGroups.has(id)) || activeGroupIdsType2.some((id: number) => sistemasGroups.has(id));
    let isTecnologia = activeGroupIdsType3.some((id: number) => tecnologiaGroups.has(id)) || activeGroupIdsType2.some((id: number) => tecnologiaGroups.has(id));

    // Scope adicional: si el técnico asignado (actor_type=2 en Ticket_User, users_id > 0)
    // pertenece a Sistemas o Tecnología vía membresía (Group_User) o default_group_id,
    // el ticket también entra en ese scope.
    // Esto cubre tickets como el 1709 que no tienen grupos asignados en Group_Ticket
    // pero sí tienen un técnico usuario cuyo grupo principal es 30 (Sistemas).
    if (!isSistemas || !isTecnologia) {
      const assignedUserActors = tu.filter((u: GlpiTicketUser) => u.type === 2 && normalizeInt(u.users_id) > 0);
      for (const actor of assignedUserActors) {
        const techUserId = normalizeInt(actor.users_id);
        // Verificar via membresía explícita (Group_User)
        const techGroupIds = userMemberships.get(techUserId) || [];
        if (!isSistemas && techGroupIds.some((gid: number) => sistemasGroups.has(gid))) isSistemas = true;
        if (!isTecnologia && techGroupIds.some((gid: number) => tecnologiaGroups.has(gid))) isTecnologia = true;
        // Verificar via default_group_id del usuario (fallback cuando no hay membresía explícita)
        if (!isSistemas || !isTecnologia) {
          const techUser = userMap.get(techUserId);
          if (techUser && techUser.groups_id) {
            if (!isSistemas && sistemasGroups.has(techUser.groups_id)) isSistemas = true;
            if (!isTecnologia && tecnologiaGroups.has(techUser.groups_id)) isTecnologia = true;
          }
        }
        if (isSistemas && isTecnologia) break;
      }
    }

    const reqUserRel = tu.find((u: GlpiTicketUser) => u.type === 1);
    const reqUserId = reqUserRel ? normalizeInt(reqUserRel.users_id) : null;
    const reqGrpRel = gt.find((g: GlpiGroupTicket) => g.type === 1);
    const requesterGroupId = reqGrpRel ? normalizeInt(reqGrpRel.groups_id) : null;

    let detectedSectorGroupId: number | null = requesterGroupId;
    let sectorSource = 'Group_Ticket.type=1';

    if (!detectedSectorGroupId && reqUserId) {
      const u = userMap.get(reqUserId);
      if (u && u.groups_id && !sistemasGroups.has(u.groups_id) && !tecnologiaGroups.has(u.groups_id)) {
        detectedSectorGroupId = u.groups_id;
        sectorSource = 'User.groups_id';
      } else {
        const memberships = userMemberships.get(reqUserId) || [];
        const validMemberships = memberships.filter((gid: number) => !sistemasGroups.has(gid) && !tecnologiaGroups.has(gid));
        if (validMemberships.length === 1) {
          detectedSectorGroupId = validMemberships[0];
          sectorSource = 'Group_User(unique)';
        }
      }
    }

    let detectedSectorName = 'Sin sector';
    if (detectedSectorGroupId) {
      const sg = groupMap.get(detectedSectorGroupId);
      if (sg) {
        detectedSectorName = sg.completename || sg.name;
      } else {
        detectedSectorGroupId = null;
      }
    }

    if (!detectedSectorGroupId) {
      sectorSource = 'Regex';
      detectedSectorName = detectSector((t.content as string) || '');
    }

    let requesterName = '';
    if (reqUserId) {
      const u = userMap.get(reqUserId);
      if (u) requesterName = `${u.firstname || ''} ${u.realname || ''}`.trim() || u.name;
    }

    let requesterGroup = '';
    if (requesterGroupId) {
      const g = groupMap.get(requesterGroupId);
      if (g) requesterGroup = g.completename || g.name;
    }

    // Buscar el primer actor usuario tipo=2 (técnico asignado) con users_id válido (> 0).
    // GLPI puede emitir filas en Ticket_User con type=2 y users_id=0 cuando el actor
    // es un grupo sin usuario individual; esas filas deben ignorarse aquí.
    const techRel = tu.find((u: GlpiTicketUser) => u.type === 2 && normalizeInt(u.users_id) > 0);
    let assignedTechnician = '';
    if (techRel) {
      const techUserId = normalizeInt(techRel.users_id);
      if (soporteDycosUserIds.has(techUserId)) {
        // Technician user belongs to Soporte Dycos group
        assignedTechnician = 'Soporte Dycos';
      } else {
        const u = userMap.get(techUserId);
        if (u) assignedTechnician = `${u.firstname || ''} ${u.realname || ''}`.trim() || u.name;
      }
    }
    // Si no se resolvió un técnico por usuario directo, verificar si hay un grupo
    // asignado de tipo 2 que corresponda a Soporte Dycos (fallback por grupo).
    if (!assignedTechnician) {
      const soporteDycosGroupActor = gt.find(
        (g: GlpiGroupTicket) => g.type === 2 && soporteDycosGroupIds.has(normalizeInt(g.groups_id))
      );
      if (soporteDycosGroupActor) {
        assignedTechnician = 'Soporte Dycos';
      }
    }

    return {
      ticketId: t.id,
      title: t.name || `Ticket ${t.id}`,
      contentPlain: (t.content as string) || '',
      status: normalizeInt(t.status) || 1,
      statusLabel: GLPI_STATUS_MAP[normalizeInt(t.status)] || 'Desconocido',
      type: normalizeInt(t.type) || 1,
      typeLabel: normalizeInt(t.type) === 1 ? 'Incidencia' : 'Petición',
      priority: normalizeInt(t.priority) || 3,
      priorityLabel: `Prioridad ${normalizeInt(t.priority) || 3}`,
      openedAt: t.date || '',
      updatedAtGlpi: t.date_mod || t.date || '',
      solvedAt: (t.solvedate as string) || null,
      closedAt: (t.closedate as string) || null,
      isSistemasScope: isSistemas,
      isTecnologiaScope: isTecnologia,
      requesterUserId: reqUserId,
      requesterName: requesterName || '',
      requesterGroupId: requesterGroupId,
      requesterGroup: requesterGroup || '',
      assignedTechnician: assignedTechnician || '',
      assignedGroupIds: JSON.stringify(activeGroupIdsType2),
      assignedGroupNames: JSON.stringify(activeGroupNamesType2),
      detectedSector: detectedSectorName || 'Sin sector',
      detectedSectorGroupId: detectedSectorGroupId,
      detectedSectorName: detectedSectorName || 'Sin sector',
      sectorSource: sectorSource || 'Regex',
      webUrl: client.getTicketWebUrl(t.id),
      categoryId: normalizeInt(t.itilcategories_id as number) || null,
      entityId: normalizeInt(t.entities_id as number) || null,
      locationId: normalizeInt(t.locations_id as number) || null,
      requestTypeId: normalizeInt(t.requesttypes_id as number) || null,
      urgency: normalizeInt(t.urgency as number) || null,
      impact: normalizeInt(t.impact as number) || null,
      glpiPriority: normalizeInt(t.priority) || null,
      syncedAt: new Date()
    };
  });

  return {
    tickets: normalizedTickets,
    userMap,
    groupMap,
    groupTickets,
    ticketUsers,
    followups,
    tasks
  };
}

function validateSnapshot(normalized: ReturnType<typeof normalizeSnapshot>, refs: SyncRefs) {
  const localTicketIds = new Set<number>();
  const calcSys = new Set<number>();
  const calcTech = new Set<number>();

  for (const t of normalized.tickets) {
    localTicketIds.add(t.ticketId);
    if (t.isSistemasScope) calcSys.add(t.ticketId);
    if (t.isTecnologiaScope) calcTech.add(t.ticketId);
  }

  const tDiff = [...localTicketIds].filter(x => !refs.tickets.has(x));
  const tMiss = [...refs.tickets].filter(x => !localTicketIds.has(x));

  if (tDiff.length > 0 || tMiss.length > 0) {
    throw new Error(`Tickets mismatch. Extra locally: ${tDiff.join(',')}. Missing locally: ${tMiss.join(',')}`);
  }

  // La regla local de scope (normalizeSnapshot) es un SUPERCONJUNTO de la regla de GLPI:
  // GLPI clasifica por grupo del ticket (Group_Ticket); la regla local también incluye
  // tickets cuyo técnico asignado (Ticket_User actor_type=2) pertenece a Sistemas/Tecnología.
  // Por lo tanto la validación correcta es:
  //   - Todo ticket en refs.sistemas debe estar en calcSys (no puede haber "missing" locales).
  //   - calcSys puede tener tickets extra respecto a refs.sistemas (los añadidos por técnico).
  //   - Es un error real si refs tiene un ticket que calcSys NO tiene.
  const sysMiss = [...refs.sistemas].filter(x => !calcSys.has(x));
  if (sysMiss.length > 0) {
    throw new Error(`Sistemas scope mismatch. Missing locally: ${sysMiss.join(',')}`);
  }

  const techMiss = [...refs.tecnologia].filter(x => !calcTech.has(x));
  if (techMiss.length > 0) {
    throw new Error(`Tecnologia scope mismatch. Missing locally: ${techMiss.join(',')}`);
  }
}

async function persistSnapshotSql(normalized: ReturnType<typeof normalizeSnapshot>, snapshot: SnapshotData, startedAt: Date) {
  const rt = getSharedSqlServerRuntime();

  await rt.withTransaction({ isolation: 'serializable' }, async (tx) => {
    const repo = new SqlServerOperationalSyncRepository(tx);

    // 1. Prepare system_sync user
    const sysUser = await repo.ensureSystemSyncUser(new Date());

    // 2. Validate stale tickets
    const ticketsDbObj = normalized.tickets.map(t => ({
      ticket_id: t.ticketId,
      title: t.title,
      content_plain: t.contentPlain,
      status: t.status,
      status_label: t.statusLabel,
      type: t.type,
      type_label: t.typeLabel,
      priority: t.priority,
      priority_label: t.priorityLabel,
      opened_at: t.openedAt,
      updated_at_glpi: t.updatedAtGlpi,
      solved_at: t.solvedAt,
      closed_at: t.closedAt,
      requester_name: t.requesterName,
      requester_group: t.requesterGroup,
      assigned_technician: t.assignedTechnician,
      assigned_group_ids: t.assignedGroupIds,
      assigned_group_names: t.assignedGroupNames,
      detected_sector: t.detectedSector,
      is_sistemas_scope: t.isSistemasScope,
      is_tecnologia_scope: t.isTecnologiaScope,
      web_url: t.webUrl,
      synced_at: t.syncedAt,
      requester_user_id: t.requesterUserId,
      requester_group_id: t.requesterGroupId,
      detected_sector_group_id: t.detectedSectorGroupId,
      detected_sector_name: t.detectedSectorName,
      sector_source: t.sectorSource,
      category_id: t.categoryId,
      entity_id: t.entityId,
      location_id: t.locationId,
      request_type_id: t.requestTypeId,
      urgency: t.urgency,
      impact: t.impact,
      glpi_priority: t.glpiPriority
    }));

    const staleIds = await repo.detectStaleTickets(normalized.tickets.map(t => t.ticketId));
    if (staleIds.length > 0) {
      throw new Error(`staleTicketIds: Se detectaron tickets locales que ya no estan en GLPI: ${staleIds.join(',')}`);
    }

    // 3. Bulk Load Static Caches
    const groupsDb = snapshot.groups.map(g => ({
      group_id: g.id,
      name: g.name || '',
      complete_name: g.completename || g.name || '',
      parent_group_id: normalizeInt(g.groups_id) || null,
      flags: g.comment || null,
      synced_at: new Date()
    }));
    await repo.bulkLoadGroups(JSON.stringify(groupsDb), groupsDb.length);

    const usersDb = snapshot.users.map(u => ({
      glpi_user_id: u.id,
      username: u.name || '',
      nombres: `${u.firstname || ''} ${u.realname || ''}`.trim(),
      display_name: `${u.firstname || ''} ${u.realname || ''}`.trim() || u.name || '',
      default_group_id: normalizeInt(u.groups_id) || null,
      is_active: u.is_active === 1,
      synced_at: new Date()
    }));
    await repo.bulkLoadUsers(JSON.stringify(usersDb), usersDb.length);

    const membershipsDb = snapshot.groupUsers.map(gu => ({
      user_id: gu.users_id,
      group_id: gu.groups_id,
      is_manager: gu.is_manager === 1,
      is_delegate: false,
      is_dynamic: gu.is_dynamic === 1
    }));
    await repo.bulkLoadGroupUsers(JSON.stringify(membershipsDb), membershipsDb.length);

    // 4. Ticket Actors, Followups, Tasks
    const groupActorsDb = normalized.groupTickets.map(gt => ({
      ticket_id: gt.tickets_id,
      group_id: normalizeInt(gt.groups_id),
      actor_type: gt.type
    }));
    await repo.bulkLoadTicketGroupActors(JSON.stringify(groupActorsDb), groupActorsDb.length);

    const userActorsDb = normalized.ticketUsers.map(tu => ({
      ticket_id: tu.tickets_id,
      glpi_user_id: normalizeInt(tu.users_id),
      actor_type: tu.type
    }));
    await repo.bulkLoadTicketUserActors(JSON.stringify(userActorsDb), userActorsDb.length);

    const followupsDb = normalized.followups.map(f => {
      const user = normalized.userMap.get(f.users_id);
      return {
        followup_id: f.id,
        ticket_id: f.items_id,
        author: user ? user.name : null,
        content_plain: f.content || '',
        is_private: f.is_private === 1,
        created_at: new Date(f.date),
        updated_at: f.date_mod ? new Date(f.date_mod) : new Date(f.date)
      };
    });
    await repo.bulkLoadFollowups(JSON.stringify(followupsDb), followupsDb.length);

    const tasksDb = normalized.tasks.map(t => {
      const user = normalized.userMap.get(t.users_id);
      const tech = t.users_id_tech ? normalized.userMap.get(t.users_id_tech) : null;
      const techGrp = t.groups_id_tech ? normalized.groupMap.get(t.groups_id_tech) : null;
      return {
        task_id: t.id,
        ticket_id: t.tickets_id,
        author: user ? user.name : null,
        technician: tech ? tech.name : null,
        tech_group: techGrp ? techGrp.name : null,
        content_plain: t.content || '',
        is_private: t.is_private === 1,
        state: t.state,
        created_at: new Date(t.date),
        updated_at: t.date_mod ? new Date(t.date_mod) : new Date(t.date)
      };
    });
    await repo.bulkLoadTasks(JSON.stringify(tasksDb), tasksDb.length);

    // 5. Upsert Tickets
    await repo.bulkUpsertTickets(JSON.stringify(ticketsDbObj), ticketsDbObj.length);

    // 6. Handle closed rankings
    const closedTicketIds = normalized.tickets
      .filter((t: { status: number }) => t.status >= 5 && t.status <= 6)
      .map((t: { ticketId: number }) => t.ticketId);

    if (closedTicketIds.length > 0) {
      const deactivated = await repo.processClosedRankings(closedTicketIds, sysUser.id, sysUser.username, sysUser.displayName, new Date());
      if (deactivated > 0) {
        console.log(`[Sync] E4: Deactivated and renumbered rankings for ${deactivated} closed tickets.`);
      }
    }

    // 7. Write success run
    const sysCount = normalized.tickets.filter((t: { isSistemasScope: boolean }) => t.isSistemasScope).length;
    const techCount = normalized.tickets.filter((t: { isTecnologiaScope: boolean }) => t.isTecnologiaScope).length;
    let activeCount = 0;
    let historyCount = 0;
    for (const t of normalized.tickets) {
      if(t.status >= 1 && t.status <= 4) activeCount++;
      else if (t.status >= 5 && t.status <= 6) historyCount++;
    }
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    await repo.insertSyncRunSuccess({
      startedAt,
      finishedAt,
      ticketsFetched: normalized.tickets.length,
      sistemasCount: sysCount,
      tecnologiaCount: techCount,
      activeCount,
      historyCount,
      unroutedCount: normalized.tickets.filter((t: { detectedSectorGroupId: number | null }) => t.detectedSectorGroupId === null).length,
      usersCount: snapshot.users.length,
      groupsCount: snapshot.groups.length,
      membershipsCount: snapshot.groupUsers.length,
      publicNotesCount: 0,
      privateNotesCount: 0,
      durationMs
    });
  });
}

async function persistSnapshotQa(prismaTarget: PrismaClient, normalized: ReturnType<typeof normalizeSnapshot>, snapshot: SnapshotData, startedAt: Date) {
  const sysCount = normalized.tickets.filter((t: { isSistemasScope: boolean }) => t.isSistemasScope).length;
  const techCount = normalized.tickets.filter((t: { isTecnologiaScope: boolean }) => t.isTecnologiaScope).length;

  let activeCount = 0;
  let historyCount = 0;
  for(const t of normalized.tickets) {
      if(t.status >= 1 && t.status <= 4) activeCount++;
      else if (t.status >= 5 && t.status <= 6) historyCount++;
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  const localTickets = await prismaTarget.glpiTicketCache.findMany({ select: { ticketId: true }});
  const localIds = new Set(localTickets.map((t: { ticketId: number }) => t.ticketId));
  const glpiIds = new Set(normalized.tickets.map((t: { ticketId: number }) => t.ticketId));

  const staleIds = [...localIds].filter(id => !glpiIds.has(id));
  if (staleIds.length > 0) {
    throw new Error(`staleTicketIds: Se detectaron tickets locales que ya no estan en GLPI: ${staleIds.join(',')}`);
  }

  // Pre-calculate closed tickets to handle ranking lifecycle within the transaction
  const closedTicketIds = normalized.tickets
    .filter((t: { status: number, ticketId: number }) => t.status >= 5 && t.status <= 6)
    .map((t: { ticketId: number }) => t.ticketId);

  let deactivatedCount = 0;

  await prismaTarget.$transaction(async (tx) => {
    // E4: Upsert system_sync user inside transaction
    const systemUser = await tx.user.upsert({
      where: { username: 'system_sync' },
      update: {
        role: 'system',
        isActive: false,
        authSource: 'system',
        passwordHash: null,
        glpiUserId: null,
        adObjectId: null,
        email: null,
        directoryActive: null,
        directoryStatusCheckedAt: null
      },
      create: {
        username: 'system_sync',
        displayName: 'Sistema de Sincronización',
        role: 'system',
        isActive: false,
        authSource: 'system',
        passwordHash: null,
        glpiUserId: null,
        adObjectId: null,
        email: null,
        directoryActive: null,
        directoryStatusCheckedAt: null
      }
    });
    const systemUserId = systemUser.id;
    await tx.userSectorScope.deleteMany({ where: { userId: systemUserId } });
    await tx.sectorReferentAssignment.deleteMany({ where: { referentUserId: systemUserId } });

    // 1. Static caches (Groups, Users, Memberships)
    await tx.glpiGroupCache.deleteMany();
    await tx.glpiGroupCache.createMany({
      data: snapshot.groups.map((g: GlpiGroup) => ({
        groupId: g.id,
        name: g.name || '',
        completeName: g.completename || g.name || '',
        parentGroupId: normalizeInt(g.groups_id) || null,
        flags: g.comment || null
      }))
    });

    await tx.glpiUserCache.deleteMany();
    await tx.glpiUserCache.createMany({
      data: snapshot.users.map((u: GlpiUser) => ({
        glpiUserId: u.id,
        username: u.name || '',
        nombres: `${u.firstname || ''} ${u.realname || ''}`.trim(),
        displayName: `${u.firstname || ''} ${u.realname || ''}`.trim() || u.name || '',
        defaultGroupId: normalizeInt(u.groups_id) || null,
        isActive: u.is_active === 1
      }))
    });

    await tx.glpiUserGroupMembership.deleteMany();
    await tx.glpiUserGroupMembership.createMany({
      data: snapshot.groupUsers.map((gu: GlpiGroupUser) => ({
        userId: gu.users_id,
        groupId: gu.groups_id,
        isManager: gu.is_manager === 1,
        isDynamic: gu.is_dynamic === 1
      }))
    });

    // 2. Ticket Actors, Followups, Tasks
    await tx.glpiTicketGroupActor.deleteMany();
    await tx.glpiTicketGroupActor.createMany({
      data: normalized.groupTickets.map((gt: GlpiGroupTicket) => ({
        ticketId: gt.tickets_id,
        groupId: normalizeInt(gt.groups_id),
        actorType: gt.type
      }))
    });

    await tx.glpiTicketUserActor.deleteMany();
    await tx.glpiTicketUserActor.createMany({
      data: normalized.ticketUsers.map((tu: GlpiTicketUser) => ({
        ticketId: tu.tickets_id,
        glpiUserId: normalizeInt(tu.users_id),
        actorType: tu.type
      }))
    });

    await tx.glpiFollowupCache.deleteMany();
    await tx.glpiFollowupCache.createMany({
      data: normalized.followups.map((f: GlpiFollowup) => {
        const user = normalized.userMap.get(f.users_id);
        return {
          followupId: f.id,
          ticketId: f.items_id,
          author: user ? user.name : null,
          contentPlain: f.content || '',
          isPrivate: f.is_private === 1,
          createdAt: new Date(f.date),
          updatedAt: f.date_mod ? new Date(f.date_mod) : new Date(f.date)
        };
      })
    });

    await tx.glpiTaskCache.deleteMany();
    await tx.glpiTaskCache.createMany({
      data: normalized.tasks.map((t: GlpiTask) => {
        const user = normalized.userMap.get(t.users_id);
        const tech = t.users_id_tech ? normalized.userMap.get(t.users_id_tech) : null;
        const techGrp = t.groups_id_tech ? normalized.groupMap.get(t.groups_id_tech) : null;
        return {
          taskId: t.id,
          ticketId: t.tickets_id,
          author: user ? user.name : null,
          technician: tech ? tech.name : null,
          techGroup: techGrp ? techGrp.name : null,
          contentPlain: t.content || '',
          isPrivate: t.is_private === 1,
          state: t.state,
          createdAt: new Date(t.date),
          updatedAt: t.date_mod ? new Date(t.date_mod) : new Date(t.date)
        };
      })
    });

    // 3. Upsert Tickets
    for (const t of normalized.tickets) {
      await tx.glpiTicketCache.upsert({
        where: { ticketId: t.ticketId },
        update: t,
        create: t
      });
    }

    // 4. Handle Ranking Lifecycle internally
    if (closedTicketIds.length > 0) {
      const { deactivateAndRenumberRankings } = await import('./ranking-lifecycle');
      deactivatedCount = await deactivateAndRenumberRankings(tx, closedTicketIds, systemUserId);
    }

    // 5. Create SyncRun ONLY after all previous steps succeed
    await tx.syncRun.create({
      data: {
        status: 'success',
        startedAt,
        finishedAt,
        durationMs,
        ticketsFetched: normalized.tickets.length,
        sistemasCount: sysCount,
        tecnologiaCount: techCount,
        activeCount,
        historyCount,
        unroutedCount: normalized.tickets.filter((t: { detectedSectorGroupId: number | null }) => t.detectedSectorGroupId === null).length,
        usersCount: snapshot.users.length,
        groupsCount: snapshot.groups.length
      }
    });

  }, {
    maxWait: 5000,
    timeout: 30000 // Allow up to 30s for the transaction given the volume of inserts
  });

  if (deactivatedCount > 0) {
    console.log(`[Sync] E4: Deactivated and renumbered rankings for ${deactivatedCount} closed tickets.`);
  }
}

export async function getSyncStatus() {
  const rt = getSharedSqlServerRuntime();
  return SqlServerOperationalSyncRepository.getSyncStatus(rt);
}
