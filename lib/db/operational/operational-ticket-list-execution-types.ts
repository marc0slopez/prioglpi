import type { OperationalTicket, OperationalTicketRanking, OperationalTicketCoordination } from './operational-ticket-types';

export interface OperationalTicketListResponseTicket
  extends Omit<OperationalTicket, 'assignedGroupIds' | 'assignedGroupNames'> {
  readonly assignedGroupIds: readonly number[];
  readonly assignedGroupNames: readonly string[];
  readonly rankings: readonly OperationalTicketRanking[];
  readonly coordination: OperationalTicketCoordination | null;
}

export interface OperationalTicketListResponse {
  readonly tickets: readonly OperationalTicketListResponseTicket[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly pages: number;
}

export type OperationalTicketListExecutionErrorCode = 'corrupt_data';

export class OperationalTicketListExecutionError extends Error {
  public readonly code: OperationalTicketListExecutionErrorCode;
  constructor(code: OperationalTicketListExecutionErrorCode, message: string) {
    super(message);
    this.name = 'OperationalTicketListExecutionError';
    this.code = code;
  }
}
