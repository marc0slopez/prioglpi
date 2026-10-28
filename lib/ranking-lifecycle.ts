import { Prisma } from '@prisma/client';
import { logAudit } from './audit';

export async function deactivateAndRenumberRankings(
  tx: Prisma.TransactionClient,
  closedTicketIds: number[],
  systemSyncUserId: number
): Promise<number> {
  let deactivatedCount = 0;

  const sysUser = await tx.user.findUnique({
    where: { id: systemSyncUserId },
    select: { displayName: true, username: true },
  });
  if (!sysUser) {
    throw new Error(`System sync user id=${systemSyncUserId} not found in database.`);
  }

  const activeRankingsToDeactivate = await tx.ticketRanking.findMany({
    where: {
      ticketId: { in: closedTicketIds },
      isActive: true,
      ticket: {
        status: { in: [5, 6] }
      }
    }
  });

  if (activeRankingsToDeactivate.length > 0) {
    const glpiGroupIds = new Set(activeRankingsToDeactivate.map(r => r.glpiGroupId));

    for (const ranking of activeRankingsToDeactivate) {
      const current = await tx.ticketRanking.findUnique({ where: { id: ranking.id } });
      if (!current || !current.isActive) continue;

      await tx.ticketRanking.update({
        where: { id: ranking.id },
        data: { isActive: false },
      });

      deactivatedCount++;

      await logAudit({
        tx,
        userId: systemSyncUserId,
        action: 'ranking_auto_deactivate',
        entityType: 'ranking',
        entityId: `${ranking.glpiGroupId}/${ranking.ticketId}`,
        actorName: sysUser.displayName,
        actorUsername: sysUser.username,
        before: {
          ticketId: ranking.ticketId,
          glpiGroupId: ranking.glpiGroupId,
          sectorName: ranking.sectorName,
          rankPosition: ranking.rankPosition,
          isActive: true,
          updatedByUserId: ranking.updatedByUserId,
        },
        after: {
          ticketId: ranking.ticketId,
          glpiGroupId: ranking.glpiGroupId,
          sectorName: ranking.sectorName,
          rankPosition: ranking.rankPosition,
          isActive: false,
          updatedByUserId: ranking.updatedByUserId,
        },
      });
    }

    for (const groupId of glpiGroupIds) {
      const remainingActive = await tx.ticketRanking.findMany({
        where: { glpiGroupId: groupId, isActive: true },
        orderBy: [{ rankPosition: 'asc' }, { ticketId: 'asc' }]
      });

      for (let i = 0; i < remainingActive.length; i++) {
        const expectedPos = i + 1;
        if (remainingActive[i].rankPosition !== expectedPos) {
          await tx.ticketRanking.update({
            where: { id: remainingActive[i].id },
            data: { rankPosition: expectedPos }
          });
        }
      }
    }
  }

  return deactivatedCount;
}
