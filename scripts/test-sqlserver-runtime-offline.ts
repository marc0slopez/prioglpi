import assert from 'node:assert/strict';
import type { PrioGlpiSqlConfig } from '../lib/config/prioglpi-sql-config';
import { SqlServerRuntime, validateSqlParameters } from '../lib/db/sqlserver-runtime';
import { SqlRuntimeError, type ISqlServerRuntimeDriver, type ISqlServerTypes, type ISqlServerRuntimeConnection, type ISqlServerRuntimeRequest, type ISqlServerRuntimeTransaction, type SqlServerRuntimeErrorCode, type ISqlServerTransaction } from '../lib/db/sqlserver-runtime-contract';

class FakeDriver implements ISqlServerRuntimeDriver {
  public connectAttempts = 0;
  public successfulConnections = 0;
  public failConnect = false;

  public configs: unknown[] = [];
  public currentConnection: FakeConnection | null = null;
  public transactions: FakeTransaction[] = [];

  async connect(config: unknown): Promise<ISqlServerRuntimeConnection> {
    this.connectAttempts++;
    this.configs.push(config);
    if (this.failConnect) throw new Error('Driver connect failed');
    this.successfulConnections++;
    this.currentConnection = new FakeConnection(this);
    return this.currentConnection;
  }

  getTypes(): ISqlServerTypes {
    return {
      VarChar: (length: number | 'MAX') => `VarChar(${length})`,
      NVarChar: (length: number | 'MAX') => `NVarChar(${length})`,
      UniqueIdentifier: () => 'UniqueIdentifier',
      Int: () => 'Int',
      BigInt: () => 'BigInt',
      Bit: () => 'Bit',
      DateTime2: (scale: number) => `DateTime2(${scale})`,
      ISOLATION_LEVEL: {
        READ_COMMITTED: 'READ_COMMITTED',
        REPEATABLE_READ: 'REPEATABLE_READ',
        SERIALIZABLE: 'SERIALIZABLE'
      }
    };
  }
}

class FakeConnection implements ISqlServerRuntimeConnection {
  public closeCalls = 0;
  public failClose = false;
  public closePromise: Promise<void> | null = null;

  constructor(public driver: FakeDriver) {}

  async close(): Promise<void> {
    this.closeCalls++;
    if (this.failClose) throw new Error('Driver close failed');
    if (this.closePromise) await this.closePromise;
  }

  request(): ISqlServerRuntimeRequest {
    return new FakeRequest();
  }

  transaction(): ISqlServerRuntimeTransaction {
    const tx = new FakeTransaction();
    this.driver.transactions.push(tx);
    return tx;
  }
}

class FakeTransaction implements ISqlServerRuntimeTransaction {
  public beginCalls = 0;
  public commitCalls = 0;
  public rollbackCalls = 0;
  public failBegin = false;
  public failCommit = false;
  public failRollback = false;
  public beginIsolation: unknown = undefined;

  async begin(isolation?: unknown): Promise<void> {
    this.beginCalls++;
    this.beginIsolation = isolation;
    if (this.failBegin) throw new Error('Driver begin failed');
  }

  async commit(): Promise<void> {
    this.commitCalls++;
    if (this.failCommit) throw new Error('Driver commit failed');
  }

  async rollback(): Promise<void> {
    this.rollbackCalls++;
    if (this.failRollback) throw new Error('Driver rollback failed');
  }

  request(): ISqlServerRuntimeRequest {
    return new FakeRequest();
  }
}

class FakeRequest implements ISqlServerRuntimeRequest {
  public static requests = 0;
  public static inputs: Record<string, unknown>[] = [];
  public static queries: string[] = [];

  public failQuery = false;

  constructor() {
    FakeRequest.requests++;
  }

  input(name: string, type: unknown, value: unknown): void {
    FakeRequest.inputs.push({ name, type, value });
  }

  async query(sql: string): Promise<{ recordset: unknown[]; rowsAffected: number[] }> {
    FakeRequest.queries.push(sql);
    if (this.failQuery) throw new Error('Driver query failed');
    return { recordset: [{ dummy: 1 }], rowsAffected: [1] };
  }
}

