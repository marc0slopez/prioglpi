import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import {
  parseReorderMutation,
  isOperationalRankingMutationRole
} from '@/lib/db/operational/operational-ranking-mutation-types';
import {
  reorderOperationalRankings,
  OperationalRankingMutationError
} from '@/lib/db/operational/operational-ranking-mutation-service';
import { logError } from '@/lib/logger';

export function makeReorderHandlers(deps = {
  getAuthUser,
  getSharedSqlServerRuntime,
  reorderOperationalRankings,
  logError
}) {
  const POST = async (request: NextRequest) => {
    try {
      const user = await deps.getAuthUser();
      if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });

      if (!isOperationalRankingMutationRole(user.role)) {
        return NextResponse.json({ error: 'No tenes permisos para reordenar rankings.' }, { status: 403 });
      }

      const actor = {
        userId: user.userId,
        role: user.role,
        username: user.username,
        displayName: user.displayName
      };

      const body: unknown = await request.json().catch(() => null);

      const parseResult = parseReorderMutation(body);
      if (!parseResult.success) {
        return NextResponse.json({ error: parseResult.error }, { status: parseResult.httpStatus });
      }

      const rt = deps.getSharedSqlServerRuntime();
      const result = await deps.reorderOperationalRankings(rt, actor, parseResult.data);

      if (!result.changed) {
        return NextResponse.json({ message: result.message, changed: false });
      }

      const count = 'count' in result ? result.count : undefined;
      return NextResponse.json({ message: result.message, count, changed: true });
    } catch (error) {
      if (error instanceof OperationalRankingMutationError) {
        return NextResponse.json({ error: error.message }, { status: error.httpStatus });
      }
      deps.logError('[POST /api/rankings/reorder] Unhandled error', error);
      return NextResponse.json({ error: 'Error al reordenar rankings.' }, { status: 500 });
    }
  };
  return { POST };
}

const handlers = makeReorderHandlers();
export const POST = handlers.POST;
