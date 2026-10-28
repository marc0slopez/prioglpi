import type {
  OperationalRankingMutationTicket,
  OperationalRankingMutationGroup,
  OperationalActiveRankingState,
  OperationalRankingUpsertInput,
  OperationalRankingPositionUpdateInput,
  OperationalRankingDeactivateInput
  , OperationalRankingSharedQueue
} from './operational-ranking-write-types';

export class OperationalRankingWriteError extends Error {
  constructor(
    public readonly code: 'invalid_input' | 'ambiguous_result' | 'corrupt_data' | 'unexpected_result' | 'concurrency_conflict',
    message: string
  ) {
    super(message);
    this.name = 'OperationalRankingWriteError';
  }
}

export interface IOperationalRankingWriteRepository {
  findTicketById(ticketId: number): Promise<OperationalRankingMutationTicket | null>;
  findGroupById(groupId: number): Promise<OperationalRankingMutationGroup | null>;
  listActiveRankingsByGroupId(glpiGroupId: unknown): Promise<readonly OperationalActiveRankingState[]>;
  listActiveRankingsByOwnerUserId?(ownerUserId: unknown): Promise<readonly OperationalActiveRankingState[]>;
  upsertActiveRanking(input: OperationalRankingUpsertInput): Promise<void>;
  updateActiveRankingPosition(input: OperationalRankingPositionUpdateInput): Promise<'updated' | 'not_found'>;
  acquireGroupLock(glpiGroupId: unknown): Promise<void>;
  acquireOwnerLock?(ownerUserId: unknown): Promise<void>;
  parkActiveRankingPositionsForGroup(glpiGroupId: unknown, ticketIds: readonly number[], actorUserId: unknown, updatedAt: Date, expectedRows: number): Promise<number>;
  parkActiveRankingPositionsForOwner?(ownerUserId: unknown, ticketIds: readonly number[], actorUserId: unknown, updatedAt: Date, expectedRows: number): Promise<number>;
  deactivateActiveRanking(input: OperationalRankingDeactivateInput): Promise<'updated' | 'not_found'>;
  listTicketsByIds(ticketIds: readonly number[]): Promise<readonly OperationalRankingMutationTicket[]>;
  getSharedQueueForGroup?(glpiGroupId: unknown): Promise<OperationalRankingSharedQueue | null>;
}
