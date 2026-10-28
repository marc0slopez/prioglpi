import type { OperationalRankingListItem } from './operational-ranking-list-types';

export class OperationalRankingReadError extends Error {
  constructor(
    public readonly code: 'invalid_input' | 'corrupt_data',
    message: string
  ) {
    super(message);
    this.name = 'OperationalRankingReadError';
  }
}

export interface IOperationalRankingReadRepository {
  listActiveRankings(
    ownerUserId: number | readonly number[] | null
  ): Promise<readonly OperationalRankingListItem[]>;
}
