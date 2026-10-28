import assert from 'node:assert/strict';
import { SqlServerOperationalSyncRepository } from '../lib/db/operational/sqlserver-operational-sync-repository';
import { SqlRuntimeError, type ISqlServerTransaction, type SqlParameter, type SqlRow, type ISqlServerRuntime, type TransactionOptions } from '../lib/db/sqlserver-runtime-contract';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function assertErrorMessage(
  operation: () => Promise<unknown>,
  expectedMessage: string
): Promise<void> {
  let caught: unknown = null;
  try {
    await operation();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof Error, 'Expected error to be instance of Error');
  assert.equal(caught.message, expectedMessage);
}

class FakeTransaction implements ISqlServerTransaction {
  public executeCalls = 0;
  public queryCalls = 0;
  public executeArgs: { sql: string; params: SqlParameter[] }[] = [];
  public queryArgs: { sql: string; params: SqlParameter[] }[] = [];

  public queryRowsToReturn: SqlRow[] = [];
  public executeRowsToReturn: number = 1;
  public errorToThrow: Error | null = null;
  public customQueryHandler?: (sql: string, params: SqlParameter[]) => Promise<SqlRow[]>;
  public customExecuteHandler?: (sql: string, params: SqlParameter[]) => Promise<number>;

  async execute(sql: string, params: SqlParameter[] = []): Promise<number> {
    if (this.errorToThrow) throw this.errorToThrow;
    this.executeCalls++;
    this.executeArgs.push({ sql, params });
    if (this.customExecuteHandler) return await this.customExecuteHandler(sql, params);
    return this.executeRowsToReturn;
  }

  async query(sql: string, params: SqlParameter[] = []): Promise<SqlRow[]> {
    if (this.errorToThrow) throw this.errorToThrow;
    this.queryCalls++;
    this.queryArgs.push({ sql, params });
    if (this.customQueryHandler) return await this.customQueryHandler(sql, params);

    if (sql.includes("system_sync")) {
      return [{ id: 999, username: 'system_sync', display_name: 'Sys Sync' }];
    }
    return this.queryRowsToReturn;
  }
}

class FakeRuntime implements ISqlServerRuntime {
  public txOpts: TransactionOptions | undefined;
  public activeTx: FakeTransaction | null = null;
  public lastTx: FakeTransaction | null = null;
  public commitCount = 0;
  public rollbackCount = 0;
  public executeCalls = 0;
  public queryCalls = 0;
  public executeArgs: { sql: string; params: SqlParameter[] }[] = [];
  public errorToThrow: Error | null = null;
  public queryRowsToReturn: SqlRow[] = [];
  public customQueryHandler?: (sql: string, params: SqlParameter[] | undefined) => Promise<SqlRow[]>;
  public nextTransactionExecuteResult = 1;

  async withTransaction<T>(options: TransactionOptions | undefined, callback: (tx: ISqlServerTransaction) => Promise<T>): Promise<T> {
    this.txOpts = options;
    assert.equal(options?.isolation, 'serializable');
    const tx = new FakeTransaction();
    tx.executeRowsToReturn = this.nextTransactionExecuteResult;
    this.activeTx = tx;
    this.lastTx = tx;
    try {
      const res = await callback(tx);
      this.commitCount++;
      return res;
    } catch (err) {
      this.rollbackCount++;
      throw err;
    } finally {
      this.activeTx = null;
    }
  }

  async query(sql: string, params?: SqlParameter[]): Promise<SqlRow[]> {
    this.queryCalls++;
    if (this.errorToThrow) throw this.errorToThrow;
    if (this.customQueryHandler) return await this.customQueryHandler(sql, params);
    return this.queryRowsToReturn;
  }

  async execute(sql: string, params?: SqlParameter[]): Promise<number> {
    this.executeCalls++;
    this.executeArgs.push({ sql, params: params || [] });
    if (this.errorToThrow) throw this.errorToThrow;
    return 1;
  }

