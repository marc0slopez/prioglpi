import { NextRequest, NextResponse } from 'next/server';
import { canAccessTicket, getAuthUser } from '@/lib/auth';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalTicketReadRepository } from '@/lib/db/operational/sqlserver-operational-ticket-read-repository';
import { SqlServerOperationalUserReadRepository } from '@/lib/db/operational/sqlserver-operational-user-read-repository';
import { parseCoordinationTicketId } from '@/lib/db/operational/operational-coordination-mutation-types';
import {
  GlpiFollowupPermissionError,
  GlpiWriteClient,
  GlpiWriteError,
} from '@/lib/glpi/glpi-write-client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
  if (user.role !== 'coordinador_sistemas' && user.role !== 'priorizador') {
    return NextResponse.json({ error: 'No tenés permiso para agregar comentarios.' }, { status: 403 });
  }
  if (process.env.GLPI_FOLLOWUP_WRITE_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Los comentarios en GLPI no están habilitados.' }, { status: 503 });
  }

  let ticketId: number;
  try {
    ticketId = parseCoordinationTicketId((await params).id);
  } catch {
    return NextResponse.json({ error: 'ID de ticket inválido.' }, { status: 400 });
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 8192) {
    return NextResponse.json({ error: 'El comentario es demasiado largo.' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'El comentario no tiene un formato válido.' }, { status: 400 });
  }
  const content = typeof body === 'object' && body !== null && 'content' in body
    ? (body as { content: unknown }).content : null;
  if (typeof content !== 'string' || !content.trim() || content.trim().length > 2000) {
    return NextResponse.json({ error: 'Ingresá un comentario de hasta 2000 caracteres.' }, { status: 400 });
  }

  try {
    const runtime = getSharedSqlServerRuntime();
    const ticket = await new SqlServerOperationalTicketReadRepository(runtime).findTicketById(ticketId);
    if (!ticket) return NextResponse.json({ error: 'Ticket no encontrado.' }, { status: 404 });
    if (!canAccessTicket(user, ticket)) {
      return NextResponse.json({ error: 'Sin acceso a este ticket.' }, { status: 403 });
    }
    if (![1, 2, 3, 4].includes(ticket.status)) {
      return NextResponse.json({ error: 'Solo se pueden comentar tickets abiertos.' }, { status: 409 });
    }

    const operationalUser = await new SqlServerOperationalUserReadRepository(runtime).findById(user.userId);
    if (
      !operationalUser?.isActive ||
      operationalUser.username !== user.username ||
      operationalUser.role !== user.role
    ) {
      return NextResponse.json({ error: 'Tu usuario no tiene una identidad GLPI valida para firmar el comentario.' }, { status: 409 });
    }
    const matches = await runtime.query(`
      SELECT TOP (2) [glpi_user_id], [username]
      FROM [prioglpi].[glpi_user_cache]
      WHERE LOWER([username]) = LOWER(@username) AND [is_active] = 1
    `, [{ name: 'username', type: 'nvarchar', length: 255, nullable: false, value: user.username }]);
    const cached = matches[0];
    const cachedUsername = cached?.username;
    const glpiUserId = cached?.glpi_user_id;
    if (matches.length !== 1 || typeof cachedUsername !== 'string' ||
        cachedUsername.toLowerCase() !== user.username.toLowerCase() ||
        typeof glpiUserId !== 'number' || !Number.isSafeInteger(glpiUserId) || glpiUserId < 1 ||
        (operationalUser.glpiUserId !== null && operationalUser.glpiUserId !== glpiUserId)) {
      return NextResponse.json({ error: 'No pudimos verificar tu usuario en GLPI. Avisá a Sistemas.' }, { status: 409 });
    }

    const note = content.trim();
    const client = GlpiWriteClient.fromFollowupEnv();
    try {
      await client.initSession();
      const liveLogin = await client.getUserLogin(glpiUserId);
      if (liveLogin.toLowerCase() !== user.username.toLowerCase()) {
        return NextResponse.json({ error: 'La identidad de GLPI no coincide con tu usuario.' }, { status: 409 });
      }
      await client.createFollowup(ticketId, note, false, glpiUserId);
    } finally {
      await client.killSession();
    }

    return NextResponse.json({
      followup: { author: user.displayName, content: note, createdAt: new Date().toISOString() },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof GlpiFollowupPermissionError || error instanceof GlpiWriteError) {
      return NextResponse.json({ error: 'No pudimos confirmar el comentario. Revisá el ticket en GLPI antes de reintentar.' }, { status: 502 });
    }
    console.error('[POST ticket followup] Failed:', error);
    return NextResponse.json({ error: 'No se pudo agregar el comentario.' }, { status: 500 });
  }
}
