import type { SqlParameter } from '../sqlserver-runtime-contract';

export type OperationalTicketListBranch = 'ranked' | 'unranked';

export interface OperationalSqlStatement {
  readonly sql: string;
  readonly params: readonly SqlParameter[];
}

export interface OperationalTicketListCountProgram {
  readonly rankedCount: OperationalSqlStatement | null;
  readonly unrankedCount: OperationalSqlStatement | null;
}

export type OperationalTicketListSqlErrorCode =
  | 'invalid_plan'
  | 'invalid_pagination'
  | 'unsupported_branch';

export class OperationalTicketListSqlError extends Error {
  constructor(public readonly code: OperationalTicketListSqlErrorCode, message: string) {
    super(message);
    this.name = 'OperationalTicketListSqlError';
    Object.setPrototypeOf(this, OperationalTicketListSqlError.prototype);
  }
}
