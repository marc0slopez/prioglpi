import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import type { OperationalTicketListActor } from '@/lib/db/operational/operational-ticket-list-types';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { parseOperationalTicketListQuery } from '@/lib/db/operational/operational-ticket-list-query';
import { SqlServerOperationalTicketListContextRepository } from '@/lib/db/operational/sqlserver-operational-ticket-list-context-repository';
import { SqlServerOperationalTicketListFilterRepository } from '@/lib/db/operational/sqlserver-operational-ticket-list-filter-repository';
import { SqlServerOperationalUserReadRepository } from '@/lib/db/operational/sqlserver-operational-user-read-repository';
import { buildOperationalTicketListPlan } from '@/lib/db/operational/operational-ticket-list-planner';
import { executeOperationalTicketList } from '@/lib/db/operational/operational-ticket-list-executor';
import { getTicketGlpiSummaries, ownPrioGlpiFollowupPrefix } from '@/lib/ticket-glpi-summary';
import { writeAppActivity } from '@/lib/app-activity-audit';

function isOperationalTicketListRole(
  role: string
): role is OperationalTicketListActor['role'] {
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

    if (!isOperationalTicketListRole(user.role)) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);

    let actorRole = user.role;
    let actorSectorGroupIds = user.sectorGroupIds;

    const runtime = getSharedSqlServerRuntime();

    const ownerUserIdStr = searchParams.get('ownerUserId');
    if (user.role === 'admin' && ownerUserIdStr) {
      if (!/^[1-9]\d*$/.test(ownerUserIdStr)) {
        return NextResponse.json({ error: 'ownerUserId invalido.' }, { status: 400 });
      }
      const ownerUserId = Number(ownerUserIdStr);
      if (!Number.isSafeInteger(ownerUserId) || ownerUserId > 2147483647) {
        return NextResponse.json({ error: 'ownerUserId invalido.' }, { status: 400 });
      }

      const userReadRepo = new SqlServerOperationalUserReadRepository(runtime);
      const targetUser = await userReadRepo.findByIdWithScopes(ownerUserId);
      if (!targetUser || targetUser.role !== 'priorizador' || !targetUser.isActive) {
        return NextResponse.json({ error: 'Usuario objetivo invalido o inactivo.' }, { status: 400 });
      }

      const scopesIds = targetUser.sectorScopes.map(s => s.glpiGroupId).filter(id => typeof id === 'number');
      actorSectorGroupIds = Array.from(new Set(scopesIds));
      actorRole = 'priorizador';
    }

    const actor: OperationalTicketListActor = {
      role: actorRole,
      sectorGroupIds: actorSectorGroupIds
    };

    const parsed = parseOperationalTicketListQuery(searchParams, actor);

    if (parsed.status === 'error') {
      return NextResponse.json(
        { error: parsed.error },
        { status: parsed.httpStatus }
      );
    }

    const todayArgentina = new Date().toLocaleDateString('sv-SE', {
      timeZone: 'America/Argentina/Buenos_Aires'
    });


    const contextRepository = new SqlServerOperationalTicketListContextRepository(runtime);
    const filterRepository = new SqlServerOperationalTicketListFilterRepository(runtime);

    const planned = await buildOperationalTicketListPlan(
      parsed.query,
      contextRepository,
      filterRepository
    );

    if (planned.status === 'error') {
      return NextResponse.json(
        { error: planned.error },
        { status: planned.httpStatus }
      );
    }

    const response = await executeOperationalTicketList(
      runtime,
      planned.plan,
      todayArgentina
    );

    const summaries = await getTicketGlpiSummaries(
      runtime,
      response.tickets.map(ticket => ticket.ticketId),
      parsed.query.canSeePrivate,
      user.role === 'priorizador' ? ownPrioGlpiFollowupPrefix(user.username) : ''
    );
    const query = parsed.query;
    await writeAppActivity(user, 'ticket_list_view', 'ticket', query.ticketId === null ? 'list' : String(query.ticketId), {
      role: user.role,
      resultCount: response.tickets.length,
      total: response.total,
      filters: {
        view: query.view,
        priority: query.priority,
        page: query.page,
        status: query.status,
        sector: query.sector,
        sectorGroupId: query.sectorGroupId,
        technicianId: query.technicianId,
        requesterId: query.requesterId,
        referentUserId: query.referentUserId,
        categoryId: query.categoryId,
        type: query.type,
        glpiPriority: query.glpiPriority,
        from: query.from,
        to: query.to,
        hasSearch: Boolean(query.search || query.title || query.description),
        hasNotesFilter: Boolean(query.notes),
        hasCommentsFilter: Boolean(query.comments),
      },
    });
    return NextResponse.json({
      ...response,
      tickets: response.tickets.map(ticket => ({ ...ticket, glpiSummary: summaries.get(ticket.ticketId) })),
    });
  } catch (error) {
    console.error('[/api/tickets] Uncaught exception:', error);
    return NextResponse.json(
      { error: 'Error al obtener tickets.' },
      { status: 500 }
    );
  }
}
