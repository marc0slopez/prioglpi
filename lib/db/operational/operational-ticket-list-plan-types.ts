import type { OperationalTicketListQuery } from './operational-ticket-list-types';

export interface OperationalReferentListPlan {
  userId: number;
  activeGroupIds: readonly number[];
  historicalTicketIds: readonly number[];
}

export interface OperationalTicketListExecutionPlan {
  query: OperationalTicketListQuery;
  referent: OperationalReferentListPlan | null;

  // null significa que no existe restricción por intersección.
  // [] significa que los filtros activos no encontraron coincidencias.
  includeTicketIds: readonly number[] | null;

  // Exclusiones para el caso legacy de “sin técnico” de referente/supervisor.
  excludeTicketIds: readonly number[];

  // null significa que no hay búsqueda global.
  // [] significa que hubo búsqueda pero no coincidió en followups/tasks.
  activityTextTicketIds: readonly number[] | null;
}

export type OperationalTicketListPlanErrorCode = 'corrupt_data';

export class OperationalTicketListPlanError extends Error {
  constructor(public readonly code: OperationalTicketListPlanErrorCode, message: string) {
    super(message);
    this.name = 'OperationalTicketListPlanError';
    Object.setPrototypeOf(this, OperationalTicketListPlanError.prototype);
  }
}

export type OperationalTicketListPlanResult =
  | {
      status: 'success';
      plan: OperationalTicketListExecutionPlan;
    }
  | {
      status: 'error';
      httpStatus: 400 | 403;
      error: string;
    };
