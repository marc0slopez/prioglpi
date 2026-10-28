import type { IOperationalTicketListContextRepository } from './operational-ticket-list-context-repository';
import type { IOperationalTicketListFilterRepository } from './operational-ticket-list-filter-repository';
import type { OperationalTicketListQuery } from './operational-ticket-list-types';
import type {
  OperationalTicketListPlanResult,
  OperationalReferentListPlan
} from './operational-ticket-list-plan-types';
import { OperationalTicketListPlanError } from './operational-ticket-list-plan-types';

export function validateOperationalTicketIdArray(value: unknown): asserts value is readonly number[] {
  if (!Array.isArray(value)) {
    throw new OperationalTicketListPlanError('corrupt_data', 'Expected valid array');
  }
  let lastId = -1;
  for (const id of value) {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
      throw new OperationalTicketListPlanError('corrupt_data', 'Invalid ID in array');
    }
    if (id <= lastId) {
      throw new OperationalTicketListPlanError('corrupt_data', 'Unordered or duplicate ID in array');
    }
    lastId = id;
  }
}

function cloneSector(sector: OperationalTicketListQuery['sector']): OperationalTicketListQuery['sector'] {
  switch (sector.type) {
    case 'all':
      return Object.freeze({ type: 'all' });
    case 'group_id':
      return Object.freeze({ type: 'group_id', id: sector.id });
    case 'name':
      return Object.freeze({ type: 'name', name: sector.name });
  }
}

function deepCloneQuery(query: OperationalTicketListQuery): OperationalTicketListQuery {
  return Object.freeze({
    ...query,
    actor: Object.freeze({
      role: query.actor.role,
      sectorGroupIds: Object.freeze([...query.actor.sectorGroupIds])
    }),
    sector: cloneSector(query.sector)
  });
}

function intersectArrays(a: readonly number[], b: readonly number[]): readonly number[] {
  const result: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const va = a[i];
    const vb = b[j];
    if (va === vb) {
      result.push(va);
      i++;
      j++;
    } else if (va < vb) {
      i++;
    } else {
      j++;
    }
  }
  return result;
}

