import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, canAccessTicket } from '@/lib/auth';
import { parseAppActivityEvent } from '@/lib/app-activity-events';
import { writeAppActivity } from '@/lib/app-activity-audit';
import { getRequestAuditMeta } from '@/lib/request-audit-meta';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalTicketReadRepository } from '@/lib/db/operational/sqlserver-operational-ticket-read-repository';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'Contenido invalido.' }, { status: 415 });
  }
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > 1024) {
    return NextResponse.json({ error: 'Evento demasiado grande.' }, { status: 413 });
  }
  let raw: string;
  try { raw = await request.text(); }
  catch { return NextResponse.json({ error: 'Evento invalido.' }, { status: 400 }); }
  if (raw.length > 1024) return NextResponse.json({ error: 'Evento demasiado grande.' }, { status: 413 });
  let input: unknown;
  try { input = JSON.parse(raw); }
  catch { return NextResponse.json({ error: 'Evento invalido.' }, { status: 400 }); }
  const event = parseAppActivityEvent(input, user.role, user.username);
  if (!event) return NextResponse.json({ error: 'Evento no permitido.' }, { status: 400 });

  try {
    const meta = getRequestAuditMeta(request.headers);
    if (event.kind === 'page') {
      await writeAppActivity(user, 'app_page_view', 'app_navigation', event.path, { role: user.role, ...meta });
    } else {
      const ticket = await new SqlServerOperationalTicketReadRepository(getSharedSqlServerRuntime()).findTicketById(event.ticketId);
      if (!ticket || !canAccessTicket(user, ticket)) {
        return NextResponse.json({ error: 'Ticket fuera de alcance.' }, { status: 403 });
      }
      await writeAppActivity(user, 'glpi_ticket_open', 'ticket', String(event.ticketId), {
        role: user.role,
        source: 'prioglpi_link',
        ...meta,
      });
    }
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('App activity audit failed:', error);
    return NextResponse.json({ error: 'No se pudo registrar la actividad.' }, { status: 503 });
  }
}
