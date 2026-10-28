import type { ISqlServerRuntime } from '../sqlserver-runtime-contract';
import { SqlServerOperationalTicketReadRepository } from './sqlserver-operational-ticket-read-repository';
import { SqlServerOperationalCoordinationWriteRepository } from './sqlserver-operational-coordination-write-repository';
import { SqlServerOperationalAuditWriteRepository } from './sqlserver-operational-audit-write-repository';
import {
  parseCoordinationPatchInput,
  parseCoordinationTicketId,
  OperationalCoordinationMutationError,
  type OperationalCoordinationMutationResult
} from './operational-coordination-mutation-types';
import {
  GlpiWriteClient,
  GlpiWriteError,
  GlpiFollowupPermissionError,
  GlpiProgressWarningError,
  isGlpiWriteEnabled,
} from '@/lib/glpi/glpi-write-client';

export class OperationalCoordinationMutationService {
  constructor(private readonly runtime: ISqlServerRuntime) {}

  public async updateCoordination(
    ticketIdInput: unknown,
    input: unknown,
    userId: number,
    username: string,
    displayName: string,
    userRole: string
  ): Promise<OperationalCoordinationMutationResult> {
    if (userRole !== 'admin' && userRole !== 'coordinador_sistemas') {
      throw new OperationalCoordinationMutationError('forbidden', 'No tenes permisos para editar coordinacion.');
    }

    const ticketId = parseCoordinationTicketId(ticketIdInput);
    const patch = parseCoordinationPatchInput(input);
    const clock = new Date();

    // ─── 1. Leer coordinación previa (fuera de transacción) para anti-duplicado de followup ───
    // ISqlServerRuntime extends ISqlServerSession — se puede usar directamente como sesión de lectura.
    const preCoordRepo = new SqlServerOperationalCoordinationWriteRepository(this.runtime);
    const previousCoordination = await preCoordRepo.findByTicketId(ticketId);

    // Validar que la fecha TPR no sea pasada (solo si está cambiando)
    if (patch.estimatedDeliveryDate != null && patch.estimatedDeliveryDate !== '') {
      if (patch.estimatedDeliveryDate !== previousCoordination?.estimatedDeliveryDate) {
        // Asume formato YYYY-MM-DD
        const [year, month, day] = patch.estimatedDeliveryDate.split('-').map(Number);
        const tprDate = new Date(year, month - 1, day);
        const today = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate());
        if (tprDate < today) {
          throw new OperationalCoordinationMutationError('invalid_input', 'La fecha estimada de resolución (TPR) no puede ser pasada.');
        }
      }
    }

    // ─── 2. Escritura GLPI (solo coordinador_sistemas, solo si GLPI_WRITE_ENABLED=true) ───────
    //
    // Separación de errores:
    //   - GlpiWriteError (TPR, avance, sesión) → bloqueante → no guarda local → 502
    //   - GlpiFollowupPermissionError (followup permisos) → advertencia → se guarda local → 207
    //
    // Admin NO dispara escritura GLPI por diseño.
    let followupWarning: string | null = null;
    let progressWarning: string | null = null;

    if (userRole === 'coordinador_sistemas' && isGlpiWriteEnabled()) {
      const client = GlpiWriteClient.fromEnv();
      try {
        await client.initSession();

        // A) TPR — solo si viene en el patch y no es nulo/vacío
        if (patch.estimatedDeliveryDate != null && patch.estimatedDeliveryDate !== '') {
          await client.updateTicketTpr(ticketId, patch.estimatedDeliveryDate);
        }

        // B) Avance — solo si viene en el patch
        if (patch.progressPercent !== undefined) {
          try {
            await client.updateTicketProgress(ticketId, patch.progressPercent);
          } catch (progressErr) {
            if (progressErr instanceof GlpiProgressWarningError) {
              progressWarning = progressErr.safeDetail;
            } else {
              throw progressErr;
            }
          }
        }

        // C) Observación — si el frontend la envía explícitamente, se intenta crear seguimiento.
        // Importante: no comparamos contra el comentario local anterior, porque si una primera
        // escritura guardó localmente pero falló en GLPI, el usuario necesita poder reintentar
        // el mismo texto sin que el backend lo ignore como "sin cambios".
        if (patch.coordinatorComment !== undefined) {
          const newComment = patch.coordinatorComment.trim();
          const hasContent = newComment.length > 0;

          if (hasContent) {
            // Default: interno (is_private=1). Frontend puede enviar commentIsPrivate=false.
            const isPrivate = patch.commentIsPrivate !== false;
            try {
              await client.createFollowup(ticketId, newComment, isPrivate);
            } catch (followupErr) {
              if (followupErr instanceof GlpiFollowupPermissionError) {
                // No bloquear — TPR y avance ya se enviaron correctamente.
                // Guardamos la advertencia para incluirla en la respuesta.
                followupWarning = followupErr.safeDetail;
              } else {
                // Otro error inesperado en followup — también lo tratamos como advertencia
                followupWarning = 'No se pudo crear el seguimiento en GLPI';
              }
            }
          }
        }
      } catch (err) {
        // Errores bloqueantes (sesión, TPR, avance): relanzar para que route.ts devuelva 502
        if (err instanceof GlpiWriteError) throw err;
        throw new GlpiWriteError(
          'Error inesperado en escritura GLPI',
          'Error inesperado al comunicarse con GLPI'
        );
      } finally {
        // Siempre cerrar sesión GLPI, incluso si hubo error
        await client.killSession();
      }
    }

