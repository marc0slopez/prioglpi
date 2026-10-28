import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalTicketReadRepository } from '@/lib/db/operational/sqlserver-operational-ticket-read-repository';
import { SqlServerOperationalUserReadRepository } from '@/lib/db/operational/sqlserver-operational-user-read-repository';
import { buildOperationalUnrankedTicketResponse } from '@/lib/db/operational/operational-unranked-ticket-response';
import { getTicketGlpiSummaries, ownPrioGlpiFollowupPrefix } from '@/lib/ticket-glpi-summary';

async function withGlpiSummaries<T extends { tickets: readonly { ticketId: number }[] }>(
  response: T,
  runtime: ReturnType<typeof getSharedSqlServerRuntime>,
  canSeePrivate: boolean,
  ownPrivatePrefix: string
) {
  const summaries = await getTicketGlpiSummaries(runtime, response.tickets.map(ticket => ticket.ticketId), canSeePrivate, ownPrivatePrefix);
  return { ...response, tickets: response.tickets.map(ticket => ({ ...ticket, glpiSummary: summaries.get(ticket.ticketId) })) };
}


export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    if (!['admin', 'priorizador'].includes(user.role)) {
      return NextResponse.json({ error: 'Sin permisos.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const sectorGroupIdStr = searchParams.get('sectorGroupId');
    const ownerUserIdStr = searchParams.get('ownerUserId');

    let ownerUserId: number | null = null;
    if (user.role === 'priorizador') {
      ownerUserId = user.userId;
    } else if (ownerUserIdStr) {
      if (!/^[1-9]\d*$/.test(ownerUserIdStr)) {
        return NextResponse.json({ error: 'ownerUserId invalido.' }, { status: 400 });
      }
      ownerUserId = Number(ownerUserIdStr);
      if (!Number.isSafeInteger(ownerUserId) || ownerUserId > 2147483647) {
        return NextResponse.json({ error: 'ownerUserId invalido.' }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: 'ownerUserId es requerido para admin.' }, { status: 400 });
    }

    const pageStr = searchParams.get('page');
    const limitStr = searchParams.get('limit');
    let page = 1;
    let limit = 50;

    if (pageStr !== null) {
      if (!/^[1-9]\d*$/.test(pageStr)) {
        return NextResponse.json({ error: 'Page invalido.' }, { status: 400 });
      }
      page = Number(pageStr);
      if (!Number.isSafeInteger(page) || page < 1 || page > 2147483647) {
        return NextResponse.json({ error: 'Page invalido.' }, { status: 400 });
      }
    }

    if (limitStr !== null) {
      if (!/^[1-9]\d*$/.test(limitStr)) {
        return NextResponse.json({ error: 'Limit invalido.' }, { status: 400 });
      }
      limit = Number(limitStr);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        return NextResponse.json({ error: 'Limit invalido o excesivo.' }, { status: 400 });
      }
    }

    const runtime = getSharedSqlServerRuntime();
    const repo = new SqlServerOperationalTicketReadRepository(runtime);

    // Resolve target user for admin to ensure correctness
    let targetSectorGroupIds: readonly number[] = [];
    if (user.role === 'admin') {
      const userReadRepo = new SqlServerOperationalUserReadRepository(runtime);
      const targetUser = await userReadRepo.findByIdWithScopes(ownerUserId);
      if (!targetUser || targetUser.role !== 'priorizador' || !targetUser.isActive) {
        return NextResponse.json({ error: 'Usuario objetivo invalido o inactivo.' }, { status: 400 });
      }
      const scopesIds = targetUser.sectorScopes.map(s => s.glpiGroupId).filter(id => typeof id === 'number');
      targetSectorGroupIds = Array.from(new Set(scopesIds));
    } else {
      targetSectorGroupIds = user.sectorGroupIds;
    }

    if (!sectorGroupIdStr || sectorGroupIdStr === 'todos') {
      if (targetSectorGroupIds.length === 0) {
        return NextResponse.json({ error: 'El priorizador no tiene sectores asignados.' }, { status: 403 });
      }

      const fetchLimit = Math.min(200, page * limit);
      const pages = await Promise.all(
        targetSectorGroupIds.map((glpiGroupId) =>
          repo.listUnrankedTicketsPage({ glpiGroupId, ownerUserId, page: 1, limit: fetchLimit })
        )
      );

      const offset = (page - 1) * limit;
      const items = pages
        .flatMap((p) => [...p.items])
        .sort((a, b) => {
          const aDate = String(a.ticket.openedAt ?? '');
          const bDate = String(b.ticket.openedAt ?? '');
          if (aDate !== bDate) return bDate.localeCompare(aDate);
          return a.ticket.ticketId - b.ticket.ticketId;
        })
        .slice(offset, offset + limit);

      const total = pages.reduce((sum, p) => sum + p.total, 0);

      const response = buildOperationalUnrankedTicketResponse({
        items,
        total,
        page,
        limit
      });
      return NextResponse.json(await withGlpiSummaries(response, runtime, user.role === 'admin',
        user.role === 'priorizador' ? ownPrioGlpiFollowupPrefix(user.username) : ''));
    }

    if (!/^[1-9]\d*$/.test(sectorGroupIdStr)) {
      return NextResponse.json({ error: 'sectorGroupId invalido.' }, { status: 400 });
    }

    const glpiGroupId = Number(sectorGroupIdStr);
    if (!Number.isSafeInteger(glpiGroupId) || glpiGroupId < 1 || glpiGroupId > 2147483647) {
      return NextResponse.json({ error: 'sectorGroupId invalido.' }, { status: 400 });
    }

    if (!targetSectorGroupIds.includes(glpiGroupId)) {
      return NextResponse.json({ error: 'Sin acceso a ese sector.' }, { status: 403 });
    }

    const pageData = await repo.listUnrankedTicketsPage({ glpiGroupId, ownerUserId, page, limit });

    const response = buildOperationalUnrankedTicketResponse(pageData);
    return NextResponse.json(await withGlpiSummaries(response, runtime, user.role === 'admin',
      user.role === 'priorizador' ? ownPrioGlpiFollowupPrefix(user.username) : ''));
  } catch (error) {
    console.error('[GET /api/tickets/unranked] Unhandled error:', error);
    return NextResponse.json(
      { error: 'Error al obtener tickets sin ranking.' },
      { status: 500 }
    );
  }
}
