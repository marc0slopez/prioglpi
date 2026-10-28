import type { IOperationalTicketFilterOptionsRepository } from './operational-ticket-filter-options-repository';
import type {
  OperationalFilterOption,
  OperationalReferentOption,
  OperationalTicketFilterOptionsResponse,
  OperationalReferentGroupOption
} from './operational-ticket-filter-options-types';

export type OperationalTicketFilterOptionsRole =
  | 'admin'
  | 'coordinador_sistemas'
  | 'referente'
  | 'priorizador'
  | 'tecnico_sistemas';

export interface OperationalTicketFilterOptionsActor {
  readonly role: OperationalTicketFilterOptionsRole;
  readonly sectorScopes: readonly {
    readonly sectorName: string;
    readonly glpiGroupId: number;
  }[];
}

export class OperationalTicketFilterOptionsServiceError extends Error {
  constructor(
    public readonly code: 'invalid_input',
    message: string
  ) {
    super(message);
    this.name = 'OperationalTicketFilterOptionsServiceError';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepCloneFilterOption(opt: OperationalFilterOption): OperationalFilterOption {
  return Object.freeze({
    id: opt.id,
    name: opt.name.slice()
  });
}

function deepCloneReferentOption(opt: OperationalReferentOption): OperationalReferentOption {
  const clonedGroups: OperationalReferentGroupOption[] = [];
  for (const g of opt.groups) {
    clonedGroups.push(Object.freeze({
      glpiGroupId: g.glpiGroupId,
      sectorName: g.sectorName.slice()
    }));
  }
  return Object.freeze({
    id: opt.id,
    displayName: opt.displayName.slice(),
    glpiUserId: opt.glpiUserId,
    isActive: opt.isActive,
    groups: Object.freeze(clonedGroups)
  });
}

function validateActor(actor: unknown): OperationalTicketFilterOptionsActor {
  if (!isRecord(actor)) {
    throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Invalid actor type');
  }
  if (typeof actor.role !== 'string') {
    throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Invalid role type');
  }
  if (
    actor.role !== 'admin' &&
    actor.role !== 'coordinador_sistemas' &&
    actor.role !== 'referente' &&
    actor.role !== 'priorizador' &&
    actor.role !== 'tecnico_sistemas'
  ) {
    throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Invalid role');
  }
  if (!Array.isArray(actor.sectorScopes)) {
    throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Invalid sectorScopes type');
  }
  if (actor.sectorScopes.length > 200) {
    throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Too many scopes');
  }

  const role: OperationalTicketFilterOptionsRole = actor.role;
  const scopes: { readonly sectorName: string; readonly glpiGroupId: number }[] = [];

  const seenGroupIds = new Set<number>();
  const seenSectorNames = new Set<string>();

  for (const scope of actor.sectorScopes) {
    if (!isRecord(scope)) {
      throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Invalid scope type');
    }

    const { sectorName, glpiGroupId } = scope;

    if (typeof sectorName !== 'string') {
      throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Invalid sectorName type');
    }
    if (sectorName.trim().length === 0) {
      throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Empty sectorName');
    }
    if (sectorName.length > 255) {
      throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'sectorName too long');
    }
    if (/[\x00-\x1F\x7F]/.test(sectorName)) {
      throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Invalid characters in sectorName');
    }

    if (typeof glpiGroupId !== 'number' || !Number.isSafeInteger(glpiGroupId) || glpiGroupId < 1 || glpiGroupId > 2147483647) {
      throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Invalid glpiGroupId');
    }

    if (seenGroupIds.has(glpiGroupId)) {
      throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Duplicate glpiGroupId');
    }
    seenGroupIds.add(glpiGroupId);

    const nameLower = sectorName.trim().toLowerCase();
    if (seenSectorNames.has(nameLower)) {
      throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Duplicate sectorName');
    }
    seenSectorNames.add(nameLower);

    const extraKeys = Object.keys(scope).filter(k => k !== 'sectorName' && k !== 'glpiGroupId');
    if (extraKeys.length > 0) {
       throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Extra keys in scope');
    }

    scopes.push(Object.freeze({
      sectorName: sectorName.slice(),
      glpiGroupId
    }));
  }

  const extraKeys = Object.keys(actor).filter(k => k !== 'role' && k !== 'sectorScopes');
  if (extraKeys.length > 0) {
     throw new OperationalTicketFilterOptionsServiceError('invalid_input', 'Extra keys in actor');
  }

  return Object.freeze({
    role,
    sectorScopes: Object.freeze(scopes)
  });
}

export async function buildOperationalTicketFilterOptions(
  repository: IOperationalTicketFilterOptionsRepository,
  rawActor: unknown
): Promise<OperationalTicketFilterOptionsResponse> {
  const actor = validateActor(rawActor);

  let techsCrudo: readonly OperationalFilterOption[];
  let sectorsCrudo: readonly OperationalFilterOption[];
  let requestersCrudo: readonly OperationalFilterOption[];
  let referentsCrudo: readonly OperationalReferentOption[];

  if (actor.role === 'admin' || actor.role === 'coordinador_sistemas' || actor.role === 'tecnico_sistemas') {
    const results = await Promise.all([
      repository.listTechnicians(),
      repository.listSistemasSectors(),
      repository.listSistemasRequesters(),
      repository.listActiveReferentOptions()
    ]);
    techsCrudo = results[0];
    sectorsCrudo = results[1];
    requestersCrudo = results[2];
    referentsCrudo = results[3];
  } else {
    // referente o supervisor
    const groupIds = Object.freeze(actor.sectorScopes.map(s => s.glpiGroupId));

    const results = await Promise.all([
      repository.listTechnicians(),
      repository.listScopedRequesters(groupIds)
    ]);
    techsCrudo = results[0];
    requestersCrudo = results[1];

    // Sectors built exactly from sectorScopes
    const scopedSectors: OperationalFilterOption[] = [];
    for (const scope of actor.sectorScopes) {
      scopedSectors.push({ id: scope.glpiGroupId, name: scope.sectorName });
    }
    sectorsCrudo = Object.freeze(scopedSectors);
    referentsCrudo = Object.freeze([]);
  }

  const technicians = Object.freeze(techsCrudo.map(deepCloneFilterOption));
  const sectors = Object.freeze(sectorsCrudo.map(deepCloneFilterOption));
  const requesters = Object.freeze(requestersCrudo.map(deepCloneFilterOption));
  const referentOptions = Object.freeze(referentsCrudo.map(deepCloneReferentOption));

  return Object.freeze({
    technicians,
    sectors,
    requesters,
    referentOptions
  });
}
