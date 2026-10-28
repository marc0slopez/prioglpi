export type OperationalRankingListRole =
  | 'admin'
  | 'coordinador_sistemas'
  | 'tecnico_sistemas'
  | 'priorizador'
  | 'referente';

export interface OperationalRankingListActor {
  readonly role: OperationalRankingListRole;
  readonly sectorGroupIds: readonly number[];
  readonly userId: number;
}

export type OperationalRankingListParseResult =
  | {
      readonly status: 'success';
      readonly ownerUserId: number | null;
    }
  | {
      readonly status: 'error';
      readonly httpStatus: 400 | 403;
      readonly error: string;
    };

export class OperationalRankingListQueryError extends Error {
  constructor(
    public readonly code: 'invalid_actor',
    message: string
  ) {
    super(message);
    this.name = 'OperationalRankingListQueryError';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveSqlInt(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 1 && val <= 2147483647;
}

function validateActor(actor: unknown): OperationalRankingListActor {
  if (!isRecord(actor)) {
    throw new OperationalRankingListQueryError('invalid_actor', 'Invalid actor type');
  }
  const keys = Object.keys(actor);
  if (keys.length !== 3) {
    throw new OperationalRankingListQueryError('invalid_actor', 'Invalid actor keys');
  }
  if (!Object.prototype.hasOwnProperty.call(actor, 'role') || !Object.prototype.hasOwnProperty.call(actor, 'sectorGroupIds') || !Object.prototype.hasOwnProperty.call(actor, 'userId')) {
    throw new OperationalRankingListQueryError('invalid_actor', 'Missing actor keys');
  }

  const userId = actor.userId;
  if (!isPositiveSqlInt(userId)) {
    throw new OperationalRankingListQueryError('invalid_actor', 'Invalid userId');
  }

  const role = actor.role;
  if (role !== 'admin' && role !== 'coordinador_sistemas' && role !== 'tecnico_sistemas' && role !== 'priorizador' && role !== 'referente') {
    throw new OperationalRankingListQueryError('invalid_actor', 'Invalid role');
  }

  const sectorGroupIds = actor.sectorGroupIds;
  if (!Array.isArray(sectorGroupIds)) {
    throw new OperationalRankingListQueryError('invalid_actor', 'Invalid sectorGroupIds type');
  }
  if (sectorGroupIds.length > 200) {
    throw new OperationalRankingListQueryError('invalid_actor', 'Too many sectorGroupIds');
  }

  const unique = new Set<number>();
  for (const id of sectorGroupIds) {
    if (!isPositiveSqlInt(id)) {
      throw new OperationalRankingListQueryError('invalid_actor', 'Invalid group id in actor');
    }
    if (unique.has(id)) {
      throw new OperationalRankingListQueryError('invalid_actor', 'Duplicate group id in actor');
    }
    unique.add(id);
  }

  return {
    role,
    sectorGroupIds: Object.freeze([...sectorGroupIds]),
    userId
  };
}

export function parseOperationalRankingListQuery(
  params: URLSearchParams,
  actorRaw: unknown
): OperationalRankingListParseResult {
  const actor = validateActor(actorRaw);

  const ownerParam = params.getAll('ownerUserId');
  if (ownerParam.length > 1) {
    return { status: 'error', httpStatus: 400, error: 'ownerUserId inválido.' };
  }

  let selectedOwnerId: number | null = null;
  if (ownerParam.length === 1) {
    const val = ownerParam[0];
    if (val !== 'todos') {
      if (!/^[1-9]\d*$/.test(val)) {
        return { status: 'error', httpStatus: 400, error: 'ownerUserId inválido.' };
      }
      const num = Number(val);
      if (!Number.isSafeInteger(num) || num > 2147483647) {
        return { status: 'error', httpStatus: 400, error: 'ownerUserId inválido.' };
      }
      selectedOwnerId = num;
    }
  }

  if (actor.role === 'admin' || actor.role === 'coordinador_sistemas' || actor.role === 'tecnico_sistemas') {
    if (selectedOwnerId === null) {
      return Object.freeze({ status: 'success', ownerUserId: null });
    }
    return Object.freeze({ status: 'success', ownerUserId: selectedOwnerId });
  }

  // priorizador o referente solo ven lo suyo (o no pueden filtrar por otro dueño)
  return Object.freeze({ status: 'success', ownerUserId: actor.userId });
}