const baseConfig: PrioGlpiSqlConfig = {
  server: 'test', port: 1433, database: 'PrioGLPI_Test', odbcDriver: 'ODBC Driver 18 for SQL Server', trustedConnection: true, encrypt: true, trustServerCertificate: true, poolMax: 10, connectionTimeoutMs: 1000, requestTimeoutMs: 1000
};

function hasSqlRuntimeCode(error: unknown, code: SqlServerRuntimeErrorCode): boolean {
  return error instanceof SqlRuntimeError && error.code === code;
}

function isRollbackFailureWithCause(error: unknown, expectedCause: Error): boolean {
  return error instanceof SqlRuntimeError &&
    error.code === 'SQL_TRANSACTION_ROLLBACK_FAILED' &&
    error.cause === expectedCause;
}

let passed = 0;
let failed = 0;

async function runTest(name: string, testFn: (driver: FakeDriver, runtime: SqlServerRuntime) => Promise<void>) {
  const driver = new FakeDriver();
  const runtime = new SqlServerRuntime(baseConfig, driver);
  FakeRequest.requests = 0;
  FakeRequest.inputs = [];
  FakeRequest.queries = [];

  let testError: unknown = undefined;
  try {
    await testFn(driver, runtime);
  } catch (err: unknown) {
    testError = err;
  }

  let closeError: unknown = undefined;
  try {
    await runtime.close();
  } catch (err: unknown) {
    closeError = err;
  }

  if (testError && closeError) {
    failed++;
    console.error(`[FAIL] ${name}`);
    throw new Error('El test y runtime.close() fallaron simultaneamente. Se ocultan los errores crudos.');
  }

  if (testError) {
    failed++;
    console.error(`[FAIL] ${name}`);
    throw testError;
  }

  if (closeError) {
    failed++;
    console.error(`[FAIL] ${name}`);
    throw closeError;
  }

  passed++;
  console.log(`[PASS] ${name}`);
}

