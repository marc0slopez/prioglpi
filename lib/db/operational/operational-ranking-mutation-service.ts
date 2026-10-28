import type { ISqlServerRuntime, ISqlServerTransaction } from '../sqlserver-runtime-contract';
import { OperationalRankingWriteError } from './operational-ranking-write-repository';
import type { IOperationalRankingWriteRepository } from './operational-ranking-write-repository';
import type { OperationalActiveRankingState, OperationalRankingSharedQueue } from './operational-ranking-write-types';
import type { IOperationalTicketListContextRepository } from './operational-ticket-list-context-repository';
import type { IOperationalAuditWriteRepository } from './operational-audit-write-repository';
import { SqlServerOperationalRankingWriteRepository } from './sqlserver-operational-ranking-write-repository';
import { SqlServerOperationalTicketListContextRepository } from './sqlserver-operational-ticket-list-context-repository';
import { SqlServerOperationalAuditWriteRepository } from './sqlserver-operational-audit-write-repository';
import { SqlServerOperationalUserReadRepository } from './sqlserver-operational-user-read-repository';
import type { IOperationalUserReadRepository } from './operational-user-read-repository';
import type { OperationalRankingMutationActor, PatchMutationInput, DeleteMutationInput, ReorderMutationInput } from './operational-ranking-mutation-types';


export class OperationalRankingMutationError extends Error {
  constructor(public readonly httpStatus: number, message: string) {
    super(message);
    this.name = 'OperationalRankingMutationError';
  }
}

const RANKING_CONCURRENCY_MESSAGE =
  'La lista de prioridades está siendo modificada por otra operación. Por favor, reintente.';

function isRankingConcurrencyError(error: unknown): boolean {
  if (error instanceof OperationalRankingWriteError && error.code === 'concurrency_conflict') {
    return true;
  }

  if (typeof error !== 'object' || error === null) return false;

  const record = error as Record<string, unknown>;
  const message = error instanceof Error
    ? error.message.toLowerCase()
    : String(record['message'] ?? '').toLowerCase();

  return (
    record['number'] === 1205 ||
    record['code'] === 1205 ||
    record['code'] === '1205' ||
    record['sqlstate'] === '40001' ||
    message.includes('deadlock') ||
    message.includes('1205')
  );
}

function normalizeRankingMutationError(error: unknown): Error {
  if (isRankingConcurrencyError(error)) {
    return new OperationalRankingMutationError(409, RANKING_CONCURRENCY_MESSAGE);
  }

  return error instanceof Error ? error : new Error('unknown_error');
}

export interface MutationServiceOptions {
  clock?: () => Date;
  repositoryFactory?: (tx: ISqlServerTransaction) => {
    ranking: IOperationalRankingWriteRepository;
    context: IOperationalTicketListContextRepository;
    audit: IOperationalAuditWriteRepository;
    userRead: IOperationalUserReadRepository;
  };
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isValidSqlInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 2147483647;
}

function isNonEmptyString(value: unknown, maxLen: number): value is string {
  if (typeof value !== 'string') return false;
  if (value.trim().length === 0) return false;
  if (value.length > maxLen) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 31 || c === 127) return false;
  }
  return true;
}

function validateActor(actor: OperationalRankingMutationActor): void {
  if (!isValidSqlInt(actor.userId)) throw new Error('invalid_actor: userId');
  if (actor.role !== 'admin' && actor.role !== 'priorizador') throw new Error('invalid_actor: role');
  if (!isNonEmptyString(actor.username, 255)) throw new Error('invalid_actor: username');
  if (!isNonEmptyString(actor.displayName, 255)) throw new Error('invalid_actor: displayName');
}

