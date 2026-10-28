import type {
  OperationalTicket,
  OperationalTicketRanking,
  OperationalTicketCoordination,
  OperationalFollowup,
  OperationalTask
} from './operational-ticket-types';

export class OperationalTicketDetailError extends Error {
  constructor(public code: 'corrupt_data', message: string) {
    super(message);
    this.name = 'OperationalTicketDetailError';
  }
}

export interface OperationalTicketDetail extends Omit<OperationalTicket, 'assignedGroupIds' | 'assignedGroupNames'> {
  assignedGroupIds: number[];
  assignedGroupNames: string[];
  rankings: readonly OperationalTicketRanking[];
  coordination: OperationalTicketCoordination | null;
  followups: readonly OperationalFollowup[];
  tasks: readonly OperationalTask[];
}

export function parseOperationalTicketAssignedGroups(ticket: OperationalTicket): { assignedGroupIds: number[]; assignedGroupNames: string[] } {
  let parsedIds: unknown;
  try {
    parsedIds = JSON.parse(ticket.assignedGroupIds || '[]');
  } catch {
    throw new OperationalTicketDetailError('corrupt_data', 'Invalid JSON error');
  }

  if (!Array.isArray(parsedIds)) {
    throw new OperationalTicketDetailError('corrupt_data', 'Not an array error');
  }

  const assignedGroupIds: number[] = [];
  for (const id of parsedIds) {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
      throw new OperationalTicketDetailError('corrupt_data', 'Invalid ID element error');
    }
    assignedGroupIds.push(id);
  }

  let parsedNames: unknown;
  try {
    parsedNames = JSON.parse(ticket.assignedGroupNames || '[]');
  } catch {
    throw new OperationalTicketDetailError('corrupt_data', 'Invalid JSON error');
  }

  if (!Array.isArray(parsedNames)) {
    throw new OperationalTicketDetailError('corrupt_data', 'Not an array error');
  }

  const assignedGroupNames: string[] = [];
  for (const name of parsedNames) {
    if (typeof name !== 'string') {
      throw new OperationalTicketDetailError('corrupt_data', 'Invalid name element error');
    }
    assignedGroupNames.push(name);
  }

  return { assignedGroupIds, assignedGroupNames };
}

export function buildOperationalTicketDetail(
  ticket: OperationalTicket,
  rankings: readonly OperationalTicketRanking[],
  coordination: OperationalTicketCoordination | null,
  followups: readonly OperationalFollowup[],
  tasks: readonly OperationalTask[],
  canSeePrivate: boolean
): OperationalTicketDetail {
  const { assignedGroupIds, assignedGroupNames } = parseOperationalTicketAssignedGroups(ticket);

  const visibleFollowups = canSeePrivate ? followups : followups.filter(f => !f.isPrivate);
  const visibleTasks = canSeePrivate ? tasks : tasks.filter(t => !t.isPrivate);

  return {
    ...ticket,
    assignedGroupIds,
    assignedGroupNames,
    rankings,
    coordination,
    followups: visibleFollowups,
    tasks: visibleTasks
  };
}
