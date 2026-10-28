export interface OperationalFilterOption {
  readonly id: number;
  readonly name: string;
}

export interface OperationalReferentGroupOption {
  readonly glpiGroupId: number;
  readonly sectorName: string;
}

export interface OperationalReferentOption {
  readonly id: number;
  readonly displayName: string;
  readonly glpiUserId: number | null;
  readonly groups: readonly OperationalReferentGroupOption[];
  readonly isActive: boolean;
}

export interface OperationalTicketFilterOptionsResponse {
  readonly technicians: readonly OperationalFilterOption[];
  readonly sectors: readonly OperationalFilterOption[];
  readonly requesters: readonly OperationalFilterOption[];
  readonly referentOptions: readonly OperationalReferentOption[];
}
