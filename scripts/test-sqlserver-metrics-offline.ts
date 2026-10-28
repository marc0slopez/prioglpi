import assert from 'node:assert/strict';
import { SqlServerOperationalMetricsRepository } from '../lib/db/operational/sqlserver-operational-metrics-repository';
import type { ISqlServerSession, SqlParameter, SqlRow } from '../lib/db/sqlserver-runtime-contract';

class FakeSession implements ISqlServerSession {
  public queryCalls = 0;
  public executeCalls = 0;
  public queryArgs: { sql: string; params: SqlParameter[] }[] = [];
  public customQueryHandler?: (sql: string, params: SqlParameter[]) => Promise<SqlRow[]>;

  async query(sql: string, params: SqlParameter[] = []): Promise<SqlRow[]> {
    this.queryCalls++;
    this.queryArgs.push({ sql, params });
    if (this.customQueryHandler) {
      return await this.customQueryHandler(sql, params);
    }
    return [];
  }

  async execute(sql: string, params: SqlParameter[] = []): Promise<number> {
    void sql;
    void params;
    this.executeCalls++;
    return 0;
  }
}

let passed = 0, failed = 0, total = 0;
async function runTest(name: string, fn: () => void | Promise<void>) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    const message = err instanceof Error ? err.message : 'Unknown test failure';
    console.error(`[FAIL] ${name}: ${message}`);
    throw err;
  }
}