/** The queue belongs to the selected prioritizer, never to a GLPI sector. */
async function resolveOwner(
  userReadRepo: IOperationalUserReadRepository,
  actor: OperationalRankingMutationActor,
  groupId: number,
  targetOwnerUserId?: number
): Promise<number> {
  const ownerUserId = actor.role === 'admin' ? targetOwnerUserId : actor.userId;
  if (!isValidSqlInt(ownerUserId)) {
    throw new OperationalRankingMutationError(403, actor.role === 'admin' ? 'admin requiere seleccionar un priorizador (ownerUserId)' : 'Usuario inválido');
  }
  if (actor.role === 'priorizador' && targetOwnerUserId !== undefined) {
    throw new OperationalRankingMutationError(403, 'priorizador no puede especificar ownerUserId');
  }
  const owner = await userReadRepo.findByIdWithScopes(ownerUserId);
  if (!owner || owner.role !== 'priorizador' || !owner.isActive || !owner.sectorScopes.some((scope) => scope.glpiGroupId === groupId)) {
    throw new OperationalRankingMutationError(403, 'El priorizador objetivo no tiene acceso a este sector');
  }
  return ownerUserId;
}

async function getSharedQueue(repos: ReturnType<typeof getRepos>, groupId: number): Promise<OperationalRankingSharedQueue | null> {
  return repos.ranking.getSharedQueueForGroup ? repos.ranking.getSharedQueueForGroup(groupId) : null;
}

async function lockOwnerQueues(repos: ReturnType<typeof getRepos>, ownerUserId: number, sharedQueue: OperationalRankingSharedQueue | null): Promise<void> {
  if (!repos.ranking.acquireOwnerLock) throw new Error('owner_queue_repository_not_available');
  const owners = sharedQueue?.memberUserIds.includes(ownerUserId)
    ? sharedQueue.memberUserIds
    : [ownerUserId];
  for (const ownerId of [...owners].sort((a, b) => a - b)) await repos.ranking.acquireOwnerLock(ownerId);
}

async function synchronizeSharedOrder(
  repos: ReturnType<typeof getRepos>,
  sourceOwnerUserId: number,
  sharedQueue: OperationalRankingSharedQueue | null,
  sourceOrder: readonly OperationalActiveRankingState[],
  actorUserId: number,
  now: Date,
  prioritySetterTicketId?: number
): Promise<void> {
  if (!sharedQueue || !sharedQueue.memberUserIds.includes(sourceOwnerUserId)) return;
  if (!repos.ranking.listActiveRankingsByOwnerUserId || !repos.ranking.parkActiveRankingPositionsForOwner) throw new Error('owner_queue_repository_not_available');
  const sharedGroups = new Set(sharedQueue.scopeGroupIds);
    const sourceSharedRankings = sourceOrder.filter((row) => sharedGroups.has(row.glpiGroupId));
    const sourceSharedIds = sourceSharedRankings.map((row) => row.ticketId);
  for (const otherOwnerUserId of sharedQueue.memberUserIds) {
    if (otherOwnerUserId === sourceOwnerUserId) continue;
    const otherOrder = await repos.ranking.listActiveRankingsByOwnerUserId(otherOwnerUserId);
    const otherShared = otherOrder.filter((row) => sharedGroups.has(row.glpiGroupId));
    const otherIds = new Set(otherShared.map((row) => row.ticketId));
    if (sourceSharedIds.length !== otherShared.length || sourceSharedIds.some((ticketId) => !otherIds.has(ticketId))) {
      throw new OperationalRankingMutationError(409, 'La cola compartida está incompleta; recargá la bandeja antes de reordenar');
    }
    await repos.ranking.parkActiveRankingPositionsForOwner(otherOwnerUserId, sourceSharedIds, actorUserId, now, sourceSharedIds.length);
    for (const sourceRanking of sourceSharedRankings) {
      const ticketId = sourceRanking.ticketId;
      const row = otherShared.find((candidate) => candidate.ticketId === ticketId);
      if (!row) throw new Error('shared_queue_postcondition_failed');
      const result = await repos.ranking.updateActiveRankingPosition({ rankingId: row.id, ticketId, glpiGroupId: row.glpiGroupId, ownerUserId: otherOwnerUserId, rankPosition: sourceRanking.rankPosition, actorUserId, prioritySetByUserId: ticketId === prioritySetterTicketId ? actorUserId : (sourceRanking.prioritySetByUserId ?? sourceRanking.updatedByUserId), updatedAt: now });
      if (result !== 'updated') throw new Error('shared_queue_postcondition_failed');
    }
  }
}

