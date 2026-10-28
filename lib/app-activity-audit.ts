import type { AuthUser } from './auth';
import type { CanonicalAction, CanonicalEntityType } from './audit-types';
import { getSharedSqlServerRuntime } from './db/sqlserver-runtime-factory';
import { SqlServerOperationalAuditWriteRepository } from './db/operational/sqlserver-operational-audit-write-repository';

export async function writeAppActivity(
  user: AuthUser,
  action: CanonicalAction,
  entityType: CanonicalEntityType,
  entityId: string,
  after: Record<string, unknown>,
): Promise<void> {
  await getSharedSqlServerRuntime().withTransaction({ isolation: 'read_committed' }, async tx => {
    await new SqlServerOperationalAuditWriteRepository(tx).writeAudit({
      userId: user.userId,
      action,
      entityType,
      entityId,
      actorName: user.displayName,
      actorUsername: user.username,
      after,
    });
  });
}