    // ─── 3. Guardado local (transacción serializable) ─────────────────────────────────────────
    const result = await this.runtime.withTransaction({ isolation: 'serializable' }, async (tx) => {
      const ticketReadRepo = new SqlServerOperationalTicketReadRepository(tx);
      const coordWriteRepo = new SqlServerOperationalCoordinationWriteRepository(tx);
      const auditWriteRepo = new SqlServerOperationalAuditWriteRepository(tx);

      const ticket = await ticketReadRepo.findTicketById(ticketId);
      if (!ticket) {
        throw new OperationalCoordinationMutationError('ticket_not_found', 'Ticket no encontrado.');
      }

      if (userRole === 'coordinador_sistemas' && !ticket.isSistemasScope) {
        throw new OperationalCoordinationMutationError('forbidden', 'Ticket fuera de alcance.');
      }

      const currentCoordination = await coordWriteRepo.findByTicketId(ticketId);

      const newProgressPercent = patch.progressPercent !== undefined
        ? patch.progressPercent
        : (currentCoordination?.progressPercent ?? 0);

      const newCoordinatorComment = patch.coordinatorComment !== undefined
        ? patch.coordinatorComment
        : (currentCoordination?.coordinatorComment ?? '');

      const newEstimatedDeliveryDate = patch.estimatedDeliveryDate !== undefined
        ? patch.estimatedDeliveryDate
        : (currentCoordination?.estimatedDeliveryDate ?? null);

      await coordWriteRepo.upsert({
        ticketId,
        progressPercent: newProgressPercent,
        coordinatorComment: newCoordinatorComment,
        estimatedDeliveryDate: newEstimatedDeliveryDate,
        updatedByUserId: userId,
        updatedAt: clock
      });

      const updatedCoordination = await coordWriteRepo.findByTicketId(ticketId);
      if (
        !updatedCoordination ||
        updatedCoordination.ticketId !== ticketId ||
        updatedCoordination.progressPercent !== newProgressPercent ||
        updatedCoordination.coordinatorComment !== newCoordinatorComment ||
        updatedCoordination.estimatedDeliveryDate !== newEstimatedDeliveryDate ||
        updatedCoordination.updatedByUserId !== userId
      ) {
        throw new OperationalCoordinationMutationError('invalid_state', 'Postcondition validation failed');
      }

      await auditWriteRepo.writeAudit({
        userId,
        action: 'coordination_update',
        entityType: 'coordination',
        entityId: String(ticketId),
        actorName: displayName,
        actorUsername: username,
        before: currentCoordination ? {
          progressPercent: currentCoordination.progressPercent,
          coordinatorComment: currentCoordination.coordinatorComment,
          estimatedDeliveryDate: currentCoordination.estimatedDeliveryDate
        } : null,
        after: {
          progressPercent: updatedCoordination.progressPercent,
          coordinatorComment: updatedCoordination.coordinatorComment,
          estimatedDeliveryDate: updatedCoordination.estimatedDeliveryDate
        }
      });

      return Object.freeze({ coordination: updatedCoordination });
    });

    // ─── 4. Propagar advertencia de followup o avance si corresponde ──────────────────────────────────
    // La usará route.ts para incluirla en la respuesta sin bloquear el éxito del guardado.
    if (followupWarning || progressWarning) {
      return Object.freeze({ ...result, followupWarning, progressWarning });
    }

    return result;
  }
}
