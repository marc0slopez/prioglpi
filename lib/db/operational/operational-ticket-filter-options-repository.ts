import type { OperationalFilterOption, OperationalReferentOption } from './operational-ticket-filter-options-types';

export class OperationalTicketFilterOptionsError extends Error {
  constructor(
    public readonly code: 'invalid_input' | 'corrupt_data',
    message: string
  ) {
    super(message);
    this.name = 'OperationalTicketFilterOptionsError';
  }
}

export interface IOperationalTicketFilterOptionsRepository {
  listTechnicians(): Promise<readonly OperationalFilterOption[]>;
  listSistemasSectors(): Promise<readonly OperationalFilterOption[]>;
  listSistemasRequesters(): Promise<readonly OperationalFilterOption[]>;
  listActiveReferentOptions(): Promise<readonly OperationalReferentOption[]>;
  listScopedRequesters(
    groupIds: readonly number[]
  ): Promise<readonly OperationalFilterOption[]>;
}
