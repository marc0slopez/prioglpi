export type OperationalActivityVisibility =
  | 'all'
  | 'public_only'
  | 'private_only';

export type OperationalTicketListFilterErrorCode =
  | 'invalid_input'
  | 'corrupt_data';

export class OperationalTicketListFilterError extends Error {
  constructor(public readonly code: OperationalTicketListFilterErrorCode, message: string) {
    super(message);
    this.name = 'OperationalTicketListFilterError';
    Object.setPrototypeOf(this, OperationalTicketListFilterError.prototype);
  }
}
