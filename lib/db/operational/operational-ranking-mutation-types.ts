function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidSqlInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 2147483647;
}

export interface OperationalRankingMutationActor {
  readonly userId: number;
  readonly role: 'admin' | 'priorizador';
  readonly username: string;
  readonly displayName: string;
}

export function isOperationalRankingMutationRole(
  role: string
): role is OperationalRankingMutationActor['role'] {
  return role === 'admin' || role === 'priorizador';
}

export type ParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly httpStatus: 400; readonly error: string };

export interface PatchMutationInput {
  readonly ticketId: number;
  readonly newPosition: number;
  readonly ownerUserId?: number;
}

export interface DeleteMutationInput {
  readonly ticketId: number;
  readonly ownerUserId?: number;
}

export interface ReorderMutationInput {
  readonly orderedTicketIds: readonly number[];
  readonly ownerUserId?: number;
}

export function parsePatchMutation(ticketIdRaw: string, body: unknown): ParseResult<PatchMutationInput> {
  if (typeof ticketIdRaw !== 'string' || !/^\d+$/.test(ticketIdRaw)) {
    return { success: false, httpStatus: 400, error: 'invalid_ticket_id' };
  }
  const ticketId = Number(ticketIdRaw);
  if (!isValidSqlInt(ticketId)) {
    return { success: false, httpStatus: 400, error: 'invalid_ticket_id' };
  }

  if (!isRecord(body)) {
    return { success: false, httpStatus: 400, error: 'invalid_body' };
  }

  if (!('newPosition' in body)) {
    return { success: false, httpStatus: 400, error: 'invalid_body_keys' };
  }

  for (const key of Reflect.ownKeys(body)) {
    if (typeof key !== 'string' || (key !== 'newPosition' && key !== 'ownerUserId')) {
      return { success: false, httpStatus: 400, error: 'invalid_body_keys' };
    }
  }

  const newPosition = body['newPosition'];
  if (!isValidSqlInt(newPosition)) {
    return { success: false, httpStatus: 400, error: 'invalid_new_position' };
  }

  let ownerUserId: number | undefined;
  if ('ownerUserId' in body) {
    const rawOwner = body['ownerUserId'];
    if (!isValidSqlInt(rawOwner)) {
      return { success: false, httpStatus: 400, error: 'invalid_owner_user_id' };
    }
    ownerUserId = rawOwner;
  }

  return { success: true, data: Object.freeze({ ticketId, newPosition, ownerUserId }) };
}

export function parseDeleteMutation(ticketIdRaw: string, searchParams: URLSearchParams): ParseResult<DeleteMutationInput> {
  if (typeof ticketIdRaw !== 'string' || !/^\d+$/.test(ticketIdRaw)) {
    return { success: false, httpStatus: 400, error: 'invalid_ticket_id' };
  }
  const ticketId = Number(ticketIdRaw);
  if (!isValidSqlInt(ticketId)) {
    return { success: false, httpStatus: 400, error: 'invalid_ticket_id' };
  }

  let ownerUserId: number | undefined;
  const rawOwner = searchParams.getAll('ownerUserId');
  if (rawOwner.length > 1) {
    return { success: false, httpStatus: 400, error: 'duplicate_owner_user_id' };
  }
  if (rawOwner.length === 1) {
    const parsedOwner = Number(rawOwner[0]);
    if (!isValidSqlInt(parsedOwner) || !/^\d+$/.test(rawOwner[0]!)) {
      return { success: false, httpStatus: 400, error: 'invalid_owner_user_id' };
    }
    ownerUserId = parsedOwner;
  }

  return { success: true, data: Object.freeze({ ticketId, ownerUserId }) };
}

export function parseReorderMutation(body: unknown): ParseResult<ReorderMutationInput> {
  if (!isRecord(body)) {
    return { success: false, httpStatus: 400, error: 'invalid_body' };
  }

  if (!('orderedTicketIds' in body)) {
    return { success: false, httpStatus: 400, error: 'invalid_body_keys' };
  }

  for (const key of Reflect.ownKeys(body)) {
    if (typeof key !== 'string' || (key !== 'orderedTicketIds' && key !== 'ownerUserId')) {
      return { success: false, httpStatus: 400, error: 'invalid_body_keys' };
    }
  }

  const orderedTicketIdsRaw = body['orderedTicketIds'];
  if (!Array.isArray(orderedTicketIdsRaw) || orderedTicketIdsRaw.length === 0 || orderedTicketIdsRaw.length > 200) {
    return { success: false, httpStatus: 400, error: 'invalid_ordered_ticket_ids_length' };
  }

  const orderedTicketIds: number[] = [];
  const set = new Set<number>();
  for (let i = 0; i < orderedTicketIdsRaw.length; i++) {
    const id = orderedTicketIdsRaw[i];
    if (!isValidSqlInt(id)) {
      return { success: false, httpStatus: 400, error: 'invalid_ticket_id_in_array' };
    }
    if (set.has(id)) {
      return { success: false, httpStatus: 400, error: 'duplicate_ticket_id' };
    }
    set.add(id);
    orderedTicketIds.push(id);
  }

  let ownerUserId: number | undefined;
  if ('ownerUserId' in body) {
    const rawOwner = body['ownerUserId'];
    if (!isValidSqlInt(rawOwner)) {
      return { success: false, httpStatus: 400, error: 'invalid_owner_user_id' };
    }
    ownerUserId = rawOwner;
  }

  return { success: true, data: Object.freeze({ orderedTicketIds: Object.freeze(orderedTicketIds), ownerUserId }) };
}
