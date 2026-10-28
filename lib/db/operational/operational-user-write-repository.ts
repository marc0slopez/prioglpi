import type {
  OperationalUserCreateInput,
  OperationalUserUpdateInput,
  OperationalUserScopeInput
} from './operational-user-types';

export type OperationalUserWriteErrorCode = 'invalid_input' | 'unexpected_result';

export class OperationalUserWriteError extends Error {
  constructor(public readonly code: OperationalUserWriteErrorCode, message: string) {
    super(message);
    this.name = 'OperationalUserWriteError';
  }
}

export interface IOperationalUserWriteRepository {
  createUser(input: OperationalUserCreateInput): Promise<number>;
  updateUser(id: number, input: OperationalUserUpdateInput): Promise<'updated' | 'not_found'>;
  replaceScopes(userId: number, scopes: readonly OperationalUserScopeInput[]): Promise<void>;
}