function getRepos(tx: ISqlServerTransaction, opts?: MutationServiceOptions) {
  if (opts?.repositoryFactory) {
    return opts.repositoryFactory(tx);
  }
  return {
    ranking: new SqlServerOperationalRankingWriteRepository(tx),
    context: new SqlServerOperationalTicketListContextRepository(tx),
    audit: new SqlServerOperationalAuditWriteRepository(tx),
    userRead: new SqlServerOperationalUserReadRepository(tx)
  };
}

async function authorizeMutation(
  userReadRepo: IOperationalUserReadRepository,
  actor: OperationalRankingMutationActor,
  glpiGroupId: number,
  targetOwnerUserId?: number
): Promise<void> {
  if (actor.role === 'admin') {
    if (targetOwnerUserId === undefined) {
      throw new OperationalRankingMutationError(403, 'admin requiere seleccionar un priorizador (ownerUserId)');
    }
    const target = await userReadRepo.findByIdWithScopes(targetOwnerUserId);
    if (!target || target.role !== 'priorizador' || !target.isActive) {
      throw new OperationalRankingMutationError(403, 'Priorizador objetivo inválido o inactivo');
    }
    const authorized = target.sectorScopes.some(s => s.glpiGroupId === glpiGroupId);
    if (!authorized) {
      throw new OperationalRankingMutationError(403, 'El priorizador objetivo no tiene acceso a este sector');
    }
  } else if (actor.role === 'priorizador') {
    if (targetOwnerUserId !== undefined) {
      throw new OperationalRankingMutationError(403, 'priorizador no puede especificar ownerUserId');
    }
    const self = await userReadRepo.findByIdWithScopes(actor.userId);
    if (!self || !self.isActive) throw new OperationalRankingMutationError(403, 'Usuario inactivo');
    const authorized = self.sectorScopes.some(s => s.glpiGroupId === glpiGroupId);
    if (!authorized) {
      throw new OperationalRankingMutationError(403, 'No tenes acceso a este sector');
    }
  } else {
    throw new OperationalRankingMutationError(403, 'Rol no autorizado');
  }
}



