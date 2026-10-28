import type {
  CanonicalAction,
  CanonicalEntityType
} from '../../audit-types';

export interface OperationalAuditWriteInput {
  readonly userId: number | null;
  readonly action: CanonicalAction;
  readonly entityType: CanonicalEntityType;
  readonly entityId: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly actorName: string | null;
  readonly actorUsername: string | null;
}

export class OperationalAuditWriteError extends Error {
  constructor(
    public readonly code: 'invalid_input' | 'unexpected_result',
    message: string
  ) {
    super(message);
    this.name = 'OperationalAuditWriteError';
  }
}

export interface IOperationalAuditWriteRepository {
  writeAudit(input: OperationalAuditWriteInput): Promise<void>;
}
