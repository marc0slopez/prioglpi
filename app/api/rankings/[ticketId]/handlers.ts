import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import {
  parsePatchMutation,
  parseDeleteMutation,
  isOperationalRankingMutationRole
} from '@/lib/db/operational/operational-ranking-mutation-types';
import {
  patchOperationalRanking,
  deleteOperationalRanking,
  OperationalRankingMutationError
} from '@/lib/db/operational/operational-ranking-mutation-service';
import { logError } from '@/lib/logger';

export function makeTicketIdHandlers(deps = {
  getAuthUser,
  getSharedSqlServerRuntime,
  patchOperationalRanking,
  deleteOperationalRanking,
  logError
}) {
  const PATCH = async (
    request: NextRequest,
    { params }: { params: Promise<{ ticketId: string }> }
  ) => {
    try {
      const user = await deps.getAuthUser();
    if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });

    if (!isOperationalRankingMutationRole(user.role)) {
      return NextResponse.json({ error: 'No tenes permisos para editar rankings.' }, { status: 403 });
    }

    const actor = {
      userId: user.userId,
      role: user.role,
      username: user.username,
      displayName: user.displayName
    };

    const { ticketId: ticketIdStr } = await params;
    const body: unknown = await request.json().catch(() => null);

    const parseResult = parsePatchMutation(ticketIdStr, body);
    if (!parseResult.success) {
      return NextResponse.json({ error: parseResult.error }, { status: parseResult.httpStatus });
    }

    const rt = deps.getSharedSqlServerRuntime();
    const result = await deps.patchOperationalRanking(rt, actor, parseResult.data);

    if (!result.changed) {
      return NextResponse.json({ message: result.message, changed: false });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OperationalRankingMutationError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    const errorCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? 'none')
        : 'none';
    const errorDetail = error instanceof Error ? error.message : 'unknown_error';
    deps.logError(`[PATCH /api/rankings] Unhandled error (code=${errorCode}, detail=${errorDetail})`, error);
    return NextResponse.json({ error: 'Error al cambiar posicion.' }, { status: 500 });
  }
}

  const DELETE = async (
    request: NextRequest,
    { params }: { params: Promise<{ ticketId: string }> }
  ) => {
    try {
      const user = await deps.getAuthUser();
    if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });

    if (!isOperationalRankingMutationRole(user.role)) {
      return NextResponse.json({ error: 'No tenes permisos.' }, { status: 403 });
    }

    const actor = {
      userId: user.userId,
      role: user.role,
      username: user.username,
      displayName: user.displayName
    };

    const { ticketId: ticketIdStr } = await params;
    const parseResult = parseDeleteMutation(ticketIdStr, request.nextUrl.searchParams);
    if (!parseResult.success) {
      return NextResponse.json({ error: parseResult.error }, { status: parseResult.httpStatus });
    }

    const rt = deps.getSharedSqlServerRuntime();
    const result = await deps.deleteOperationalRanking(rt, actor, parseResult.data);

    if (!result.changed) {
      return NextResponse.json({ changed: false });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof OperationalRankingMutationError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    deps.logError('[DELETE /api/rankings] Unhandled error', err);
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 });
  }
  };

  return { PATCH, DELETE };
}

const handlers = makeTicketIdHandlers();
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
