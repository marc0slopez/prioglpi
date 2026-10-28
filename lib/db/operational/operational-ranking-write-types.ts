export interface OperationalRankingMutationTicket {
  readonly ticketId: number;
  readonly isSistemasScope: boolean;
  readonly status: number;
  readonly statusLabel: string;
  readonly detectedSector: string;
  readonly detectedSectorGroupId: number | null;
}

export interface OperationalRankingMutationGroup {
  readonly groupId: number;
  readonly name: string;
  readonly completeName: string;
}

export interface OperationalActiveRankingState {
  readonly id: number;
  readonly ticketId: number;
  readonly sectorName: string;
  readonly glpiGroupId: number;
  readonly rankPosition: number;
  readonly createdByUserId: number;
  readonly updatedByUserId: number;
  /** User who last explicitly established this ticket's priority. */
  readonly prioritySetByUserId?: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly isActive: true;
  /** The prioritizer whose personal queue owns this row. */
  readonly ownerUserId?: number;
}

export interface OperationalRankingUpsertInput {
  readonly ticketId: number;
  readonly sectorName: string;
  readonly glpiGroupId: number;
  readonly ownerUserId: number; // legacy support
  readonly rankPosition: number;
  readonly actorUserId: number;
  readonly updatedAt: Date;
}

export interface OperationalRankingPositionUpdateInput {
  readonly rankingId: number;
  readonly ticketId: number;
  readonly glpiGroupId: number;
  readonly ownerUserId: number;
  readonly rankPosition: number;
  readonly actorUserId: number;
  readonly prioritySetByUserId: number;
  readonly updatedAt: Date;
}

export interface OperationalRankingDeactivateInput {
  readonly rankingId: number;
  readonly ticketId: number;
  readonly glpiGroupId: number;
  readonly ownerUserId: number;
  readonly actorUserId: number;
  readonly updatedAt: Date;
}

export interface OperationalRankingSharedQueue {
  readonly queueId: number;
  readonly memberUserIds: readonly number[];
  readonly scopeGroupIds: readonly number[];
}
