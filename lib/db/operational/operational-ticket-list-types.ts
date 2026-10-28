export const OPERATIONAL_TICKET_LIST_PARAMS = [
  'categoryId',
  'comments',
  'description',
  'entityId',
  'from',
  'glpiPriority',
  'hasTPR',
  'isActiveRanking',
  'isUnranked',
  'limit',
  'locationId',
  'notes',
  'page',
  'priority',
  'referentUserId',
  'requesterId',
  'search',
  'sector',
  'sectorGroupId',
  'soporteDycos',
  'status',
  'technicianId',
  'ticketId',
  'title',
  'to',
  'toExclusive',
  'tprVencida',
  'type',
  'unassignedTechnician',
  'updatedFrom',
  'updatedTo',
  'view'
] as const;

export interface OperationalTicketListActor {
  role: 'admin' | 'coordinador_sistemas' | 'priorizador' | 'referente' | 'tecnico_sistemas';
  sectorGroupIds: readonly number[];
}

export type OperationalTicketSectorFilter =
  | { type: 'all' }
  | { type: 'group_id'; id: number }
  | { type: 'name'; name: string };

export interface OperationalTicketListQuery {
  actor: OperationalTicketListActor;
  view: 'open' | 'history' | 'all';
  priority: 'ranked' | 'unranked' | 'all';
  page: number;
  limit: number;
  offset: number;
  status: number | null;
  referentUserId: number | null;
  ticketId: number | null;
  technicianId: number | null;
  requesterId: number | null;
  categoryId: number | null;
  entityId: number | null;
  locationId: number | null;
  type: number | null;
  glpiPriority: number | null;
  sectorGroupId: number | null;
  sector: OperationalTicketSectorFilter;
  from: string | null;
  to: string | null;
  toExclusive: string | null;
  updatedFrom: string | null;
  updatedTo: string | null;
  search: string | null;
  title: string | null;
  description: string | null;
  notes: string | null;
  comments: string | null;
  isActiveRanking: boolean;
  isUnranked: boolean;
  hasTPR: boolean;
  tprVencida: boolean;
  unassignedTechnician: boolean;
  soporteDycosFilter: boolean;
  canSeePrivate: boolean;
  isDrillDown: boolean;
}

export type OperationalTicketListParseResult =
  | { status: 'success'; query: OperationalTicketListQuery }
  | {
      status: 'error';
      httpStatus: 400 | 403;
      error: string;
    };