export async function patchOperationalRanking(
  rt: ISqlServerRuntime,
  actor: OperationalRankingMutationActor,
  input: PatchMutationInput,
  opts?: MutationServiceOptions
) {
  validateActor(actor);
  if (!isValidSqlInt(input.ticketId)) throw new Error('invalid_input: ticketId');
  if (!isValidSqlInt(input.newPosition)) throw new Error('invalid_input: newPosition');

  const nowRaw = opts?.clock ? opts.clock() : new Date();
  if (!isValidDate(nowRaw)) throw new Error('invalid_clock');
  const now = new Date(nowRaw.getTime());

  try {
    return await rt.withTransaction({ isolation: 'serializable' }, async (tx) => {
    const repos = getRepos(tx, opts);

    const ticket = await repos.ranking.findTicketById(input.ticketId);
    if (!ticket) {
      throw new OperationalRankingMutationError(404, 'Ticket not found');
    }
    if (!ticket.isSistemasScope) {
      throw new OperationalRankingMutationError(400, 'Ticket fuera de Sistemas');
    }
    if (ticket.detectedSectorGroupId === null) {
      throw new OperationalRankingMutationError(400, 'El ticket no tiene un sector definido');
    }
    if (![1, 2, 3, 4].includes(ticket.status)) {
      throw new OperationalRankingMutationError(400, 'Estado de ticket invalido para ranking');
    }

    const groupId = ticket.detectedSectorGroupId;
    const ownerUserId = await resolveOwner(repos.userRead, actor, groupId, input.ownerUserId);
    const sharedQueue = await getSharedQueue(repos, groupId);
    if (!repos.ranking.listActiveRankingsByOwnerUserId || !repos.ranking.parkActiveRankingPositionsForOwner) throw new Error('owner_queue_repository_not_available');
    await lockOwnerQueues(repos, ownerUserId, sharedQueue);
    const currentRankings = await repos.ranking.listActiveRankingsByOwnerUserId(ownerUserId);

    if (sharedQueue && !currentRankings.some((row) => row.ticketId === input.ticketId)) {
      for (const otherOwnerUserId of sharedQueue.memberUserIds) {
        if (otherOwnerUserId === ownerUserId) continue;
        const otherOrder = await repos.ranking.listActiveRankingsByOwnerUserId(otherOwnerUserId);
        if (!otherOrder.some((row) => row.ticketId === input.ticketId)) {
          await repos.ranking.upsertActiveRanking({ ticketId: input.ticketId, sectorName: ticket.detectedSector, glpiGroupId: groupId, ownerUserId: otherOwnerUserId, rankPosition: otherOrder.length + 1, actorUserId: actor.userId, updatedAt: now });
        }
      }
    }

    // Build orderedIds without mutating currentRankings
    const orderedIds: number[] = currentRankings.map(r => r.ticketId);
    const currentIndex = orderedIds.indexOf(input.ticketId);
    if (currentIndex >= 0) {
      orderedIds.splice(currentIndex, 1);
    }
    const insertAt = Math.min(input.newPosition - 1, orderedIds.length);
    orderedIds.splice(insertAt, 0, input.ticketId);

    // Check if anything changed
    const originalOrder = currentRankings.map(r => r.ticketId);
    let changed = false;
    if (orderedIds.length !== originalOrder.length) {
      changed = true;
    } else {
      for (let i = 0; i < orderedIds.length; i++) {
        if (orderedIds[i] !== originalOrder[i]) {
          changed = true;
          break;
        }
      }
    }

    if (!changed) {
      return Object.freeze({ changed: false, message: 'Sin cambios' });
    }

    const rankingIdMap = new Map<number, number>();
    const currentPosMap = new Map<number, number>();
    for (const r of currentRankings) {
      rankingIdMap.set(r.ticketId, r.id);
      currentPosMap.set(r.ticketId, r.rankPosition);
    }

    const beforeAuditList = currentRankings.map(r => Object.freeze({
      ticketId: r.ticketId,
      glpiGroupId: r.glpiGroupId,
      sectorName: r.sectorName,
      ownerUserId,
      rankPosition: r.rankPosition,
      isActive: true,
      updatedByUserId: r.updatedByUserId
    }));

    // Write mutations: target ticket always uses upsert; others use update only if position changed

    // Park active rankings to avoid UNIQUE KEY constraint conflicts during updates
    const activeTicketIds = currentRankings.map(r => r.ticketId);
    if (activeTicketIds.length > 0) {
      await repos.ranking.parkActiveRankingPositionsForOwner(ownerUserId, activeTicketIds, actor.userId, now, activeTicketIds.length);
    }

    for (let i = 0; i < orderedIds.length; i++) {
      const tId = orderedIds[i];
      if (tId === undefined) continue;
      const expectedPos = i + 1;
      const currentPos = currentPosMap.get(tId);

      if (tId === input.ticketId) {
        // Always upsert the target ticket
        await repos.ranking.upsertActiveRanking({
          ticketId: tId,
          sectorName: ticket.detectedSector,
          glpiGroupId: groupId,
          ownerUserId,
          rankPosition: expectedPos,
          actorUserId: actor.userId,
          updatedAt: now
        });
      } else {
        // Since we parked all active tickets, we must update all of them to their final position!
        const rankingId = rankingIdMap.get(tId);
        const currentRanking = currentRankings.find((row) => row.ticketId === tId);
        if (rankingId === undefined) throw new Error('postcondition_failed');
        if (!currentRanking) throw new Error('postcondition_failed');
        const res = await repos.ranking.updateActiveRankingPosition({
          rankingId,
          ticketId: tId,
          // The update predicate includes the ticket group.  During an add to a
          // shared queue, the rest of the owner's queue can span other sectors,
          // so it must retain each row's own group rather than the new ticket's.
          glpiGroupId: currentRanking.glpiGroupId,
          ownerUserId,
          rankPosition: expectedPos,
          actorUserId: actor.userId,
          prioritySetByUserId: currentRanking.prioritySetByUserId ?? currentRanking.updatedByUserId,
          updatedAt: now
        });
        if (res === 'not_found') throw new Error('postcondition_failed');
      }
    }

    await synchronizeSharedOrder(repos, ownerUserId, sharedQueue, orderedIds.map((ticketId, index) => {
      const current = currentRankings.find((row) => row.ticketId === ticketId);
      return Object.freeze({
        ...(current ?? { id: 0, ticketId, sectorName: ticket.detectedSector, glpiGroupId: groupId, createdByUserId: actor.userId, updatedByUserId: actor.userId, createdAt: now, updatedAt: now, isActive: true }),
        ticketId, rankPosition: index + 1, ownerUserId
      });
    }), actor.userId, now, input.ticketId);

    const newOrder = Object.freeze(orderedIds.map((ticketId, index) => Object.freeze({ ticketId, position: index + 1 })));

    const afterAuditList = orderedIds.map((tId, i) => {
      const r = currentRankings.find(x => x.ticketId === tId);
      const ticketGroupId = tId === input.ticketId ? groupId : (r ? r.glpiGroupId : groupId);
      const ticketSectorName = tId === input.ticketId ? ticket.detectedSector : (r ? r.sectorName : ticket.detectedSector);

      return Object.freeze({
        ticketId: tId,
        glpiGroupId: ticketGroupId,
        sectorName: ticketSectorName,
        ownerUserId,
        rankPosition: i + 1,
        isActive: true,
        updatedByUserId: actor.userId
      });
    });

    await repos.audit.writeAudit({
      userId: actor.userId,
      action: 'ranking_position_change',
      entityType: 'ranking',
      entityId: `${ownerUserId}/${input.ticketId}`,
      actorName: actor.displayName,
      actorUsername: actor.username,
      before: { tickets: beforeAuditList },
      after: { tickets: afterAuditList }
    });

    return Object.freeze({
      changed: true,
      message: `Ticket #${input.ticketId} movido a posicion ${input.newPosition}`,
      newOrder
    });
  });
  } catch (error) {
    throw normalizeRankingMutationError(error);
  }
}