async function main() {
  await runTest('cero aperturas antes de la primera query', async (driver) => {
    assert.equal(driver.connectAttempts, 0);
  });

  await runTest('lazy pool - dos queries concurrentes usan la misma conexion', async (driver, runtime) => {
    const p1 = runtime.query('SELECT 1');
    const p2 = runtime.query('SELECT 2');
    await Promise.all([p1, p2]);
    assert.equal(driver.successfulConnections, 1);
    assert.equal(driver.connectAttempts, 1);
    assert.equal(FakeRequest.requests, 2);
  });

  await runTest('parametros validos de cada tipo', async (driver, runtime) => {
    await runtime.query('SELECT 1', [
      { name: 'v', type: 'varchar', nullable: true, value: 'test', length: 'MAX' },
      { name: 'nv', type: 'nvarchar', nullable: false, value: 'test', length: 100 },
      { name: 'u', type: 'uniqueidentifier', nullable: false, value: '12345678-1234-1234-1234-1234567890ab' },
      { name: 'i', type: 'int', nullable: false, value: 42 },
      { name: 'b', type: 'bigint', nullable: false, value: 42n },
      { name: 'bt', type: 'bit', nullable: false, value: true },
      { name: 'dt', type: 'datetime2', nullable: false, value: new Date(), scale: 7 },
      { name: 'bmin', type: 'bigint', nullable: false, value: -9223372036854775808n },
      { name: 'bmax', type: 'bigint', nullable: false, value: 9223372036854775807n },
      { name: 'dtnull', type: 'datetime2', nullable: true, value: null, scale: 0 }
    ]);
    assert.equal(FakeRequest.inputs.length, 10);
  });

  await runTest('parametros invalidos no abren conexion', async (driver, runtime) => {
    await assert.rejects(
      runtime.query('SELECT 1', [{ name: 'invalid_name!', type: 'int', nullable: false, value: 1 }]),
      (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER')
    );
    assert.equal(driver.connectAttempts, 0);
  });

  await runTest('propagacion de aislamiento', async (driver, runtime) => {
    await runtime.withTransaction({ isolation: 'serializable' }, async () => {
      assert.equal(driver.transactions.length, 1);
      assert.equal(driver.transactions[0].beginCalls, 1);
      assert.equal(driver.transactions[0].beginIsolation, 'SERIALIZABLE');
    });
  });

  await runTest('semantica transaccional completa (commit)', async (driver, runtime) => {
    let executed = false;
    await runtime.withTransaction(undefined, async (tx) => {
      executed = true;
      await tx.query('SELECT 1');
    });
    assert.ok(executed);
    assert.equal(driver.transactions[0].commitCalls, 1);
    assert.equal(driver.transactions[0].rollbackCalls, 0);
  });

  await runTest('semantica transaccional completa (rollback)', async (driver, runtime) => {
    const error = new Error('dominial');
    await assert.rejects(
      runtime.withTransaction(undefined, async () => {
        throw error;
      }),
      (err: unknown) => err === error
    );
    assert.equal(driver.transactions[0].rollbackCalls, 1);
    assert.equal(driver.transactions[0].commitCalls, 0);
  });

  await runTest('bloqueo de runtime.query dentro de tx', async (driver, runtime) => {
    await runtime.withTransaction(undefined, async () => {
      await assert.rejects(
        runtime.query('SELECT 1'),
        (err: unknown) => hasSqlRuntimeCode(err, 'SQL_TRANSACTION_SESSION_REQUIRED')
      );
      await assert.rejects(
        runtime.execute('SELECT 1'),
        (err: unknown) => hasSqlRuntimeCode(err, 'SQL_TRANSACTION_SESSION_REQUIRED')
      );
    });
  });

  await runTest('transacciones raiz concurrentes independientes', async (driver, runtime) => {
    const p1 = runtime.withTransaction(undefined, async () => { await new Promise(r => setTimeout(r, 10)); });
    const p2 = runtime.withTransaction(undefined, async () => { await new Promise(r => setTimeout(r, 10)); });
    await Promise.all([p1, p2]);
    assert.equal(driver.transactions.length, 2);
    assert.equal(driver.transactions[0].beginCalls, 1);
    assert.equal(driver.transactions[0].commitCalls, 1);
    assert.equal(driver.transactions[1].beginCalls, 1);
    assert.equal(driver.transactions[1].commitCalls, 1);
  });

  await runTest('close concurrente', async (driver, runtime) => {
    await runtime.query('SELECT 1');
    const p1 = runtime.close();
    const p2 = runtime.close();
    await Promise.all([p1, p2]);
    assert.equal(driver.currentConnection?.closeCalls, 1);
  });

  await runTest('fallo de close', async (driver, runtime) => {
    await runtime.query('SELECT 1');
    if (driver.currentConnection) driver.currentConnection.failClose = true;
    await assert.rejects(runtime.close(), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_CONNECTION_ERROR'));
  });

  await runTest('recuperacion tras connect fallido', async (driver, runtime) => {
    driver.failConnect = true;
    await assert.rejects(runtime.query('SELECT 1'), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_CONNECTION_ERROR'));
    assert.equal(driver.connectAttempts, 1);
    assert.equal(driver.successfulConnections, 0);

    driver.failConnect = false;
    await runtime.query('SELECT 1');
    assert.equal(driver.connectAttempts, 2);
    assert.equal(driver.successfulConnections, 1);
  });

  await runTest('query despues de close', async (driver, runtime) => {
    await runtime.query('SELECT 1'); // open connection
    let resolveClose: () => void;
    driver.currentConnection!.closePromise = new Promise(r => { resolveClose = r; });
    const pClose = runtime.close();

    // Consulta iniciada despues de close() rechazada sin crear otro request
    const reqCountBefore = FakeRequest.requests;
    await assert.rejects(runtime.query('SELECT 1'), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_CONNECTION_ERROR'));
    assert.equal(FakeRequest.requests, reqCountBefore);

    resolveClose!();
    await pClose;
    await assert.rejects(runtime.query('SELECT 1'), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_CONNECTION_ERROR'));
  });

  await runTest('errores sanitizados sin centinelas', async (driver, runtime) => {
    driver.failConnect = true;
    try {
      await runtime.query('SELECT 1');
      assert.fail('Should have thrown');
    } catch (err: unknown) {
      assert.ok(hasSqlRuntimeCode(err, 'SQL_CONNECTION_ERROR'));
      const str = String(err);
      assert.ok(!str.includes('test'));
      assert.ok(!str.includes('PrioGLPI'));
    }
  });

  await runTest('validateSqlParameters - inputs intencionalmente mal tipados', async () => {
    // Tipos invalidos
    assert.throws(() => validateSqlParameters(null), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
    assert.throws(() => validateSqlParameters([null]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
    assert.throws(() => validateSqlParameters([{ name: 123, type: 'int', nullable: false, value: 1 }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'invalid_type', nullable: false, value: 1 }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));

    // Duplicados p1 / P1
    assert.throws(() => validateSqlParameters([
      { name: 'p1', type: 'int', nullable: false, value: 1 },
      { name: 'P1', type: 'int', nullable: false, value: 2 }
    ]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));

    // 2101 parametros
    const paramList: unknown[] = [];
    for (let i = 0; i < 2101; i++) {
      paramList.push({ name: `p${i}`, type: 'int', nullable: false, value: 1 });
    }
    assert.throws(() => validateSqlParameters(paramList), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));

    // int fuera de rango, NaN, Infinity
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'int', nullable: false, value: 1.5 }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'int', nullable: false, value: NaN }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'int', nullable: false, value: Infinity }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'int', nullable: false, value: 2147483648 }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'int', nullable: false, value: -2147483649 }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));

    // bigint fuera de extremos
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'bigint', nullable: false, value: 9223372036854775808n }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'bigint', nullable: false, value: -9223372036854775809n }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));

    // UUID no-string
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'uniqueidentifier', nullable: false, value: 'invalid-uuid' }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'uniqueidentifier', nullable: false, value: 123 }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));

    // bit numerico
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'bit', nullable: false, value: 1 }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));

    // Null con nullable=false
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'int', nullable: false, value: null }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));

    // varchar/nvarchar longitudes invalidas y string que supera length
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'varchar', nullable: false, value: 'test', length: 0 }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'varchar', nullable: false, value: 'test', length: 8001 }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'nvarchar', nullable: false, value: 'test', length: 4001 }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'varchar', nullable: false, value: 'long', length: 2 }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));

    // datetime2 null con scale invalido
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'datetime2', nullable: true, value: null, scale: 8 }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
    assert.throws(() => validateSqlParameters([{ name: 'p1', type: 'datetime2', nullable: true, value: null }]), (err: unknown) => hasSqlRuntimeCode(err, 'SQL_INVALID_PARAMETER'));
  });

  await runTest('rollback fallido conservando error primario', async (driver, runtime) => {
    const error = new Error('dominial');
    await assert.rejects(
      runtime.withTransaction(undefined, async () => {
        driver.transactions[0].failRollback = true;
        throw error;
      }),
      (err: unknown) => isRollbackFailureWithCause(err, error)
    );
  });

  await runTest('commit fallido', async (driver, runtime) => {
    await assert.rejects(
      runtime.withTransaction(undefined, async () => {
        driver.transactions[0].failCommit = true;
      }),
      (err: unknown) => hasSqlRuntimeCode(err, 'SQL_TRANSACTION_COMMIT_STATE_UNKNOWN')
    );
    assert.equal(driver.transactions[0].rollbackCalls, 0);
  });

  await runTest('transaccion anidada rechazada con rollback exterior', async (driver, runtime) => {
    await assert.rejects(
      runtime.withTransaction(undefined, async () => {
        await runtime.withTransaction(undefined, async () => {});
      }),
      (err: unknown) => hasSqlRuntimeCode(err, 'SQL_NESTED_TRANSACTION_UNSUPPORTED')
    );
    assert.equal(driver.transactions[0].rollbackCalls, 1);
  });

  await runTest('query y execute despues del commit rechazada', async (driver, runtime) => {
    const holder: { tx: ISqlServerTransaction | null } = { tx: null };
    await runtime.withTransaction(undefined, async (tx) => {
      holder.tx = tx;
    });

    const capturedTx = holder.tx;
    if (capturedTx === null) {
      throw new Error('La transaccion no fue capturada.');
    }

    await assert.rejects(
      capturedTx.query('SELECT 1'),
      (err: unknown) => hasSqlRuntimeCode(err, 'SQL_TRANSACTION_ALREADY_CLOSED')
    );
    await assert.rejects(
      capturedTx.execute('SELECT 1'),
      (err: unknown) => hasSqlRuntimeCode(err, 'SQL_TRANSACTION_ALREADY_CLOSED')
    );
  });

  console.log(`Tests SQL Server Runtime: ${passed} exitosos, ${failed} fallidos, ${passed + failed} total.`);
}

void main().catch(() => {
  console.error('[FAIL] Suite offline SQL Server runtime.');
  process.exitCode = 1;
});
