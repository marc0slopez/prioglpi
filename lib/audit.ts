/**
 * Helper tipado para registrar auditoría de cambios en APPGLPI con soporte transaccional y sanitización.
 */

import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { CanonicalAction, CanonicalEntityType } from './audit-types';
import { redactSecrets } from './secret-sanitizer';

export interface AuditBaseOptions {
  tx?: Prisma.TransactionClient;
  action: CanonicalAction;
  entityType: CanonicalEntityType;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

export interface KnownActorAuditOptions extends AuditBaseOptions {
  userId: number;
  actorName: string;      // No vacío, validado en runtime
  actorUsername: string;  // No vacío, validado en runtime
}

export interface AnonymousActorAuditOptions extends AuditBaseOptions {
  userId: null;
  actorName: null;
  actorUsername: string | null;
}

export type AuditLogOptions = KnownActorAuditOptions | AnonymousActorAuditOptions;

export async function logAudit(options: AuditLogOptions): Promise<void> {
  const { tx, userId, action, entityType, entityId, before, after } = options;
  let actorName: string | null = null;
  let actorUsername: string | null = null;

  if (userId !== null && userId !== undefined) {
    const knownOpts = options as KnownActorAuditOptions;
    if (!knownOpts.actorName || !knownOpts.actorUsername || !knownOpts.actorName.trim() || !knownOpts.actorUsername.trim()) {
      throw new Error('actorName and actorUsername are required and non-empty when userId is provided');
    }
    actorName = knownOpts.actorName;
    actorUsername = knownOpts.actorUsername;
  } else {
    const anonOpts = options as AnonymousActorAuditOptions;
    actorName = null;
    actorUsername = anonOpts.actorUsername ?? null;
  }

  const client = tx || prisma;
  const beforeClean = before !== undefined && before !== null ? redactSecrets(before) : null;
  const afterClean = after !== undefined && after !== null ? redactSecrets(after) : null;

  await client.auditLog.create({
    data: {
      userId: userId ?? null,
      action,
      entityType,
      entityId,
      beforeJson: beforeClean !== null ? JSON.stringify(beforeClean) : null,
      afterJson: afterClean !== null ? JSON.stringify(afterClean) : null,
      actorName,
      actorUsername,
    },
  });
}
