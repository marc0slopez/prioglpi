import type { OperationalCoordinationState } from './operational-coordination-mutation-types';

export interface OperationalCoordinationUpsertInput {
  readonly ticketId: number;
  readonly progressPercent: number;
  readonly coordinatorComment: string;
  readonly estimatedDeliveryDate: string | null;
  readonly updatedByUserId: number;
  readonly updatedAt: Date;
}

export interface IOperationalCoordinationWriteRepository {
  findByTicketId(ticketId: number): Promise<OperationalCoordinationState | null>;
  upsert(input: OperationalCoordinationUpsertInput): Promise<void>;
}