export async function buildOperationalTicketListPlan(
  query: OperationalTicketListQuery,
  contextRepository: IOperationalTicketListContextRepository,
  filterRepository: IOperationalTicketListFilterRepository
): Promise<OperationalTicketListPlanResult> {
  const q = deepCloneQuery(query);

  if (q.technicianId !== null && q.unassignedTechnician) {
    throw new OperationalTicketListPlanError('corrupt_data', 'Contradictory tech filter');
  }
  if (q.soporteDycosFilter && (q.technicianId !== null || q.unassignedTechnician)) {
    throw new OperationalTicketListPlanError('corrupt_data', 'Contradictory soporteDycos filter');
  }

  const expectedCanSeePrivate = q.actor.role === 'admin' || q.actor.role === 'coordinador_sistemas' || q.actor.role === 'tecnico_sistemas';
  if (q.canSeePrivate !== expectedCanSeePrivate) {
    throw new OperationalTicketListPlanError('corrupt_data', 'Invalid canSeePrivate flag for role');
  }

  if (q.notes !== null && !q.canSeePrivate) {
    throw new OperationalTicketListPlanError('corrupt_data', 'Notes requires canSeePrivate');
  }

  let rawReferentCtx: { userId: number; groupIds: readonly number[] } | null = null;
  if (q.referentUserId !== null) {
    rawReferentCtx = await contextRepository.findActiveReferentContext(q.referentUserId);
    if (!rawReferentCtx) {
      return { status: 'error', httpStatus: 400, error: 'Referente no encontrado o inactivo.' };
    }

    validateOperationalTicketIdArray(rawReferentCtx.groupIds);
    if (rawReferentCtx.userId !== q.referentUserId) {
      throw new OperationalTicketListPlanError('corrupt_data', 'Context userId mismatch');
    }
  }

  if (q.requesterId !== null && q.actor.role === 'referente') {
    const allowed = await contextRepository.isActiveNonReferentRequesterInGroups(
      q.requesterId,
      q.actor.sectorGroupIds
    );
    if (!allowed) {
      return { status: 'error', httpStatus: 403, error: 'Solicitante no pertenece a tus sectores.' };
    }
  }

  let referentPlan: OperationalReferentListPlan | null = null;
  if (rawReferentCtx) {
    let historicalTicketIds: readonly number[] = [];
    if (q.view !== 'open' && q.priority !== 'unranked') {
      const hist = await filterRepository.listHistoricalRankedTicketIdsByReferent(rawReferentCtx.userId);
      validateOperationalTicketIdArray(hist);
      historicalTicketIds = hist;
    }

    referentPlan = Object.freeze({
      userId: rawReferentCtx.userId,
      activeGroupIds: Object.freeze([...rawReferentCtx.groupIds]),
      historicalTicketIds: Object.freeze([...historicalTicketIds])
    });
  }

  const filterSets: (readonly number[])[] = [];
  let excludeTicketIds: readonly number[] = [];

  if (q.technicianId !== null) {
    if (q.actor.role === 'admin' || q.actor.role === 'coordinador_sistemas' || q.actor.role === 'tecnico_sistemas') {
      const set = await filterRepository.listTicketIdsByCanonicalTechnician(q.technicianId);
      validateOperationalTicketIdArray(set);
      filterSets.push(set);
    } else {
      const set = await filterRepository.listTicketIdsByDirectTechnician(q.technicianId);
      validateOperationalTicketIdArray(set);
      filterSets.push(set);
    }
  } else if (q.soporteDycosFilter) {
    const set = await filterRepository.listTicketIdsBySoporteDycosGroup();
    validateOperationalTicketIdArray(set);
    filterSets.push(set);
  } else if (q.unassignedTechnician) {
    if (q.actor.role === 'admin' || q.actor.role === 'coordinador_sistemas' || q.actor.role === 'tecnico_sistemas') {
      const set = await filterRepository.listTicketIdsByCanonicalTechnician(null);
      validateOperationalTicketIdArray(set);
      filterSets.push(set);
    } else {
      const exc = await filterRepository.listTicketIdsAssignedToActiveUsersInGroup(30);
      validateOperationalTicketIdArray(exc);
      excludeTicketIds = exc;
    }
  }

  if (q.requesterId !== null) {
    const set = await filterRepository.listTicketIdsByRequester(q.requesterId);
    validateOperationalTicketIdArray(set);
    filterSets.push(set);
  }

  if (q.notes !== null) {
    const set = await filterRepository.listTicketIdsByFollowupText(q.notes, 'private_only');
    validateOperationalTicketIdArray(set);
    filterSets.push(set);
  }

  if (q.comments !== null) {
    const set = await filterRepository.listTicketIdsByFollowupText(q.comments, 'public_only');
    validateOperationalTicketIdArray(set);
    filterSets.push(set);
  }

  let includeTicketIds: readonly number[] | null = null;
  if (filterSets.length > 0) {
    let intersection = filterSets[0];
    for (let i = 1; i < filterSets.length; i++) {
      if (intersection.length === 0) break;
      intersection = intersectArrays(intersection, filterSets[i]);
    }
    includeTicketIds = Object.freeze([...intersection]);
  }

  let activityTextTicketIds: readonly number[] | null = null;
  if (q.search !== null) {
    const visibility = q.canSeePrivate ? 'all' : 'public_only';
    const set = await filterRepository.listTicketIdsByActivityText(q.search, visibility);
    validateOperationalTicketIdArray(set);
    activityTextTicketIds = Object.freeze([...set]);
  }

  return {
    status: 'success',
    plan: Object.freeze({
      query: q,
      referent: referentPlan,
      includeTicketIds,
      excludeTicketIds: Object.freeze([...excludeTicketIds]),
      activityTextTicketIds
    })
  };
}
