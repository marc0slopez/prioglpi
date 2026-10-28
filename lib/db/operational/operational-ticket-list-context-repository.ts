import type { OperationalActiveReferentContext } from './operational-ticket-list-context-types';

export interface IOperationalTicketListContextRepository {
  findActiveReferentContext(
    referentUserId: number
  ): Promise<OperationalActiveReferentContext | null>;

  isActiveNonReferentRequesterInGroups(
    requesterGlpiUserId: number,
    groupIds: readonly number[]
  ): Promise<boolean>;
}
