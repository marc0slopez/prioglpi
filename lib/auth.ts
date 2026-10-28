import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { getAuthConfig } from './config/auth-config';
import { verifyJwt } from './jwt-utils';
import type { JwtPayload } from './jwt-utils';

const COOKIE_NAME = 'appglpi_session';
const SESSION_MAX_AGE = 8 * 60 * 60; // 8 hours in seconds

export interface AuthUser extends JwtPayload {
  sectors: string[];
  sectorGroupIds: number[];
  sectorScopes: { sectorName: string; glpiGroupId: number }[];
}

export type AuthenticationResult =
  | { status: 'success'; token: string; user: AuthUser }
  | { status: 'invalid' }
  | { status: 'unavailable' };

async function getLegacyPrisma() {
  const prismaModule = await import('./prisma');
  return prismaModule.prisma;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function buildSuccessResult(
  user: {
    id: number;
    username: string;
    role: string;
    displayName: string;
    sectorScopes: readonly {
      sectorName: string;
      glpiGroupId: number | null;
    }[];
  },
  authSource: 'local' | 'ad'
): AuthenticationResult {
  const authConfig = getAuthConfig();

  const payload: JwtPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    authSource,
  };

  const token = jwt.sign(payload, authConfig.jwtSecret, { expiresIn: SESSION_MAX_AGE });

  const structuredScopes = user.sectorScopes.reduce<
    Array<{ sectorName: string; glpiGroupId: number }>
  >((acc, scope) => {
    const groupId = scope.glpiGroupId;

    if (
      typeof groupId === 'number' &&
      Number.isSafeInteger(groupId)
    ) {
      acc.push({
        sectorName: scope.sectorName,
        glpiGroupId: groupId,
      });
    }

    return acc;
  }, []);

  return {
    status: 'success',
    token,
    user: {
      ...payload,
      sectors: structuredScopes.map((s) => s.sectorName),
      sectorGroupIds: structuredScopes.map((s) => s.glpiGroupId),
      sectorScopes: structuredScopes,
    },
  };
}

export async function authenticateUser(
  username: string,
  passwordPlain: string
): Promise<AuthenticationResult> {
  getAuthConfig();

  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !passwordPlain) return { status: 'invalid' };

  const prisma = await getLegacyPrisma();
  const user = await prisma.user.findUnique({
    where: { username: normalizedUsername, isActive: true },
    include: { sectorScopes: true },
  });

  if (!user) return { status: 'invalid' };
  if (user.role === 'system') return { status: 'invalid' };
  if (user.authSource !== 'local') return { status: 'invalid' };
  if (!user.passwordHash) return { status: 'invalid' };

  const valid = await bcrypt.compare(passwordPlain, user.passwordHash);
  if (!valid) return { status: 'invalid' };

  return buildSuccessResult(user, 'local');
}
export async function getAuthUser(): Promise<AuthUser | null> {
  let authConfig;
  try {
    authConfig = getAuthConfig();
  } catch {
    throw new Error("Error en configuracion de autenticacion.");
  }

  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(COOKIE_NAME);
    if (!sessionCookie?.value) { return null; }

    const payload = verifyJwt(sessionCookie.value);
    if (!payload) { return null; }

    if (payload.authSource !== authConfig.mode) { return null; }
    if (payload.role === 'system') { return null; }

    const prisma = await getLegacyPrisma();
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { sectorScopes: true },
    });

    if (!user || !user.isActive || user.role === 'system') return null;

    // Validacion fresca
    if (user.username !== payload.username) return null;
    if (user.role !== payload.role) return null;
    if (user.authSource !== 'local') return null;

    const structuredScopes = user.sectorScopes.reduce<
      Array<{ sectorName: string; glpiGroupId: number }>
    >((acc, scope) => {
      const groupId = scope.glpiGroupId;

      if (
        typeof groupId === 'number' &&
        Number.isSafeInteger(groupId)
      ) {
        acc.push({
          sectorName: scope.sectorName,
          glpiGroupId: groupId,
        });
      }

      return acc;
    }, []);

    return {
      userId: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      authSource: payload.authSource,
      sectors: structuredScopes.map((s) => s.sectorName),
      sectorGroupIds: structuredScopes.map((s) => s.glpiGroupId),
      sectorScopes: structuredScopes,
    };
  } catch (outerErr) {
    console.log('[AUTH_DIAG] outer catch:', outerErr);
    return null;
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export function requireRole(user: AuthUser, allowedRoles: string[]): boolean {
  return allowedRoles.includes(user.role);
}

export function hasAccessToSector(user: AuthUser, glpiGroupId: number): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'coordinador_sistemas' || user.role === 'tecnico_sistemas') return true;
  return user.sectorGroupIds.includes(glpiGroupId);
}

export function normalizeSectorForComparison(sector: string): string {
  return sector
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function canAccessTicket(
  user: AuthUser,
  ticket: { isSistemasScope: boolean; detectedSector: string; detectedSectorGroupId?: number | null }
): boolean {
  if (user.role === 'admin') return true;

  if (!ticket.isSistemasScope) return false;

  if (user.role === 'coordinador_sistemas' || user.role === 'tecnico_sistemas') return true;

  if (ticket.detectedSectorGroupId != null && user.sectorGroupIds.length > 0) {
    return user.sectorGroupIds.includes(ticket.detectedSectorGroupId);
  }

  return false;
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) return false;

  if (now > entry.resetAt) {
    loginAttempts.delete(ip);
    return false;
  }

  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count++;
  }
}

export function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}