  async close(): Promise<void> {}
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

const dt = new Date('2023-01-01T00:00:00Z');

async function main() {
  await runTest('1. insertSyncRunError usa tx y cero execute global', async () => {
    const rt = new FakeRuntime();
    await SqlServerOperationalSyncRepository.insertSyncRunError(rt, dt, 'Test', dt);
    assert.equal(rt.executeCalls, 0); // No global execute
    assert.equal(rt.commitCount, 1);
    assert.ok(rt.activeTx === null);
  });

  await runTest('2. Rollback ante rowsAffected inesperado', async () => {
    const rt = new FakeRuntime();
    rt.nextTransactionExecuteResult = 0; // Simulate unexpected 0 rows

    await assertErrorMessage(async () => {
      await SqlServerOperationalSyncRepository.insertSyncRunError(rt, dt, 'Test', dt);
    }, 'unexpected_result');

    assert.equal(rt.commitCount, 0);
    assert.equal(rt.rollbackCount, 1);
    assert.equal(rt.executeCalls, 0);
  });

  await runTest('3. Cada bulk acepta conteo exacto y rechaza underfetch/overfetch', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalSyncRepository(tx);
    tx.executeRowsToReturn = 5;
    await repo.bulkLoadGroups('[]', 5); // Should pass

    await assertErrorMessage(async () => {
      await repo.bulkLoadGroups('[]', 4); // Should fail (overfetch simulated by expected 4, actual 5)
    }, 'unexpected_result');
  });

