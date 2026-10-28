import { GlpiClient, type GlpiTicketListSnapshot } from './glpi-client';
import { ttrCalendarStatus } from './ttr-calendar';

export function countOverdueTtr(
  ticketIds: readonly number[],
  snapshots: ReadonlyMap<number, GlpiTicketListSnapshot>,
  now = new Date()
): number | null {
  let overdue = 0;
  for (const id of ticketIds) {
    const snapshot = snapshots.get(id);
    if (!snapshot) return null;
    if (!snapshot.timeToResolve) continue;
    const status = ttrCalendarStatus(snapshot.timeToResolve, now);
    if (!status) return null;
    if (status.tone === 'overdue') overdue++;
  }
  return overdue;
}

export async function getOverdueTtrCount(ticketIds: readonly number[], now = new Date()): Promise<number | null> {
  const ids = [...new Set(ticketIds)];
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Invalid ticket ID');
  if (ids.length === 0) return 0;

  const client = new GlpiClient();
  await client.initSession();
  try {
    const snapshots = await client.getTicketListSnapshots(ids);
    return countOverdueTtr(ids, snapshots, now);
  } finally {
    await client.killSession();
  }
}
