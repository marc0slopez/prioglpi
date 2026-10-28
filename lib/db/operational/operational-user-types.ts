export type OperationalUserRole = 'admin' | 'coordinador_sistemas' | 'priorizador' | 'referente' | 'system' | 'tecnico_sistemas';
export type OperationalUserAuthSource = 'local' | 'ad' | 'system';

export interface OperationalUser {
  id: number;
  username: string;
  passwordHash: string | null;
  displayName: string;
  role: OperationalUserRole;
  isActive: boolean;
  glpiUserId: number | null;
  adObjectId: string | null;
  email: string | null;
  authSource: OperationalUserAuthSource;
  directoryActive: boolean | null;
  directoryStatusCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperationalUserSectorScope {
  id: number;
  userId: number;
  sectorName: string;
  glpiGroupId: number | null;
}

export interface OperationalUserWithScopes extends OperationalUser {
  sectorScopes: readonly OperationalUserSectorScope[];
}

export interface OperationalUserCreateInput {
  username: string;
  passwordHash: string | null;
  displayName: string;
  role: OperationalUserRole;
  isActive: boolean;
  glpiUserId: number | null;
  adObjectId: string | null;
  email: string | null;
  authSource: OperationalUserAuthSource;
  directoryActive: boolean | null;
  directoryStatusCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperationalUserUpdateInput {
  passwordHash?: string | null;
  displayName?: string;
  role?: OperationalUserRole;
  isActive?: boolean;
  glpiUserId?: number | null;
  email?: string | null;
  directoryActive?: boolean | null;
  directoryStatusCheckedAt?: Date | null;
  updatedAt: Date;
}

export interface OperationalUserScopeInput {
  sectorName: string;
  glpiGroupId: number | null;
}
