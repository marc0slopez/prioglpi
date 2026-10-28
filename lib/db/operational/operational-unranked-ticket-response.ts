import type { OperationalUnrankedTicketPage } from './operational-ticket-types';
import { parseOperationalTicketAssignedGroups } from './operational-ticket-detail';

export function buildOperationalUnrankedTicketResponse(pageData: OperationalUnrankedTicketPage) {
  const tickets = pageData.items.map(item => {
    const { assignedGroupIds, assignedGroupNames } = parseOperationalTicketAssignedGroups(item.ticket);
    return {
      ...item.ticket,
      assignedGroupIds,
      assignedGroupNames,
      coordination: item.coordination
    };
  });

  return {
    tickets,
    total: pageData.total,
    page: pageData.page,
    limit: pageData.limit,
    pages: Math.ceil(pageData.total / pageData.limit)
  };
}