export async function deleteOperationalRanking(
  rt: ISqlServerRuntime,
  actor: OperationalRankingMutationActor,
  input: DeleteMutationInput,
  opts?: MutationServiceOptions
) {
  validateActor(actor);
  if (!isValidSqlInt(input.ticketId)) throw new Error('invalid_input: ticketId');

  const nowRaw = opts?.clock ? opts.clock() : new Date();
  if (!isValidDate(nowRaw)) throw new Error('invalid_clock');
  const now = new Date(nowRaw.getTime());

  try {
    return await rt.withTransaction({ isolation: 'serializable' }, async (tx) => {
    const repos = getRepos(tx, opts);

    const ticket = await repos.ranking.findTicketById(input.ticketId);
    if (!ticket) {
      throw new OperationalRankingMutationError(404, 'Ticket not found');
    }
    if (!ticket.isSistemasScope) {
      throw new OperationalRankingMutationError(400, 'Ticket fuera de Sistemas');
    }
    if (ticket.detectedSectorGroupId === null) {
      throw new OperationalRankingMutationError(400, 'El ticket no tiene un sector definido');
    }
    if (![1, 2, 3, 4].includes(ticket.status)) {
      throw new OperationalRankingMutationError(400, 'Estado de ticket invalido para ranking');
    }

    const groupId = ticket.detectedSectorGroupId;
    const ownerUserId = await resolveOwner(repos.userRead, actor, groupId, input.ownerUserId);
    const sharedQueue = await getSharedQueue(repos, groupId);
    if (!repos.ranking.acquireOwnerLock || !repos.ranking.listActiveRankingsByOwnerUserId || !repos.ranking.parkActiveRankingPositionsForOwner) throw new Error('owner_queue_repository_not_available');
    await lockOwnerQueues(repos, ownerUserId, sharedQueue);
    const currentRankings = await repos.ranking.listActiveRankingsByOwnerUserId(ownerUserId);
    const targetRanking = currentRankings.find(r => r.ticketId === input.ticketId);

    if (!targetRanking) {
      return Object.freeze({
        changed: false,
        removedTicketId: input.ticketId,
        newOrder: Object.freeze(currentRankings.map(r => Object.freeze({ ticketId: r.ticketId, position: r.rankPosition })))
      });
    }

    const ownerUserIds = sharedQueue?.memberUserIds ?? [ownerUserId];
    let newOrderArr: { ticketId: number; position: number }[] = [];

    for (const queueOwnerUserId of ownerUserIds) {
      const ownerRankings = queueOwnerUserId === ownerUserId
        ? currentRankings
        : await repos.ranking.listActiveRankingsByOwnerUserId(queueOwnerUserId);
      const ownerTarget = ownerRankings.find((ranking) => ranking.ticketId === input.ticketId);

      if (!ownerTarget) {
        throw new OperationalRankingMutationError(409, 'La cola compartida está incompleta; recargá la bandeja antes de quitar el ticket');
      }

      const deactivateRes = await repos.ranking.deactivateActiveRanking({
        rankingId: ownerTarget.id,
        ticketId: ownerTarget.ticketId,
        glpiGroupId: ownerTarget.glpiGroupId,
        ownerUserId: queueOwnerUserId,
        actorUserId: actor.userId,
        updatedAt: now
      });
      if (deactivateRes === 'not_found') throw new Error('postcondition_failed');

      const remainingRankings = ownerRankings.filter((ranking) => ranking.ticketId !== input.ticketId);
      const remainingTicketIds = remainingRankings.map((ranking) => ranking.ticketId);
      if (remainingTicketIds.length > 0) {
        await repos.ranking.parkActiveRankingPositionsForOwner(
          queueOwnerUserId,
          remainingTicketIds,
          actor.userId,
          now,
          remainingTicketIds.length
        );
      }

      const ownerNewOrder: { ticketId: number; position: number }[] = [];
      for (let index = 0; index < remainingRankings.length; index++) {
        const ranking = remainingRankings[index]!;
        const position = index + 1;
        ownerNewOrder.push({ ticketId: ranking.ticketId, position });
        const updateResult = await repos.ranking.updateActiveRankingPosition({
          rankingId: ranking.id,
          ticketId: ranking.ticketId,
          glpiGroupId: ranking.glpiGroupId,
          ownerUserId: queueOwnerUserId,
          rankPosition: position,
          actorUserId: actor.userId,
          prioritySetByUserId: ranking.prioritySetByUserId ?? ranking.updatedByUserId,
          updatedAt: now
        });
        if (updateResult === 'not_found') throw new Error('postcondition_failed');
      }

      if (queueOwnerUserId === ownerUserId) newOrderArr = ownerNewOrder;
    }

    const beforeAuditList = currentRankings.map(r => Object.freeze({
      ticketId: r.ticketId,
      glpiGroupId: r.glpiGroupId,
      sectorName: r.sectorName,
      ownerUserId,
      rankPosition: r.rankPosition,
      isActive: true,
      updatedByUserId: r.updatedByUserId
    }));

    const afterAuditList = currentRankings.map(r => {
      if (r.ticketId === input.ticketId) {
        return Object.freeze({
          ticketId: r.ticketId,
          glpiGroupId: r.glpiGroupId,
          sectorName: r.sectorName,
          ownerUserId,
          rankPosition: r.rankPosition,
          isActive: false,
          updatedByUserId: actor.userId
        });
      }
      const newEntry = newOrderArr.find(n => n.ticketId === r.ticketId);
      const newPos = newEntry !== undefined ? newEntry.position : r.rankPosition;
      const wasUpdated = newEntry !== undefined && r.rankPosition !== newPos;
      return Object.freeze({
        ticketId: r.ticketId,
        glpiGroupId: r.glpiGroupId,
        sectorName: r.sectorName,
        ownerUserId,
        rankPosition: newPos,
        isActive: true,
        updatedByUserId: wasUpdated ? actor.userId : r.updatedByUserId
      });
    });

    await repos.audit.writeAudit({
      userId: actor.userId,
      action: 'ranking_remove',
      entityType: 'ranking',
      entityId: `${ownerUserId}/${input.ticketId}`,
      actorName: actor.displayName,
      actorUsername: actor.username,
      before: { tickets: beforeAuditList },
      after: { tickets: afterAuditList }
    });

    return Object.freeze({
      changed: true,
      removedTicketId: input.ticketId,
      newOrder: Object.freeze(newOrderArr.map(x => Object.freeze(x)))
    });
  });
  } catch (error) {
    throw normalizeRankingMutationError(error);
  }
}

