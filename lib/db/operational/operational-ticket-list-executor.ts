import type { ISqlServerRuntime } from '../sqlserver-runtime-contract';
import type { OperationalTicketListExecutionPlan } from './operational-ticket-list-plan-types';
import type { OperationalTicketListResponse, OperationalTicketListResponseTicket } from './operational-ticket-list-execution-types';
import { OperationalTicketListExecutionError } from './operational-ticket-list-execution-types';
import type { OperationalSqlStatement } from './operational-ticket-list-sql-types';
import { buildOperationalTicketListCountProgram, buildOperationalTicketListPageStatement } from './operational-ticket-list-sql-builder';
import { mapOperationalTicketListRow } from './operational-ticket-list-row-mapper';

export async function executeOperationalTicketList(
  runtime: ISqlServerRuntime,
  plan: OperationalTicketListExecutionPlan,
  todayArgentina: string
): Promise<OperationalTicketListResponse> {
  const countProgram = buildOperationalTicketListCountProgram(plan, todayArgentina);

  return runtime.withTransaction({ isolation: 'serializable' }, async (tx) => {
    let rankedCount = 0;
    let unrankedCount = 0;

    const executeCount = async (stmt: OperationalSqlStatement): Promise<number> => {
      const rs = await tx.query(stmt.sql, [...stmt.params]);
      if (rs.length !== 1) {
        throw new OperationalTicketListExecutionError('corrupt_data', 'Count returned multiple or zero rows');
      }
      const row = rs[0];
      if (!row || typeof row !== 'object' || !('total' in row) || Object.keys(row).length !== 1) {
        throw new OperationalTicketListExecutionError('corrupt_data', 'Count returned corrupt row structure');
      }
      const total = row.total;
      if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0 || total > 2147483647) {
        throw new OperationalTicketListExecutionError('corrupt_data', 'Count returned invalid total');
      }
      return total;
    };

    if (countProgram.rankedCount !== null) {
      rankedCount = await executeCount(countProgram.rankedCount);
    }
    if (countProgram.unrankedCount !== null) {
      unrankedCount = await executeCount(countProgram.unrankedCount);
    }

    const total = rankedCount + unrankedCount;
    if (!Number.isSafeInteger(total) || total > 2147483647) {
      throw new OperationalTicketListExecutionError('corrupt_data', 'Total overflow');
    }

    const { page, limit, offset, priority, view } = plan.query;
    const pages = Math.ceil(total / limit);
    const tickets: OperationalTicketListResponseTicket[] = [];

    const executePage = async (branch: 'ranked' | 'unranked', bOffset: number, bTake: number) => {
      if (bTake <= 0) return;
      const stmt = buildOperationalTicketListPageStatement(plan, branch, bOffset, bTake, todayArgentina);
      const rs = await tx.query(stmt.sql, [...stmt.params]);
      if (rs.length !== bTake) {
        throw new OperationalTicketListExecutionError('corrupt_data', 'PAGE returned wrong number of rows');
      }
      for (const row of rs) {
        tickets.push(mapOperationalTicketListRow(row, branch));
      }
    };

    if (offset < total) {
      if (priority === 'ranked') {
        const take = Math.min(limit, rankedCount - offset);
        await executePage('ranked', offset, take);
      } else if (priority === 'unranked') {
        const take = Math.min(limit, unrankedCount - offset);
        await executePage('unranked', offset, take);
      } else {
        if (offset < rankedCount) {
          const rankedTake = Math.min(limit, rankedCount - offset);
          await executePage('ranked', offset, rankedTake);
          const rem = limit - rankedTake;
          if (rem > 0) {
            const unrankedTake = Math.min(rem, unrankedCount);
            await executePage('unranked', 0, unrankedTake);
          }
        } else {
          const uOffset = offset - rankedCount;
          const uTake = Math.min(limit, unrankedCount - uOffset);
          await executePage('unranked', uOffset, uTake);
        }
      }
    }

    const seen = new Set<number>();
    let lastRankedPos = -1;
    let lastRankedTid = -1;
    let lastRankedRid = -1;
    let lastUnrankedDate = '';
    let lastUnrankedTid = 2147483648;
    let inUnranked = false;

    for (const ticket of tickets) {
      if (seen.has(ticket.ticketId)) {
        throw new OperationalTicketListExecutionError('corrupt_data', 'Duplicate ticketId');
      }
      seen.add(ticket.ticketId);

      const isOpenStatus =
        ticket.status === 1 ||
        ticket.status === 2 ||
        ticket.status === 3 ||
        ticket.status === 4;

      const isHistoryStatus =
        ticket.status === 5 ||
        ticket.status === 6;

      if (view === 'open' && !isOpenStatus) {
        throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid state for open view');
      } else if (view === 'history' && !isHistoryStatus) {
        throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid state for history view');
      }

      const isRanked = ticket.rankings.length > 0;
      if (!isRanked && !inUnranked) {
        inUnranked = true;
      } else if (isRanked && inUnranked) {
        throw new OperationalTicketListExecutionError('corrupt_data', 'Ranked ticket appeared after unranked ticket');
      }

      if (isRanked) {
        const ranking = ticket.rankings[0];
        if (ranking === undefined) throw new OperationalTicketListExecutionError('corrupt_data', 'Missing ranking');

        if (view === 'open') {
          if (!ranking.isActive) throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid ranked state for open view');
        } else if (view === 'history') {
          if (ranking.isActive) throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid ranked state for history view');
        } else if (view === 'all') {
          if (isOpenStatus && !ranking.isActive) {
            throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid ranked state for all view');
          }
          if (isHistoryStatus && ranking.isActive) {
            throw new OperationalTicketListExecutionError('corrupt_data', 'Invalid ranked state for all view');
          }
        }

        if (ranking.rankPosition < lastRankedPos) {
          throw new OperationalTicketListExecutionError('corrupt_data', 'Ranked order violation pos');
        } else if (ranking.rankPosition === lastRankedPos) {
          if (ticket.ticketId < lastRankedTid) {
            throw new OperationalTicketListExecutionError('corrupt_data', 'Ranked order violation tid');
          } else if (ticket.ticketId === lastRankedTid) {
            if (ranking.id <= lastRankedRid) {
              throw new OperationalTicketListExecutionError('corrupt_data', 'Ranked order violation rid');
            }
          }
        }
        lastRankedPos = ranking.rankPosition;
        lastRankedTid = ticket.ticketId;
        lastRankedRid = ranking.id;
      } else {
        const d = ticket.openedAt;
        if (lastUnrankedDate !== '' && d > lastUnrankedDate) {
          throw new OperationalTicketListExecutionError('corrupt_data', 'Unranked order violation date');
        } else if (d === lastUnrankedDate) {
          if (ticket.ticketId >= lastUnrankedTid) {
            throw new OperationalTicketListExecutionError('corrupt_data', 'Unranked order violation tid');
          }
        }
        lastUnrankedDate = d;
        lastUnrankedTid = ticket.ticketId;
      }
    }

    return Object.freeze({
      tickets: Object.freeze([...tickets]),
      total,
      page,
      limit,
      pages
    });
  });
}
