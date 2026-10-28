import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, canAccessTicket } from '@/lib/auth';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalTicketReadRepository } from '@/lib/db/operational/sqlserver-operational-ticket-read-repository';
import { buildOperationalTicketDetail } from '@/lib/db/operational/operational-ticket-detail';
import { writeAppActivity } from '@/lib/app-activity-audit';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  void request;
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    const { id } = await params;

    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'ID de ticket invalido.' }, { status: 400 });
    }

    const ticketId = Number(id);
    if (!Number.isSafeInteger(ticketId) || ticketId < 1 || ticketId > 2147483647) {
      return NextResponse.json({ error: 'ID de ticket invalido.' }, { status: 400 });
    }

    const repo = new SqlServerOperationalTicketReadRepository(getSharedSqlServerRuntime());
    const ticket = await repo.findTicketById(ticketId);

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket no encontrado.' }, { status: 404 });
    }

    if (!canAccessTicket(user, ticket)) {
      return NextResponse.json({ error: 'Ticket fuera de alcance.' }, { status: 403 });
    }

    // Buscar rankings, coordinacion, followups y tasks
    const [rankings, coordination, followups, tasks] = await Promise.all([
      repo.listActiveRankingsByTicketId(ticketId),
      repo.findCoordinationByTicketId(ticketId),
      repo.listFollowupsByTicketId(ticketId),
      repo.listTasksByTicketId(ticketId)
    ]);

    const canSeePrivate = user.role === 'admin' || user.role === 'coordinador_sistemas' || user.role === 'tecnico_sistemas';

    const responseData = buildOperationalTicketDetail(
      ticket,
      rankings,
      coordination,
      followups,
      tasks,
      canSeePrivate
    );

    await writeAppActivity(user, 'ticket_detail_view', 'ticket', String(ticketId), { role: user.role });

    return NextResponse.json(responseData);
  } catch (error) {
    void error;
    return NextResponse.json(
      { error: 'Error al obtener ticket.' },
      { status: 500 }
    );
  }
}
