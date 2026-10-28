import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, canAccessTicket } from '@/lib/auth';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalTicketReadRepository } from '@/lib/db/operational/sqlserver-operational-ticket-read-repository';
import { SqlServerOperationalCoordinationWriteRepository } from '@/lib/db/operational/sqlserver-operational-coordination-write-repository';
import { OperationalCoordinationMutationService } from '@/lib/db/operational/operational-coordination-mutation-service';
import {
  parseCoordinationTicketId,
  OperationalCoordinationMutationError
} from '@/lib/db/operational/operational-coordination-mutation-types';
import { GlpiWriteError } from '@/lib/glpi/glpi-write-client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  void request;
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    const { ticketId: ticketIdStr } = await params;
    let ticketId: number;
    try {
      ticketId = parseCoordinationTicketId(ticketIdStr);
    } catch {
      return NextResponse.json({ error: 'ID invalido.' }, { status: 400 });
    }

    const runtime = getSharedSqlServerRuntime();
    const readRepo = new SqlServerOperationalTicketReadRepository(runtime);
    const coordRepo = new SqlServerOperationalCoordinationWriteRepository(runtime);

    const ticket = await readRepo.findTicketById(ticketId);
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket no encontrado.' }, { status: 404 });
    }

    if (!canAccessTicket(user, ticket)) {
      return NextResponse.json({ error: 'Sin acceso a este ticket.' }, { status: 403 });
    }

    const coordination = await coordRepo.findByTicketId(ticketId);

    return NextResponse.json({
      coordination: coordination
        ? {
            ticketId: coordination.ticketId,
            progressPercent: coordination.progressPercent,
            coordinatorComment: coordination.coordinatorComment,
            estimatedDeliveryDate: coordination.estimatedDeliveryDate,
            updatedBy: coordination.updatedByDisplayName,
            updatedAt: coordination.updatedAt.toISOString(),
          }
        : null,
    });
  } catch {
    return NextResponse.json(
      { error: 'Error al obtener coordinacion.' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    if (user.role !== 'admin' && user.role !== 'coordinador_sistemas') {
      return NextResponse.json(
        { error: 'No tenes permisos para editar coordinacion.' },
        { status: 403 }
      );
    }

    const { ticketId: ticketIdStr } = await params;
    let ticketId: number;
    try {
      ticketId = parseCoordinationTicketId(ticketIdStr);
    } catch {
      return NextResponse.json({ error: 'ID invalido.' }, { status: 400 });
    }

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body no es JSON valido.' }, { status: 400 });
    }

    const runtime = getSharedSqlServerRuntime();
    const service = new OperationalCoordinationMutationService(runtime);

    const result = await service.updateCoordination(
      ticketId,
      input,
      user.userId,
      user.username,
      user.displayName,
      user.role
    );

    // Si hay advertencia de followup (TPR/avance OK, seguimiento sin permisos) o de avance (no verificado):
    // responder 207 Multi-Status con el warning incluido.
    if (result.followupWarning || result.progressWarning) {
      let msg = 'Coordinacion actualizada. ';
      if (result.followupWarning && result.progressWarning) msg += `El avance no se pudo confirmar y GLPI rechazó el seguimiento: ${result.followupWarning}`;
      else if (result.followupWarning) msg += `GLPI rechazó el seguimiento: ${result.followupWarning}`;
      else if (result.progressWarning) msg += '⚠️ El avance no se reflejó en GLPI (campo incorrecto o ignorado).';

      return NextResponse.json({
        message: msg,
        followupWarning: result.followupWarning,
        progressWarning: result.progressWarning,
        coordination: {
          ticketId: result.coordination.ticketId,
          progressPercent: result.coordination.progressPercent,
          coordinatorComment: result.coordination.coordinatorComment,
          estimatedDeliveryDate: result.coordination.estimatedDeliveryDate,
        },
      }, { status: 207 });
    }

    return NextResponse.json({
      message: 'Coordinacion actualizada.',
      coordination: {
        ticketId: result.coordination.ticketId,
        progressPercent: result.coordination.progressPercent,
        coordinatorComment: result.coordination.coordinatorComment,
        estimatedDeliveryDate: result.coordination.estimatedDeliveryDate,
      },
    });
  } catch (error) {
    if (error instanceof GlpiWriteError) {
      return NextResponse.json(
        { error: 'No se pudo actualizar el ticket en GLPI. No se guardaron los cambios.' },
        { status: 502 }
      );
    }
    if (error instanceof OperationalCoordinationMutationError) {
      if (error.code === 'invalid_input') {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === 'ticket_not_found') {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error.code === 'forbidden') {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.code === 'invalid_state') {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json(
      { error: 'Error al actualizar coordinacion.' },
      { status: 500 }
    );
  }
}
