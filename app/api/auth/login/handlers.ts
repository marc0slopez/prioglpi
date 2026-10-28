import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateUser,
  setSessionCookie,
  isRateLimited,
  recordFailedLogin,
  clearLoginAttempts
} from '@/lib/auth';
import type { AuthenticationResult } from '@/lib/auth';
import { getAuthConfig } from '@/lib/config/auth-config';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalAuditWriteRepository } from '@/lib/db/operational/sqlserver-operational-audit-write-repository';
import type { OperationalAuditWriteInput } from '@/lib/db/operational/operational-audit-write-repository';

class PayloadTooLargeError extends Error {
  readonly status = 413;
  constructor() {
    super('Payload Too Large');
  }
}

async function readBodyUnderLimit(request: NextRequest, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new PayloadTooLargeError();
  }

  if (!request.body) {
    return '';
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new PayloadTooLargeError();
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder('utf-8').decode(combined);
}

async function writeOperationalLoginAudit(input: OperationalAuditWriteInput): Promise<void> {
  const runtime = getSharedSqlServerRuntime();
  await runtime.withTransaction({ isolation: 'serializable' }, async (tx) => {
    const auditRepo = new SqlServerOperationalAuditWriteRepository(tx);
    await auditRepo.writeAudit(input);
  });
}

async function safeLogAudit(input: OperationalAuditWriteInput): Promise<void> {
  try {
    await writeOperationalLoginAudit(input);
  } catch {
    // Absorber fallos sin imprimir errores/stack
  }
}

export function mapAuthResultToHttpResponse(result: AuthenticationResult) {
  if (result.status === 'unavailable') {
    return NextResponse.json(
      { error: 'Servicio de autenticacion temporalmente no disponible.' },
      { status: 503 }
    );
  }

  if (result.status === 'invalid') {
    return NextResponse.json(
      { error: 'Credenciales incorrectas.' },
      { status: 401 }
    );
  }

  return NextResponse.json({
    user: {
      userId: result.user.userId,
      username: result.user.username,
      displayName: result.user.displayName,
      role: result.user.role,
      sectors: result.user.sectors,
    },
  });
}

export async function POST(request: NextRequest) {
  const config = getAuthConfig();
  let ip = 'unknown';

  if (config.trustProxy) {
    ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  } else {
    ip = 'direct-client';
  }

  if (isRateLimited(ip)) {
    await safeLogAudit({
      userId: null,
      action: 'login_failure',
      entityType: 'authentication',
      entityId: 'anónimo',
      actorName: null,
      actorUsername: 'anónimo',
      after: { reason: 'ip_rate_limited', result: 'blocked', ip }
    });
    return NextResponse.json(
      { error: 'Demasiados intentos. Espera 1 minuto.' },
      { status: 429 }
    );
  }

  let rawBodyStr: string;
  try {
    rawBodyStr = await readBodyUnderLimit(request, 10240);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      await safeLogAudit({
        userId: null,
        action: 'login_failure',
        entityType: 'authentication',
        entityId: 'anónimo',
        actorName: null,
        actorUsername: 'anónimo',
        after: { reason: 'payload_too_large', result: 'rejected', ip }
      });
      return NextResponse.json(
        { error: 'El cuerpo de la petición excede el límite permitido de 10 KB.' },
        { status: 413 }
      );
    }
    return NextResponse.json(
      { error: 'Error al leer la petición.' },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBodyStr);
  } catch {
    recordFailedLogin(ip);
    await safeLogAudit({
      userId: null,
      action: 'login_failure',
      entityType: 'authentication',
      entityId: 'anónimo',
      actorName: null,
      actorUsername: 'anónimo',
      after: { reason: 'invalid_json', result: 'rejected', ip }
    });
    return NextResponse.json(
      { error: 'Formato JSON inválido.' },
      { status: 400 }
    );
  }

  const bodyObj = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const { username, password } = bodyObj;

  const isValidUsername = typeof username === 'string' && username.length > 0 && username.length <= 100 && /^[a-zA-Z0-9._\-@]+$/.test(username);
  const isValidPassword = typeof password === 'string' && password.length > 0 && password.length <= 200;

  if (!isValidUsername || !isValidPassword) {
    recordFailedLogin(ip);
    const validActorUser = isValidUsername ? (username as string).trim() : 'anónimo';
    await safeLogAudit({
      userId: null,
      action: 'login_failure',
      entityType: 'authentication',
      entityId: validActorUser,
      actorName: null,
      actorUsername: validActorUser,
      after: { reason: 'invalid_request_format', result: 'rejected', ip }
    });
    return NextResponse.json(
      { error: 'Usuario y contrasena son requeridos y deben tener un formato valido.' },
      { status: 400 }
    );
  }

  try {
    const validUsernameStr = (username as string).trim();
    const result = await authenticateUser(validUsernameStr, password as string);

    if (result.status === 'invalid') {
      recordFailedLogin(ip);
      await safeLogAudit({
        userId: null,
        action: 'login_failure',
        entityType: 'authentication',
        entityId: validUsernameStr,
        actorName: null,
        actorUsername: validUsernameStr,
        after: { reason: 'invalid_credentials', result: 'failed', ip }
      });
    } else if (result.status === 'success') {
      clearLoginAttempts(ip);
      try {
        await writeOperationalLoginAudit({
          userId: result.user.userId,
          action: 'login_success',
          entityType: 'authentication',
          entityId: String(result.user.userId),
          actorName: result.user.displayName,
          actorUsername: result.user.username,
          after: { authSource: result.user.authSource || 'local', ip }
        });
      } catch {
        return NextResponse.json(
          { error: 'Error interno del servidor al registrar auditoría.' },
          { status: 500 }
        );
      }
      await setSessionCookie(result.token);
    } else if (result.status === 'unavailable') {
      await safeLogAudit({
        userId: null,
        action: 'auth_unavailable',
        entityType: 'authentication',
        entityId: validUsernameStr,
        actorName: null,
        actorUsername: validUsernameStr,
        after: { reason: 'directory_unavailable', result: 'error', ip }
      });
    }

    return mapAuthResultToHttpResponse(result);
  } catch (error) {
    console.error('Login internal operational error (config or DB fallback):', error);
    return NextResponse.json(
      { error: 'Error interno del servidor.' },
      { status: 500 }
    );
  }
}
