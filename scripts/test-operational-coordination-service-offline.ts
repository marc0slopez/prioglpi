import assert from 'node:assert';
import { OperationalCoordinationMutationService } from '../lib/db/operational/operational-coordination-mutation-service';
import type { ISqlServerRuntime, ISqlServerTransaction, SqlParameter, SqlRow, TransactionOptions } from '../lib/db/sqlserver-runtime-contract';
import { parseCoordinationPatchInput, parseCoordinationTicketId } from '../lib/db/operational/operational-coordination-mutation-types';
import { SqlServerOperationalCoordinationWriteRepository } from '../lib/db/operational/sqlserver-operational-coordination-write-repository';

class FakeTransaction implements ISqlServerTransaction {
  public executeRows: number = 1;
  public queryRows: SqlRow[] = [];
  public executeSqls: string[] = [];

  public async execute(sql: string, params?: SqlParameter[]): Promise<number> {
    void params;
    this.executeSqls.push(sql);
    return this.executeRows;
  }

  public async query(sql: string, params?: SqlParameter[]): Promise<SqlRow[]> {
    void sql;
    void params;
    return this.queryRows;
  }
}

class FakeRuntime implements ISqlServerRuntime {
  public txInstance: FakeTransaction = new FakeTransaction();
  public isolationLevel: string | undefined;

  public async execute(sql: string, params?: SqlParameter[]): Promise<number> {
    void sql;
    void params;
    return 0;
  }

  public async query(sql: string, params?: SqlParameter[]): Promise<SqlRow[]> {
    void sql;
    void params;
    return [];
  }

  public async withTransaction<T>(
    options: TransactionOptions | undefined,
    callback: (tx: ISqlServerTransaction) => Promise<T>
  ): Promise<T> {
    this.isolationLevel = options?.isolation;
    return callback(this.txInstance);
  }

  public async close(): Promise<void> {}
}

const mockTicketRow: SqlRow = {
  ticket_id: 100, title: 'T', content_plain: 'C', status: 1, status_label: 'L',
  type: 1, type_label: 'L', priority: 1, priority_label: 'L', opened_at: '2025-01-01',
  updated_at_glpi: '2025-01-01', solved_at: null, closed_at: null, requester_name: 'N',
  requester_group: 'G', assigned_technician: 'T', assigned_group_ids: '1',
  assigned_group_names: 'GN', detected_sector: 'S', is_sistemas_scope: 1,
  is_tecnologia_scope: 0, web_url: 'W', synced_at: new Date(), requester_user_id: 1,
  requester_group_id: null, detected_sector_group_id: 1, detected_sector_name: 'S',
  sector_source: null, category_id: null, entity_id: null, location_id: null,
  request_type_id: null, urgency: null, impact: null, glpi_priority: null
};

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`[OK] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    console.error(error);
    process.exit(1);
  }
}

void (async () => {
  console.log('--- TEST OPERATIONAL COORDINATION SERVICE OFFLINE ---');

  await runTest('T1: Parser ticketId y fecha calendario real', () => {
    assert.strictEqual(parseCoordinationTicketId(100), 100);
    assert.strictEqual(parseCoordinationTicketId('100'), 100);
    assert.throws(() => parseCoordinationTicketId(0), /Invalid ticketId/);
    assert.throws(() => parseCoordinationTicketId(-5), /Invalid ticketId/);
    assert.throws(() => parseCoordinationTicketId(2147483648), /Invalid ticketId/);
    assert.throws(() => parseCoordinationTicketId('abc'), /Invalid ticketId/);

    const validPatch = parseCoordinationPatchInput({
      progressPercent: 50,
      coordinatorComment: 'Comentario\t\n\r',
      estimatedDeliveryDate: '2024-02-29'
    });
    assert.strictEqual(validPatch.progressPercent, 50);
    assert.strictEqual(validPatch.estimatedDeliveryDate, '2024-02-29');

    assert.throws(() => parseCoordinationPatchInput({ estimatedDeliveryDate: '2023-02-29' }), /YYYY-MM-DD/);
    assert.throws(() => parseCoordinationPatchInput({ estimatedDeliveryDate: '2025-04-31' }), /YYYY-MM-DD/);
    assert.throws(() => parseCoordinationPatchInput({ coordinatorComment: 'A\0B' }), /Invalid coordinatorComment/);
    assert.throws(() => parseCoordinationPatchInput({ coordinatorComment: 'A\x7FB' }), /Invalid coordinatorComment/);
  });

  await runTest('T2: Repositorio UPDATE e INSERT cardinalidad', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalCoordinationWriteRepository(tx);

    tx.executeRows = 1;
    await repo.upsert({
      ticketId: 100,
      progressPercent: 50,
      coordinatorComment: 'Ok',
      estimatedDeliveryDate: null,
      updatedByUserId: 1,
      updatedAt: new Date()
    });
    assert.strictEqual(tx.executeSqls.length, 1);

    tx.executeRows = 0;
    await repo.upsert({
      ticketId: 100,
      progressPercent: 50,
      coordinatorComment: 'Ok',
      estimatedDeliveryDate: null,
      updatedByUserId: 1,
      updatedAt: new Date()
    });
    assert.strictEqual(tx.executeSqls.length, 3);
  });

  await runTest('T3: Happy path servicio con tx serializable y auditoria', async () => {
    const runtime = new FakeRuntime();
    let queryCallIndex = 0;
    runtime.txInstance.query = async () => {
      queryCallIndex++;
      if (queryCallIndex === 1) return [mockTicketRow];
      if (queryCallIndex === 2) return [];
      if (queryCallIndex === 3) return [{
        id: 1, ticket_id: 100, progress_percent: 50, coordinator_comment: 'Test',
        estimated_delivery_date: '2025-10-10', updated_by_user_id: 1,
        updated_by_display_name: 'Admin', updated_at: new Date()
      }];
      return [];
    };

    const service = new OperationalCoordinationMutationService(runtime);
    const res = await service.updateCoordination(
      100,
      { progressPercent: 50, coordinatorComment: 'Test', estimatedDeliveryDate: '2025-10-10' },
      1,
      'admin',
      'Admin User',
      'admin'
    );

    assert.strictEqual(runtime.isolationLevel, 'serializable');
    assert.strictEqual(res.coordination.progressPercent, 50);
  });

  await runTest('T4: Postlectura discordante lanza invalid_state y fallos de permiso', async () => {
    const runtime = new FakeRuntime();
    let queryCallIndex = 0;
    runtime.txInstance.query = async () => {
      queryCallIndex++;
      if (queryCallIndex === 1) return [mockTicketRow];
      if (queryCallIndex === 2) return [];
      if (queryCallIndex === 3) return [{
        id: 1, ticket_id: 100, progress_percent: 25, coordinator_comment: 'Distinto',
        estimated_delivery_date: null, updated_by_user_id: 1,
        updated_by_display_name: 'Admin', updated_at: new Date()
      }];
      return [];
    };

    const service = new OperationalCoordinationMutationService(runtime);
    await assert.rejects(
      service.updateCoordination(
        100,
        { progressPercent: 50, coordinatorComment: 'Test' },
        1,
        'admin',
        'Admin User',
        'admin'
      ),
      /Postcondition validation failed/
    );

    await assert.rejects(
      service.updateCoordination(100, {}, 1, 'user', 'User', 'referente'),
      /No tenes permisos/
    );
  });
})();