export async function reorderOperationalRankings(
  rt: ISqlServerRuntime,
  actor: OperationalRankingMutationActor,
  input: ReorderMutationInput,
  opts?: MutationServiceOptions
) {
  validateActor(actor);
  if (!Array.isArray(input.orderedTicketIds) || input.orderedTicketIds.length === 0 || input.orderedTicketIds.length > 200) {
    throw new Error('invalid_input: orderedTicketIds');
  }

  const nowRaw = opts?.clock ? opts.clock() : new Date();
  if (!isValidDate(nowRaw)) throw new Error('invalid_clock');
  const now = new Date(nowRaw.getTime());

  try {
    return await rt.withTransaction({ isolation: 'serializable' }, async (tx) => {
    const repos = getRepos(tx, opts);

    const tickets = await repos.ranking.listTicketsByIds(input.orderedTicketIds);
    if (tickets.length === 0) {
      return Object.freeze({ changed: false, message: 'No hay tickets' });
    }
    const groupId = tickets[0]!.detectedSectorGroupId;
    if (groupId === null) throw new OperationalRankingMutationError(400, 'Ticket sin sector');
    for (const t of tickets) {
      if (t.detectedSectorGroupId === null) throw new OperationalRankingMutationError(400, 'Ticket sin sector');
    }
    const ownerUserId = await resolveOwner(repos.userRead, actor, groupId, input.ownerUserId);
    const sharedQueuesById = new Map<number, OperationalRankingSharedQueue>();
    for (const ticket of tickets) {
      await resolveOwner(repos.userRead, actor, ticket.detectedSectorGroupId!, input.ownerUserId);
      const queue = await getSharedQueue(repos, ticket.detectedSectorGroupId!);
      if (queue && queue.memberUserIds.includes(ownerUserId)) {
        sharedQueuesById.set(queue.queueId, queue);
      }
    }
    const sharedQueues = [...sharedQueuesById.values()];
    if (!repos.ranking.acquireOwnerLock || !repos.ranking.listActiveRankingsByOwnerUserId || !repos.ranking.parkActiveRankingPositionsForOwner) throw new Error('owner_queue_repository_not_available');
    for (const sharedQueue of sharedQueues) {
      await lockOwnerQueues(repos, ownerUserId, sharedQueue);
    }
    const currentRankings = await repos.ranking.listActiveRankingsByOwnerUserId(ownerUserId);
    if (currentRankings.length !== input.orderedTicketIds.length) {
      throw new OperationalRankingMutationError(400, 'Input length does not match active rankings length');
    }

    const currentIds = new Set<number>(currentRankings.map(r => r.ticketId));
    for (const id of input.orderedTicketIds) {
      if (!currentIds.has(id)) {
        throw new OperationalRankingMutationError(400, 'Input contains ticket not in active rankings');
      }
    }
    for (const r of currentRankings) {
      let found = false;
      for (const id of input.orderedTicketIds) {
        if (id === r.ticketId) { found = true; break; }
      }
      if (!found) {
        throw new OperationalRankingMutationError(400, 'Active ranking contains ticket not in input');
      }
    }

    let changed = false;
    const updates: { rankingId: number; ticketId: number; rankPosition: number }[] = [];

    for (let i = 0; i < input.orderedTicketIds.length; i++) {
      const id = input.orderedTicketIds[i];
      if (id === undefined) continue;
      const expectedPos = i + 1;
      const r = currentRankings.find(x => x.ticketId === id);
      if (!r) throw new Error('postcondition_failed');

      if (r.rankPosition !== expectedPos) {
        changed = true;
      }
      updates.push({ rankingId: r.id, ticketId: r.ticketId, rankPosition: expectedPos });
    }

    if (!changed) {
      return Object.freeze({ changed: false, message: 'Sin cambios' });
    }

    const activeTicketIds = currentRankings.map(r => r.ticketId);
    if (activeTicketIds.length > 0) {
      await repos.ranking.parkActiveRankingPositionsForOwner(ownerUserId, activeTicketIds, actor.userId, now, activeTicketIds.length);
    }

    for (const u of updates) {
      const res = await repos.ranking.updateActiveRankingPosition({
        rankingId: u.rankingId,
        ticketId: u.ticketId,
        glpiGroupId: currentRankings.find((ranking) => ranking.ticketId === u.ticketId)!.glpiGroupId,
        ownerUserId,
        rankPosition: u.rankPosition,
        actorUserId: actor.userId,
        prioritySetByUserId: currentRankings.find((ranking) => ranking.ticketId === u.ticketId)!.prioritySetByUserId ?? currentRankings.find((ranking) => ranking.ticketId === u.ticketId)!.updatedByUserId,
        updatedAt: now
      });
      if (res === 'not_found') throw new Error('postcondition_failed');
    }

    const sourceOrder = input.orderedTicketIds.map((ticketId, index) => {
      const row = currentRankings.find((candidate) => candidate.ticketId === ticketId);
      if (!row) throw new Error('postcondition_failed');
      return Object.freeze({ ...row, rankPosition: index + 1, ownerUserId });
    });
    for (const sharedQueue of sharedQueues) {
      await synchronizeSharedOrder(repos, ownerUserId, sharedQueue, sourceOrder, actor.userId, now);
    }

    // No longer need this comment
    const beforeAuditList = currentRankings.map(r => Object.freeze({
      ticketId: r.ticketId,
      glpiGroupId: r.glpiGroupId,
      sectorName: r.sectorName,
      ownerUserId,
      rankPosition: r.rankPosition,
      isActive: true,
      updatedByUserId: r.updatedByUserId
    }));

    const afterAuditList = [];
    for (let i = 0; i < input.orderedTicketIds.length; i++) {
      const id = input.orderedTicketIds[i];
      if (id === undefined) continue;
      const r = currentRankings.find(x => x.ticketId === id);
      if (!r) throw new Error('postcondition_failed');
      const updated = updates.some(u => u.ticketId === id);
      afterAuditList.push(Object.freeze({
        ticketId: id,
        glpiGroupId: r.glpiGroupId,
        sectorName: r.sectorName,
        ownerUserId,
        rankPosition: i + 1,
        isActive: true,
        updatedByUserId: updated ? actor.userId : r.updatedByUserId
      }));
    }

    await repos.audit.writeAudit({
      userId: actor.userId,
      action: 'ranking_reorder',
      entityType: 'ranking',
      entityId: `${ownerUserId}`,
      actorName: actor.displayName,
      actorUsername: actor.username,
      before: { tickets: beforeAuditList },
      after: { tickets: afterAuditList }
    });

    return Object.freeze({
      changed: true,
      message: 'Rankings actualizados.',
      count: input.orderedTicketIds.length
    });
  });
  } catch (error) {
    throw normalizeRankingMutationError(error);
  }
}