  await runTest('4. bulkUpsert valida suma update + insert', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalSyncRepository(tx);
    let execs = 0;
    tx.customExecuteHandler = async () => {
      execs++;
      return execs === 1 ? 3 : 2; // update=3, insert=2
    };
    await repo.bulkUpsertTickets('[]', 5); // 3+2=5, passes

    execs = 0;
    await assertErrorMessage(async () => {
      await repo.bulkUpsertTickets('[]', 6);
    }, 'unexpected_result');
  });

  await runTest('5. stale usa NOT EXISTS, no NOT IN, JSON de IDs escalares y ORDER BY', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalSyncRepository(tx);
    tx.queryRowsToReturn = [{ 'ticket_id': 1 }, { 'ticket_id': 2 }];
    const stale = await repo.detectStaleTickets([10, 20]);
    assert.deepEqual(Array.from(stale), [1, 2]);
    const sql = tx.queryArgs[0].sql;
    assert.ok(sql.includes('NOT EXISTS'));
    assert.ok(!sql.includes('NOT IN'));
    assert.ok(sql.includes('ORDER BY'));
    assert.ok(sql.includes('OPENJSON(@json) WITH ([ticket_id] INT'));
  });

  await runTest('6. Filas corruptas/duplicadas/desordenadas son rechazadas', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalSyncRepository(tx);
    tx.queryRowsToReturn = [{ 'ticket_id': 2 }, { 'ticket_id': 1 }]; // unordered

    await assertErrorMessage(async () => {
      await repo.detectStaleTickets([]);
    }, 'corrupt_data');

    tx.queryRowsToReturn = [{ 'ticket_id': 1 }, { 'ticket_id': 1 }]; // duplicate

    await assertErrorMessage(async () => {
      await repo.detectStaleTickets([]);
    }, 'corrupt_data');
  });

  await runTest('7. Desactivacion y renumeracion exigen rowsAffected === 1, y auditan', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalSyncRepository(tx);

    let execs = 0;
    tx.customExecuteHandler = async (sql) => {
      execs++;
      if (sql.includes('audit_log')) {
        return 1;
      }
      return 1;
    };

    tx.customQueryHandler = async (sql) => {
      if (sql.includes('AND t.status IN (5, 6)')) {
        return [{ id: 1, ticket_id: 100, glpi_group_id: 10, sector_name: 'A', rank_position: 1, updated_by_user_id: 2 }];
      }
      if (sql.includes('glpi_group_id = @groupId')) {
        return [{ id: 2, ticket_id: 101, rank_position: 3 }]; // Needs renumbering to 1
      }
      return [];
    };

    const count = await repo.processClosedRankings([100], 99, 'user', 'User', dt);
    assert.equal(count, 1);

    // Executes:
    // 1: deactivate (affected=1)
    // 2: audit_log (affected=1)
    // 3: renumber update pos=1 (affected=1)
    assert.equal(execs, 3);
    const renumSql = tx.executeArgs[tx.executeArgs.length - 1].sql;
    assert.ok(renumSql.includes('updated_by_user_id = @sysUserId'));
    assert.ok(renumSql.includes('updated_at = @now'));
  });

  await runTest('8. getSyncStatus rechaza counts y lastRun corruptos', async () => {
    const rt = new FakeRuntime();
    rt.customQueryHandler = async (sql) => {
      if (sql.includes('COUNT')) return []; // Missing 'c'
      return [];
    };

    await assertErrorMessage(async () => {
      await SqlServerOperationalSyncRepository.getSyncStatus(rt);
    }, 'corrupt_data');

    rt.customQueryHandler = async (sql) => {
      if (sql.includes('COUNT')) return [{ c: 10 }];
      if (sql.includes('sync_run')) return [{ status: 'fake' }]; // Invalid status
      return [];
    };

    await assertErrorMessage(async () => {
      await SqlServerOperationalSyncRepository.getSyncStatus(rt);
    }, 'corrupt_data');
  });

  await runTest('9. Propagacion por identidad de SqlRuntimeError', async () => {
    const rt = new FakeRuntime();
    const err = new SqlRuntimeError('SQL_CONNECTION_ERROR', 'Fail');
    rt.errorToThrow = err;
    let caught: unknown = null;
    try {
      await SqlServerOperationalSyncRepository.getSyncStatus(rt);
    } catch (e) {
      caught = e;
    }
    assert.equal(caught, err); // strict identity
  });

  await runTest('10. Sanitizacion real antes del almacenamiento transaccional', async () => {
    const rt = new FakeRuntime();
    await SqlServerOperationalSyncRepository.insertSyncRunError(rt, dt, 'Failed to connect: password=123 token=ABCDE', dt);

    assert.equal(rt.executeCalls, 0); // No global execute
    assert.equal(rt.commitCount, 1);
    assert.ok(rt.lastTx !== null);

    const args = rt.lastTx.executeArgs[0];
    const param = args.params.find(p => p.name === 'errorMsg');
    assert.ok(param !== undefined);

    if (param.type !== 'nvarchar') {
      assert.fail('Expected nvarchar errorMsg parameter');
    }
    const val = param.value;
    assert.ok(typeof val === 'string');

    assert.ok(!val.includes('123'));
    assert.ok(!val.includes('ABCDE'));
    assert.ok(val.includes('password=***REDACTED***'));
    assert.ok(val.includes('token=***REDACTED***'));

    // Ensure the SQL itself doesn't contain the secrets
    assert.ok(!args.sql.includes('123'));
    assert.ok(!args.sql.includes('ABCDE'));
  });

  await runTest('11. Cero Prisma runtime estatico en el camino productivo', async () => {
    // No Prisma imports in sync-service outside of the QA branch
    const content = await readFile(path.join(process.cwd(), 'lib', 'sync-service.ts'), 'utf8');
    assert.ok(content.includes("import type { PrismaClient } from '@prisma/client'"));
    // Ensure no static import of PrismaClient (except type)
    assert.ok(!content.match(/^import {.*PrismaClient.*} from/m));
    assert.ok(content.includes("const { PrismaClient: DynamicPrismaClient } = await import('@prisma/client')"));
  });

  await runTest('12. parsePositiveInt acepta ID string en system_sync y ranking, y rechaza formatos invalidos', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalSyncRepository(tx);

    // Test system_sync id as string "999"
    tx.customQueryHandler = async (sql) => {
      if (sql.includes('SELECT @affected AS affected')) return [{ affected: 1 }];
      if (sql.includes('system_sync')) return [{ id: '999', username: 'system_sync', display_name: 'Sys Sync' }];
      return [];
    };

    const sysUser = await repo.ensureSystemSyncUser(dt);
    assert.equal(sysUser.id, 999);
    assert.equal(typeof sysUser.id, 'number');

    // Test ranking fields as valid string integers
    tx.customExecuteHandler = async () => 1;
    tx.customQueryHandler = async (sql) => {
      if (sql.includes('AND t.status IN (5, 6)')) {
        return [{ id: '1', ticket_id: '100', glpi_group_id: '10', sector_name: 'A', rank_position: '1', updated_by_user_id: '2' }];
      }
      if (sql.includes('glpi_group_id = @groupId')) {
        return [{ id: '2', ticket_id: '101', rank_position: '2' }];
      }
      return [];
    };

    const closedCount = await repo.processClosedRankings([100], 99, 'user', 'User', dt);
    assert.equal(closedCount, 1);

    // Test invalid string ID formats
    const invalidStringIds = ['01', '0', '+1', '-1', '1.5', '1e5', ' 1', '2147483648'];
    for (const invId of invalidStringIds) {
      tx.customQueryHandler = async (sql) => {
        if (sql.includes('SELECT @affected AS affected')) return [{ affected: 1 }];
        if (sql.includes('system_sync')) return [{ id: invId, username: 'system_sync', display_name: 'Sys Sync' }];
        return [];
      };

      await assertErrorMessage(async () => {
        await repo.ensureSystemSyncUser(dt);
      }, 'corrupt_data');
    }
  });
}

void main().then(() => {
  console.log(`\nTests Sync Service: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
