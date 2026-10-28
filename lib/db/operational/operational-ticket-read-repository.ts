import type {
  OperationalTicket,
  OperationalTicketRanking,
  OperationalTicketCoordination,
  OperationalFollowup,
  OperationalTask,
  OperationalUnrankedTicketPageInput,
  OperationalUnrankedTicketPage
} from './operational-ticket-types';

export interface IOperationalTicketReadRepository {
  findTicketById(ticketId: number): Promise<OperationalTicket | null>;
  listActiveRankingsByTicketId(ticketId: number): Promise<readonly OperationalTicketRanking[]>;
  findCoordinationByTicketId(ticketId: number): Promise<OperationalTicketCoordination | null>;
  listFollowupsByTicketId(ticketId: number): Promise<readonly OperationalFollowup[]>;
  listTasksByTicketId(ticketId: number): Promise<readonly OperationalTask[]>;
  listUnrankedTicketsPage(input: OperationalUnrankedTicketPageInput): Promise<OperationalUnrankedTicketPage>;
}

export type OperationalTicketReadErrorCode =
  | 'invalid_input'
  | 'ambiguous_result'
  | 'corrupt_data';

export class OperationalTicketReadError extends Error {
  public readonly code: OperationalTicketReadErrorCode;
  constructor(code: OperationalTicketReadErrorCode, message: string) {
    super(message);
    this.name = 'OperationalTicketReadError';
    this.code = code;
  }
}
