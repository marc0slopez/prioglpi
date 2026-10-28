import * as jwt from 'jsonwebtoken';

function requireJwtSecret(): string {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      'Configuración inválida: JWT_SECRET no está definido o tiene menos de 32 caracteres.'
    );
  }
  return value;
}

const JWT_SECRET: jwt.Secret = requireJwtSecret();

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
  displayName: string;
  authSource: 'local' | 'ad';
}

function isJwtPayload(value: unknown): value is JwtPayload {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.userId === 'number' &&
    Number.isSafeInteger(candidate.userId) &&
    typeof candidate.username === 'string' &&
    candidate.username.length > 0 &&
    typeof candidate.role === 'string' &&
    candidate.role.length > 0 &&
    typeof candidate.displayName === 'string' &&
    (candidate.authSource === 'local' || candidate.authSource === 'ad')
  );
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    const decoded: string | jwt.JwtPayload = jwt.verify(token, JWT_SECRET);

    if (!isJwtPayload(decoded)) {
      return null;
    }

    return {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      displayName: decoded.displayName,
      authSource: decoded.authSource,
    };
  } catch {
    return null;
  }
}
