export interface OperationalRankingListCoordination {
  readonly progressPercent: number;
  readonly coordinatorComment: string;
  readonly estimatedDeliveryDate: string | null;
  readonly updatedAt: Date;
}

export interface OperationalRankingListTicket {
  readonly ticketId: number;
  readonly title: string;
  readonly status: number;
  readonly statusLabel: string;
  readonly type: number;
  readonly typeLabel: string;
  readonly priority: number;
  readonly openedAt: string;
  readonly requesterName: string;
  readonly assignedTechnician: string;
  readonly detectedSector: string;
  readonly webUrl: string;
  readonly coordination: OperationalRankingListCoordination | null;
}

export interface OperationalRankingListItem {
  readonly id: number;
  readonly ticketId: number;
  readonly sectorName: string;
  readonly glpiGroupId: number;
  readonly rankPosition: number;
  readonly isActive: boolean;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly prioritySetBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly ticket: OperationalRankingListTicket;
}
