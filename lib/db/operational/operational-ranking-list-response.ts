import type { OperationalRankingListItem } from './operational-ranking-list-types';

export interface OperationalRankingListHttpResponseCoordination {
  readonly progressPercent: number;
  readonly coordinatorComment: string;
  readonly estimatedDeliveryDate: string | null;
  readonly updatedAt: string;
}

export interface OperationalRankingListHttpResponseTicket {
  readonly ticketId: number;
  readonly title: string;
  readonly status: number;
  readonly statusLabel: string;
  readonly priority: number;
  readonly openedAt: string;
  readonly requesterName: string;
  readonly assignedTechnician: string;
  readonly detectedSector: string;
  readonly webUrl: string;
  readonly coordination: OperationalRankingListHttpResponseCoordination | null;
}

export interface OperationalRankingListHttpResponseItem {
  readonly id: number;
  readonly ticketId: number;
  readonly sectorName: string;
  readonly glpiGroupId: number;
  readonly rankPosition: number;
  readonly isActive: boolean;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly prioritySetBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly ticket: OperationalRankingListHttpResponseTicket;
}

export interface OperationalRankingListHttpResponse {
  readonly rankings: readonly OperationalRankingListHttpResponseItem[];
}

export class OperationalRankingListResponseError extends Error {
  constructor(
    public readonly code: 'corrupt_data',
    message: string
  ) {
    super(message);
    this.name = 'OperationalRankingListResponseError';
  }
}

function dateToIsoStrict(d: unknown): string {
  if (!(d instanceof Date) || isNaN(d.getTime())) {
    throw new OperationalRankingListResponseError('corrupt_data', 'Invalid date');
  }
  return d.toISOString();
}

export function buildOperationalRankingListResponse(
  rankings: readonly OperationalRankingListItem[]
): OperationalRankingListHttpResponse {
  const resultRankings: OperationalRankingListHttpResponseItem[] = [];

  for (const r of rankings) {
    let coordination: OperationalRankingListHttpResponseCoordination | null = null;
    if (r.ticket.coordination) {
      coordination = Object.freeze({
        progressPercent: r.ticket.coordination.progressPercent,
        coordinatorComment: r.ticket.coordination.coordinatorComment.slice(),
        estimatedDeliveryDate: r.ticket.coordination.estimatedDeliveryDate === null ? null : r.ticket.coordination.estimatedDeliveryDate.slice(),
        updatedAt: dateToIsoStrict(r.ticket.coordination.updatedAt)
      });
    }

    const ticket = Object.freeze({
      ticketId: r.ticket.ticketId,
      title: r.ticket.title.slice(),
      status: r.ticket.status,
      statusLabel: r.ticket.statusLabel.slice(),
      priority: r.ticket.priority,
      openedAt: r.ticket.openedAt.slice(),
      requesterName: r.ticket.requesterName.slice(),
      assignedTechnician: r.ticket.assignedTechnician.slice(),
      detectedSector: r.ticket.detectedSector.slice(),
      webUrl: r.ticket.webUrl.slice(),
      coordination
    });

    const item = Object.freeze({
      id: r.id,
      ticketId: r.ticketId,
      sectorName: r.sectorName.slice(),
      glpiGroupId: r.glpiGroupId,
      rankPosition: r.rankPosition,
      isActive: r.isActive,
      createdBy: r.createdBy.slice(),
      updatedBy: r.updatedBy.slice(),
      prioritySetBy: r.prioritySetBy.slice(),
      createdAt: dateToIsoStrict(r.createdAt),
      updatedAt: dateToIsoStrict(r.updatedAt),
      ticket
    });

    resultRankings.push(item);
  }

  return Object.freeze({
    rankings: Object.freeze(resultRankings)
  });
}
