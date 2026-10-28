import type { OperationalActivityVisibility } from './operational-ticket-list-filter-types';

export interface IOperationalTicketListFilterRepository {
  listHistoricalRankedTicketIdsByReferent(
    referentUserId: number
  ): Promise<readonly number[]>;

  listTicketIdsByDirectTechnician(
    technicianGlpiUserId: number
  ): Promise<readonly number[]>;

  listTicketIdsByCanonicalTechnician(
    technicianGlpiUserId: number | null
  ): Promise<readonly number[]>;

  listTicketIdsAssignedToActiveUsersInGroup(
    groupId: number
  ): Promise<readonly number[]>;

  listTicketIdsByRequester(
    requesterGlpiUserId: number
  ): Promise<readonly number[]>;

  listTicketIdsByFollowupText(
    text: string,
    visibility: OperationalActivityVisibility
  ): Promise<readonly number[]>;

  listTicketIdsByActivityText(
    text: string,
    visibility: 'all' | 'public_only'
  ): Promise<readonly number[]>;

  listTicketIdsBySoporteDycosGroup(): Promise<readonly number[]>;
}
