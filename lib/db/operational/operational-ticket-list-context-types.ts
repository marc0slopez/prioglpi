export type OperationalTicketListContextErrorCode =
  | 'invalid_input'
  | 'ambiguous_result'
  | 'corrupt_data';

export class OperationalTicketListContextError extends Error {
  constructor(public readonly code: OperationalTicketListContextErrorCode, message: string) {
    super(message);
    this.name = 'OperationalTicketListContextError';
    Object.setPrototypeOf(this, OperationalTicketListContextError.prototype);
  }
}

export interface OperationalActiveReferentContext {
  userId: number;
  groupIds: readonly number[];
}
