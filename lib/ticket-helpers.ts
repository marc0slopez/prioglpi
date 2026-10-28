import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Filtra la lista de actores tipo 2 (ordenados previamente por id ASC)
 * y retorna el primer técnico válido que pertenezca a la nómina de activos.
 */
export function getCanonicalTechnician(
  ticketTechActors: { glpiUserId: number }[],
  activeTechIds: Set<number>
): number | null {
  for (const actor of ticketTechActors) {
    if (activeTechIds.has(actor.glpiUserId)) {
      return actor.glpiUserId;
    }
  }
  return null;
}

/**
 * Retorna los IDs válidos del universo técnico excluyendo explícitamente:
 * - Julián Cancio (231)
 * - Joel Lugo
 * - Guillermo Kunz
 */
export function filterValidTechUsers(
  users: { glpiUserId: number; displayName: string }[],
  referenteGlpiIds: Set<number>
): { glpiUserId: number; displayName: string }[] {
  return users.filter(u => {
    if (u.glpiUserId === 231) return false;
    const nameLower = u.displayName.toLowerCase();
    if (nameLower.includes('julián cancio') || nameLower.includes('julian cancio')) return false;
    if (nameLower.includes('joel lugo')) return false;
    if (nameLower.includes('guillermo kunz')) return false;
    if (referenteGlpiIds.has(u.glpiUserId)) return false;
    return true;
  });
}

/**
 * Construye el bloque OR para el universo temporal según el rango de fechas.
 * Estados 1-4 -> openedAt
 * Estado 5    -> solvedAt
 * Estado 6    -> closedAt
 */
export function buildTemporalUniverseWhere(range: { start: string; end: string }): Prisma.GlpiTicketCacheWhereInput {
  const dateFilter = { gte: range.start, lt: range.end };
  return {
    OR: [
      { status: { in: [1, 2, 3, 4] }, openedAt: dateFilter },
      { status: 5, solvedAt: dateFilter },
      { status: 6, closedAt: dateFilter }
    ]
  };
}

/**
 * Retorna un mapa de ticketId -> glpiUserId (técnico canónico).
 * Retorna null si no tiene técnico canónico (sin asignar válido).
 */
export async function getCanonicalTechMap(prisma: PrismaClient | Prisma.TransactionClient): Promise<Map<number, number | null>> {
  const techMems = await prisma.glpiUserGroupMembership.findMany({ where: { groupId: 30 } });
  const validTechIdsList = techMems.map(m => m.userId);
  const activeTechUsers = await prisma.glpiUserCache.findMany({
    where: { glpiUserId: { in: validTechIdsList }, isActive: true }
  });
  const referentes = await prisma.user.findMany({
    where: { role: 'referente', glpiUserId: { not: null } },
    select: { glpiUserId: true }
  });
  const referenteSet = new Set<number>(referentes.map(r => r.glpiUserId as number));
  const validTechs = filterValidTechUsers(activeTechUsers, referenteSet);
  const activeTechSet = new Set<number>(validTechs.map(t => t.glpiUserId));

  const allActors = await prisma.glpiTicketUserActor.findMany({
    where: { actorType: 2 },
    orderBy: { id: 'asc' },
    select: { ticketId: true, glpiUserId: true }
  });

  const ticketTechsMap = new Map<number, { glpiUserId: number }[]>();
  for (const a of allActors) {
    let arr = ticketTechsMap.get(a.ticketId);
    if (!arr) { arr = []; ticketTechsMap.set(a.ticketId, arr); }
    arr.push(a);
  }

  // Get all ticket ids to process
  const allTickets = await prisma.glpiTicketCache.findMany({
    where: { isSistemasScope: true },
    select: { ticketId: true }
  });

  const canonicalMap = new Map<number, number | null>();
  for (const t of allTickets) {
    const actors = ticketTechsMap.get(t.ticketId) || [];
    canonicalMap.set(t.ticketId, getCanonicalTechnician(actors, activeTechSet));
  }

  return canonicalMap;
}
