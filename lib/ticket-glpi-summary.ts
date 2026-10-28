import { decode } from 'html-entities';
import { GlpiClient } from './glpi-client';
import type { ISqlServerRuntime, SqlParameter } from './db/sqlserver-runtime-contract';

export interface TicketGlpiSummary {
  progressPercent: number | null;
  timeToResolve: string | null;
  liveDataAvailable: boolean;
  latestFollowup: {
    author: string | null;
    content: string;
    createdAt: string;
  } | null;
}

export function ownPrioGlpiFollowupPrefix(username: string): string {
  return `PrioGLPI [${username}] `;
}

function plainFollowup(content: string): string {
  const html = decode(decode(content));
  return decode(html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n?/g, '\n'))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000);
}

async function getLatestFollowups(
  runtime: ISqlServerRuntime,
  ticketIds: readonly number[],
  canSeePrivate: boolean,
  ownPrivatePrefix: string
): Promise<Map<number, TicketGlpiSummary['latestFollowup']>> {
  const result = new Map<number, TicketGlpiSummary['latestFollowup']>();
  for (let start = 0; start < ticketIds.length; start += 200) {
    const batch = ticketIds.slice(start, start + 200);
    const params: SqlParameter[] = batch.map((id, index) => ({
      name: `ticketId${index}`, type: 'int', nullable: false, value: id,
    }));
    const placeholders = batch.map((_, index) => `@ticketId${index}`).join(', ');
    const rows = await runtime.query(`
      WITH latest AS (
        SELECT [ticket_id], [author], [content_plain], [created_at],
          ROW_NUMBER() OVER (PARTITION BY [ticket_id] ORDER BY [created_at] DESC, [followup_id] DESC) AS rn
        FROM [prioglpi].[glpi_followup_cache]
        WHERE [ticket_id] IN (${placeholders})
          AND (@canSeePrivate = 1 OR [is_private] = 0
            OR (@ownPrivatePrefix <> '' AND CHARINDEX(@ownPrivatePrefix, [content_plain]) BETWEEN 1 AND 32))
      )
      SELECT [ticket_id], [author], [content_plain], [created_at]
      FROM latest WHERE rn = 1
    `, [...params,
      { name: 'canSeePrivate', type: 'bit', nullable: false, value: canSeePrivate },
      { name: 'ownPrivatePrefix', type: 'nvarchar', length: 180, nullable: false, value: ownPrivatePrefix },
    ]);
    for (const row of rows) {
      const id = row.ticket_id;
      const createdAt = row.created_at;
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || !batch.includes(id) ||
          !(createdAt instanceof Date) || typeof row.content_plain !== 'string') {
        throw new Error('Invalid followup row');
      }
      result.set(id, {
        author: typeof row.author === 'string' ? row.author : null,
        content: plainFollowup(row.content_plain),
        createdAt: createdAt.toISOString(),
      });
    }
  }
  return result;
}

export async function getTicketGlpiSummaries(
  runtime: ISqlServerRuntime,
  ticketIds: readonly number[],
  canSeePrivate: boolean,
  ownPrivatePrefix = ''
): Promise<Map<number, TicketGlpiSummary>> {
  const ids = [...new Set(ticketIds)];
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Invalid ticket ID');
  if (ids.length === 0) return new Map();

  const [live, followups] = await Promise.allSettled([
    (async () => {
      const client = new GlpiClient();
      await client.initSession();
      try {
        return await client.getTicketListSnapshots(ids);
      } finally {
        await client.killSession();
      }
    })(),
    getLatestFollowups(runtime, ids, canSeePrivate, ownPrivatePrefix),
  ]);
  if (live.status === 'rejected') console.warn('[ticket-glpi-summary] GLPI unavailable:', live.reason);
  if (followups.status === 'rejected') console.warn('[ticket-glpi-summary] Followups unavailable:', followups.reason);

  return new Map(ids.map(id => {
    const snapshot = live.status === 'fulfilled' ? live.value.get(id) : undefined;
    return [id, {
      progressPercent: snapshot?.progressPercent ?? null,
      timeToResolve: snapshot?.timeToResolve ?? null,
      liveDataAvailable: live.status === 'fulfilled',
      latestFollowup: followups.status === 'fulfilled' ? followups.value.get(id) ?? null : null,
    }];
  }));
}
