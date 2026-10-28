export interface OperationalCoordinationUpdatePayload {
  progressPercent?: number;
  coordinatorComment?: string;
  estimatedDeliveryDate?: string | null;
  /** true => is_private=1 (comentario interno), false => is_private=0 (visible al solicitante). Default true. */
  commentIsPrivate?: boolean;
}

export interface OperationalCoordinationState {
  readonly id: number;
  readonly ticketId: number;
  readonly progressPercent: number;
  readonly coordinatorComment: string;
  readonly estimatedDeliveryDate: string | null;
  readonly updatedByUserId: number;
  readonly updatedByDisplayName: string;
  readonly updatedAt: Date;
}

export interface OperationalCoordinationMutationResult {
  readonly coordination: OperationalCoordinationState;
  /** Advertencia sobre el followup si no se pudo crear (ej: permisos GLPI insuficientes). */
  readonly followupWarning?: string | null;
  /** Advertencia sobre el avance si no se pudo confirmar la actualización en GLPI. */
  readonly progressWarning?: string | null;
}

export type OperationalCoordinationMutationErrorCode =
  | 'invalid_input'
  | 'ticket_not_found'
  | 'forbidden'
  | 'invalid_state';

export class OperationalCoordinationMutationError extends Error {
  public readonly code: OperationalCoordinationMutationErrorCode;
  constructor(code: OperationalCoordinationMutationErrorCode, message: string) {
    super(message);
    this.name = 'OperationalCoordinationMutationError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateExactKeys(
  input: unknown,
  allowedKeys: readonly string[]
): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new OperationalCoordinationMutationError('invalid_input', 'Payload must be an object');
  }
  const keys = Reflect.ownKeys(input);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (typeof k !== 'string') {
      throw new OperationalCoordinationMutationError('invalid_input', 'Symbols are not allowed');
    }
    if (!allowedKeys.includes(k)) {
      throw new OperationalCoordinationMutationError('invalid_input', `Unexpected key: ${k}`);
    }
  }
  return input;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const daysInMonth = [0, 31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month] ?? 0);
}

function isValidComment(comment: string): boolean {
  if (comment.length > 10000) return false;
  for (let i = 0; i < comment.length; i++) {
    const code = comment.charCodeAt(i);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
      return false;
    }
  }
  return true;
}

export function parseCoordinationTicketId(input: unknown): number {
  let val: number;
  if (typeof input === 'number') {
    val = input;
  } else if (typeof input === 'string' && /^[1-9]\d*$/.test(input)) {
    val = Number(input);
  } else {
    throw new OperationalCoordinationMutationError('invalid_input', 'Invalid ticketId');
  }

  if (!Number.isSafeInteger(val) || val < 1 || val > 2147483647) {
    throw new OperationalCoordinationMutationError('invalid_input', 'Invalid ticketId');
  }
  return val;
}

export function parseCoordinationPatchInput(input: unknown): OperationalCoordinationUpdatePayload {
  const obj = validateExactKeys(input, ['progressPercent', 'coordinatorComment', 'estimatedDeliveryDate', 'commentIsPrivate']);
  const parsed: OperationalCoordinationUpdatePayload = {};

  if ('progressPercent' in obj && obj.progressPercent !== undefined) {
    const pp = obj.progressPercent;
    if (typeof pp !== 'number' || !Number.isSafeInteger(pp) || ![0, 25, 50, 75, 100].includes(pp)) {
      throw new OperationalCoordinationMutationError('invalid_input', 'progressPercent must be 0, 25, 50, 75, or 100');
    }
    parsed.progressPercent = pp;
  }

  if ('coordinatorComment' in obj && obj.coordinatorComment !== undefined) {
    const cc = obj.coordinatorComment;
    if (typeof cc !== 'string' || !isValidComment(cc)) {
      throw new OperationalCoordinationMutationError('invalid_input', 'Invalid coordinatorComment');
    }
    parsed.coordinatorComment = cc;
  }

  if ('estimatedDeliveryDate' in obj && obj.estimatedDeliveryDate !== undefined) {
    const edd = obj.estimatedDeliveryDate;
    if (edd === null || edd === '') {
      parsed.estimatedDeliveryDate = null;
    } else if (typeof edd === 'string' && isValidCalendarDate(edd)) {
      parsed.estimatedDeliveryDate = edd;
    } else {
      throw new OperationalCoordinationMutationError('invalid_input', 'estimatedDeliveryDate must be YYYY-MM-DD');
    }
  }

  if ('commentIsPrivate' in obj && obj.commentIsPrivate !== undefined) {
    const cip = obj.commentIsPrivate;
    if (typeof cip !== 'boolean') {
      throw new OperationalCoordinationMutationError('invalid_input', 'commentIsPrivate must be a boolean');
    }
    parsed.commentIsPrivate = cip;
  }

  return Object.freeze(parsed);
}