async function main() {
  const range = { start: '2026-08-01T00:00:00.000Z', end: '2026-08-31T23:59:59.999Z' };

  await runTest('Coordinator Metrics - Retorna calculos exactos y estructura de respuesta', async () => {
    const session = new FakeSession();
    session.customQueryHandler = async (sql) => {
      if (sql.includes('CASE WHEN EXISTS') && sql.includes('[prioglpi].[ticket_ranking]')) {
        return [
          { ticket_id: 101, progress_percent: 50, estimated_delivery_date: '2026-01-01', has_ranking: 1 },
          { ticket_id: 102, progress_percent: 0, estimated_delivery_date: null, has_ranking: 0 }
        ];
      }
      if (sql.includes('SELECT COUNT(*) AS [c]')) {
        return [{ c: 15 }];
      }
      if (sql.includes('WHERE [group_id] = 30')) {
        return [{ user_id: 10 }, { user_id: 20 }];
      }
      if (sql.includes('WHERE [is_active] = 1 AND [glpi_user_id] IN')) {
        return [
          { glpi_user_id: 10, display_name: 'Tech A' },
          { glpi_user_id: 20, display_name: 'Tech B' }
        ];
      }
      if (sql.includes('WHERE [role] = \'referente\'')) {
        return [];
      }
      if (sql.includes('WHERE [actor_type] = 2')) {
        return [{ ticket_id: 101, glpi_user_id: 10 }];
      }
      if (sql.includes('WHERE [is_sistemas_scope] = 1;')) {
        return [{ ticket_id: 101 }, { ticket_id: 102 }];
      }
      if (sql.includes('temporalSql') || sql.includes('t.[opened_at] >= @start')) {
        return [
          { ticket_id: 101, status: 2, status_label: 'En curso' },
          { ticket_id: 102, status: 1, status_label: 'Nuevo' }
        ];
      }
      return [];
    };

    const repo = new SqlServerOperationalMetricsRepository(session);
    const result = await repo.getCoordinatorMetrics({
      period: 'month',
      range,
      view: 'all',
      unassignedTechnician: false
    });

    assert.equal(result.total, 15);
    assert.equal(result.prioritized, 1);
    assert.equal(result.unprioritized, 1);
    assert.equal(result.averageProgress, 25);
    assert.equal(result.overdueCount, 1);
    assert.equal(result.kpis.ingresados, 15);
    assert.equal(result.kpis.backlog, 2);
    assert.equal(result.kpis.enCurso, 1);
    assert.equal(result.kpis.nuevos, 1);
    assert.equal(session.executeCalls, 0);
  });

  await runTest('Coordinator Metrics - Valida rechazo FORBIDDEN_TECHNICIAN', async () => {
    const session = new FakeSession();
    session.customQueryHandler = async (sql) => {
      if (sql.includes('WHERE [group_id] = 30')) return [{ user_id: 10 }];
      if (sql.includes('WHERE [is_active] = 1 AND [glpi_user_id] IN')) return [{ glpi_user_id: 10, display_name: 'Tech A' }];
      return [];
    };

    const repo = new SqlServerOperationalMetricsRepository(session);
    await assert.rejects(
      repo.getCoordinatorMetrics({
        period: 'month',
        range,
        view: 'all',
        unassignedTechnician: false,
        technicianId: 999
      }),
      (err: Error) => err.message === 'FORBIDDEN_TECHNICIAN'
    );
    assert.equal(session.executeCalls, 0);
  });

  await runTest('Referent Metrics - Retorna backlog y top prioridades por sector', async () => {
    const session = new FakeSession();
    session.customQueryHandler = async (sql) => {
      if (sql.includes('SELECT t.[ticket_id], t.[status], t.[status_label], t.[detected_sector]')) {
        return [
          { ticket_id: 201, status: 1, status_label: 'Nuevo', detected_sector: 'Sistemas', detected_sector_group_id: 10 }
        ];
      }
      if (sql.includes('CASE WHEN EXISTS') && sql.includes('[prioglpi].[ticket_ranking]')) {
        return [
          { ticket_id: 201, detected_sector_group_id: 10, has_ranking: 1 }
        ];
      }
      if (sql.includes('SELECT TOP (5) r.[rank_position]')) {
        return [
          { rank_position: 1, ticket_id: 201, sector_name: 'Sistemas', title: 'Ticket 201', status_label: 'Nuevo' }
        ];
      }
      return [];
    };

    const repo = new SqlServerOperationalMetricsRepository(session);
    const result = await repo.getReferentMetrics({
      range,
      sectorGroupId: 10,
      userRole: 'priorizador',
      userSectorGroupIds: [10],
      ownerUserId: 2
    });

    assert.equal(result.total, 1);
    assert.equal(result.ranked, 1);
    assert.equal(result.unranked, 0);
    assert.equal(result.topPriorities.length, 1);
    assert.equal(result.topPriorities[0].ticketId, 201);
    assert.equal(session.executeCalls, 0);
  });

  await runTest('Referente Metrics - Excluye referentes y valida FORBIDDEN_REQUESTER', async () => {
    const session = new FakeSession();
    session.customQueryHandler = async (sql) => {
      if (sql.includes('WHERE [group_id] IN')) return [{ user_id: 10 }, { user_id: 20 }];
      if (sql.includes('WHERE u.[role] = \'referente\'')) return [{ glpi_user_id: 20 }]; // 20 is referente
      if (sql.includes('WHERE [is_active] = 1 AND [glpi_user_id] IN')) return [{ glpi_user_id: 10, display_name: 'Member 10' }];
      return [];
    };

    const repo = new SqlServerOperationalMetricsRepository(session);

    // Valid call
    const result = await repo.getSupervisorMetrics({
      range,
      userRole: 'referente',
      userSectorGroupIds: [100]
    });
    assert.equal(result.requesterOptions.length, 1);
    assert.equal(result.requesterOptions[0].id, 10);

    // Invalid requester 999
    await assert.rejects(
      repo.getSupervisorMetrics({
        range,
        requester: '999',
        userRole: 'referente',
        userSectorGroupIds: [100]
      }),
      (err: Error) => err.message === 'FORBIDDEN_REQUESTER'
    );
    assert.equal(session.executeCalls, 0);
  });
}

void main().then(() => {
  console.log(`\nTests Metrics SQL Server: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
