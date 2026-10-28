export interface OperationalTicket {
  ticketId: number;
  title: string;
  contentPlain: string;
  status: number;
  statusLabel: string;
  type: number;
  typeLabel: string;
  priority: number;
  priorityLabel: string;
  openedAt: string;
  updatedAtGlpi: string;
  solvedAt: string | null;
  closedAt: string | null;
  requesterName: string;
  requesterGroup: string;
  assignedTechnician: string;
  assignedGroupIds: string;
  assignedGroupNames: string;
  detectedSector: string;
  isSistemasScope: boolean;
  isTecnologiaScope: boolean;
  webUrl: string;
  syncedAt: Date;
  requesterUserId: number | null;
  requesterGroupId: number | null;
  detectedSectorGroupId: number | null;
  detectedSectorName: string | null;
  sectorSource: string | null;
  categoryId: number | null;
  entityId: number | null;
  locationId: number | null;
  requestTypeId: number | null;
  urgency: number | null;
  impact: number | null;
  glpiPriority: number | null;
}

export interface OperationalTicketRanking {
  id: number;
  ticketId: number;
  sectorName: string;
  glpiGroupId: number;
  rankPosition: number;
  createdByUserId: number;
  updatedByUserId: number;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

export interface OperationalTicketCoordination {
  id: number;
  ticketId: number;
  progressPercent: number;
  coordinatorComment: string;
  estimatedDeliveryDate: string | null;
  updatedByUserId: number;
  updatedAt: Date;
}

export interface OperationalFollowup {
  followupId: number;
  ticketId: number;
  author: string | null;
  contentPlain: string;
  isPrivate: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperationalTask {
  taskId: number;
  ticketId: number;
  author: string | null;
  technician: string | null;
  techGroup: string | null;
  contentPlain: string;
  isPrivate: boolean;
  state: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperationalUnrankedTicketPageInput {
  glpiGroupId: number;
  ownerUserId: number;
  page: number;
  limit: number;
}

export interface OperationalUnrankedTicketItem {
  ticket: OperationalTicket;
  coordination: OperationalTicketCoordination | null;
}

export interface OperationalUnrankedTicketPage {
  items: readonly OperationalUnrankedTicketItem[];
  total: number;
  page: number;
  limit: number;
}
