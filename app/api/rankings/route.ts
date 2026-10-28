import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalRankingReadRepository } from '@/lib/db/operational/sqlserver-operational-ranking-read-repository';
import { SqlServerOperationalUserReadRepository } from '@/lib/db/operational/sqlserver-operational-user-read-repository';
import { parseOperationalRankingListQuery, type OperationalRankingListRole } from '@/lib/db/operational/operational-ranking-list-query';
import { buildOperationalRankingListResponse } from '@/lib/db/operational/operational-ranking-list-response';
import { getTicketGlpiSummaries, ownPrioGlpiFollowupPrefix } from '@/lib/ticket-glpi-summary';

function isOperationalRankingListRole(
  role: string
): role is OperationalRankingListRole {
  return (
    role === 'admin' ||
    role === 'coordinador_sistemas' ||
    role === 'tecnico_sistemas' ||
    role === 'priorizador' ||
    role === 'referente'
  );
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    if (!isOperationalRankingListRole(user.role)) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    }

    const actor = {
      role: user.role,
      sectorGroupIds: user.sectorGroupIds,
      userId: user.userId
    };

    const parsed = parseOperationalRankingListQuery(request.nextUrl.searchParams, actor);
    if (parsed.status === 'error') {
      return NextResponse.json({ error: parsed.error }, { status: parsed.httpStatus });
    }

    const runtime = getSharedSqlServerRuntime();

    if (parsed.ownerUserId !== null && parsed.ownerUserId !== user.userId) {
      if (user.role !== 'admin') {
        return NextResponse.json({ error: 'No autorizado para ver bandeja de otro usuario.' }, { status: 403 });
      }
      const userReadRepo = new SqlServerOperationalUserReadRepository(runtime);
      const targetUser = await userReadRepo.findById(parsed.ownerUserId);
      if (!targetUser || targetUser.role !== 'priorizador' || !targetUser.isActive) {
        return NextResponse.json({ error: 'Usuario objetivo inválido o inactivo.' }, { status: 400 });
      }
    }

    const ownerUserId = parsed.ownerUserId ?? (user.role === 'priorizador' ? user.userId : null);
    if (ownerUserId === null) {
      return NextResponse.json({ error: 'Seleccione un priorizador.' }, { status: 400 });
    }

    const repository = new SqlServerOperationalRankingReadRepository(runtime);

    const rankings = await repository.listActiveRankings(ownerUserId);

    const response = buildOperationalRankingListResponse(rankings);

    const summaries = await getTicketGlpiSummaries(
      runtime,
      response.rankings.map(ranking => ranking.ticketId),
      user.role === 'admin' || user.role === 'coordinador_sistemas' || user.role === 'tecnico_sistemas',
      user.role === 'priorizador' ? ownPrioGlpiFollowupPrefix(user.username) : ''
    );
    return NextResponse.json({
      rankings: response.rankings.map(ranking => ({
        ...ranking,
        ticket: { ...ranking.ticket, glpiSummary: summaries.get(ranking.ticketId) },
      })),
    });
  } catch (error) {
    console.error('[GET /api/rankings] Unhandled error:', error);
    return NextResponse.json({ error: 'Error al obtener rankings.' }, { status: 500 });
  }
}
