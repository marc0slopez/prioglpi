import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { runSync } from '@/lib/sync-service';
import { redactSecrets } from '@/lib/secret-sanitizer';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalAuditWriteRepository } from '@/lib/db/operational/sqlserver-operational-audit-write-repository';
import type { OperationalAuditWriteInput } from '@/lib/db/operational/operational-audit-write-repository';

async function writeSyncAudit(input: OperationalAuditWriteInput): Promise<void> {
  const runtime = getSharedSqlServerRuntime();
  await runtime.withTransaction({ isolation: 'serializable' }, async (tx) => {
    const auditRepo = new SqlServerOperationalAuditWriteRepository(tx);
    await auditRepo.writeAudit(input);
  });
}

export async function POST() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Solo admin puede ejecutar sincronización manual.' },
        { status: 403 }
      );
    }

    const startedAtDate = new Date();
    const result = await runSync();
    const finishedAtDate = new Date();

    const startedAt = startedAtDate.toISOString();
    const finishedAt = finishedAtDate.toISOString();
    const durationMs = Math.max(
      0,
      finishedAtDate.getTime() - startedAtDate.getTime()
    );

    if (result.error) {
      const redactedErr = redactSecrets(result.error);
      const sanitizedMsg = typeof redactedErr === 'string' ? redactedErr : JSON.stringify(redactedErr);
      let auditWarning: string | undefined;

      try {
        await writeSyncAudit({
          userId: user.userId,
          action: 'manual_sync_error',
          entityType: 'sync',
          entityId: 'glpi',
          actorName: user.displayName,
          actorUsername: user.username,
          before: { startedAt },
          after: {
            startedAt,
            finishedAt,
            durationMs,
            ticketsFetched: result.ticketsFetched,
            status: 'error',
            errorMessage: sanitizedMsg
          },
        });
      } catch {
        auditWarning = 'Fallo al registrar evento en auditoría.';
      }

      return NextResponse.json(
        {
          error: `Error de sincronización con GLPI: ${sanitizedMsg}`,
          ticketsFetched: result.ticketsFetched,
          ...(auditWarning ? { auditWarning } : {}),
        },
        { status: 502 }
      );
    }

    let auditWarning: string | undefined;
    try {
      await writeSyncAudit({
        userId: user.userId,
        action: 'manual_sync_success',
        entityType: 'sync',
        entityId: 'glpi',
        actorName: user.displayName,
        actorUsername: user.username,
        before: { startedAt },
        after: {
          startedAt,
          finishedAt,
          durationMs,
          ticketsFetched: result.ticketsFetched,
          status: 'success'
        },
      });
    } catch {
      auditWarning = 'Fallo al registrar evento en auditoría.';
    }

    return NextResponse.json({
      message: `Sincronización completada. ${result.ticketsFetched} tickets sincronizados.`,
      ticketsFetched: result.ticketsFetched,
      error: null,
      ...(auditWarning ? { auditWarning } : {}),
    });
  } catch (error) {
    const redactedErr = redactSecrets(error instanceof Error ? error.message : String(error));
    const sanitizedMsg = typeof redactedErr === 'string' ? redactedErr : JSON.stringify(redactedErr);
    let auditWarning: string | undefined;

    try {
      const user = await getAuthUser();
      if (user) {
        await writeSyncAudit({
          userId: user.userId,
          action: 'manual_sync_error',
          entityType: 'sync',
          entityId: 'glpi',
          actorName: user.displayName,
          actorUsername: user.username,
          before: { startedAt: new Date().toISOString() },
          after: { status: 'error', errorMessage: sanitizedMsg },
        });
      }
    } catch {
      auditWarning = 'Fallo al registrar evento en auditoría.';
    }

    return NextResponse.json(
      {
        error: `Error al ejecutar sincronización: ${sanitizedMsg}`,
        ...(auditWarning ? { auditWarning } : {})
      },
      { status: 500 }
    );
  }
}
