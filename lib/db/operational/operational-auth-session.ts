import type { IOperationalUserReadRepository } from './operational-user-read-repository';
import type { JwtPayload } from '../../jwt-utils';

export interface OperationalAuthSessionUser {
  userId: number;
  username: string;
  role: string;
  displayName: string;
  authSource: 'ad';
  sectors: string[];
  sectorGroupIds: number[];
  sectorScopes: { sectorName: string; glpiGroupId: number }[];
}

export async function resolveOperationalAuthSessionUser(
  repository: IOperationalUserReadRepository,
  payload: JwtPayload
): Promise<OperationalAuthSessionUser | null> {
  if (payload.authSource !== 'ad') return null;

  const user = await repository.findByIdWithScopes(payload.userId);
  if (!user) return null;

  if (user.id !== payload.userId) return null;
  if (user.username !== payload.username) return null;
  if (user.role !== payload.role) return null;
  if (user.isActive !== true) return null;
  if (user.authSource !== 'ad') return null;
  if (user.directoryActive !== true) return null;

  if (typeof user.adObjectId !== 'string') return null;
  if (user.adObjectId.trim() === '') return null;
  if (user.passwordHash !== null) return null;
  if (user.role === 'system') return null;

  const structuredScopes: { sectorName: string; glpiGroupId: number }[] = [];

  for (const scope of user.sectorScopes) {
    if (typeof scope.glpiGroupId === 'number' && Number.isSafeInteger(scope.glpiGroupId) && scope.glpiGroupId > 0) {
      structuredScopes.push({
        sectorName: scope.sectorName,
        glpiGroupId: scope.glpiGroupId,
      });
    }
  }

  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    authSource: 'ad',
    sectors: structuredScopes.map((s) => s.sectorName),
    sectorGroupIds: structuredScopes.map((s) => s.glpiGroupId),
    sectorScopes: structuredScopes,
  };
}
