import type {
  OperationalUser,
  OperationalUserRole,
  OperationalUserWithScopes
} from './operational-user-types';

export type OperationalUserReadErrorCode = 'invalid_input' | 'ambiguous_result' | 'corrupt_data';

export class OperationalUserReadError extends Error {
  constructor(public readonly code: OperationalUserReadErrorCode, message: string) {
    super(message);
    this.name = 'OperationalUserReadError';
  }
}

export interface IOperationalUserReadRepository {
  findById(id: number): Promise<OperationalUser | null>;
  findByUsername(username: string): Promise<OperationalUser | null>;
  findByGlpiUserId(glpiUserId: number): Promise<OperationalUser | null>;
  findCandidatesByUsernameOrAdObjectId(
    username: string,
    adObjectId: string
  ): Promise<readonly OperationalUser[]>;
  findByIdWithScopes(id: number): Promise<OperationalUserWithScopes | null>;
  listActiveByRoles(
    roles: readonly OperationalUserRole[]
  ): Promise<readonly OperationalUser[]>;
}
