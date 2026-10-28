import { AsyncLocalStorage } from 'node:async_hooks';
import type { PrioGlpiSqlConfig } from '../config/prioglpi-sql-config';
import {
  SqlRuntimeError,
  type ISqlServerRuntime,
  type ISqlServerTransaction,
  type SqlParameter,
  type SqlRow,
  type TransactionOptions,
  type ISqlServerRuntimeDriver,
  type ISqlServerRuntimeConnection,
  type ISqlServerRuntimeRequest
} from './sqlserver-runtime-contract';

export function applyBeforeConnectStrict(conn: unknown, trustCert: boolean): void {
  if (!conn || typeof conn !== 'object' || !('conn_str' in conn) || typeof (conn as {conn_str: unknown}).conn_str !== 'string') {
    throw new Error('Estructura interna de conexion SQL no valida o no interceptable.');
  }
  const originalStr = (conn as {conn_str: string}).conn_str;
  const parts = originalStr.split(';');
  const newParts: string[] = [];
  let trustedConnectionCount = 0;
  let encryptCount = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (part === '') continue;
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) {
      newParts.push(part);
      continue;
    }
    const key = part.substring(0, eqIndex).trim();
    const value = part.substring(eqIndex + 1).trim();
    const upperKey = key.toUpperCase();
    if (upperKey === 'UID' || upperKey === 'USER ID' || upperKey === 'PWD' || upperKey === 'PASSWORD' || upperKey === 'DOMAIN') {
      if (value !== '') throw new Error('La cadena de conexion SQL generada expone credenciales prohibidas.');
      continue;
    }
    if (upperKey === 'TRUSTED_CONNECTION') {
      if (value.toUpperCase() !== 'YES') throw new Error('La cadena de conexion SQL generada no contiene autenticacion integrada correcta.');
      trustedConnectionCount++;
      newParts.push(part);
      continue;
    }
    if (upperKey === 'ENCRYPT') {
      if (value.toUpperCase() !== 'YES') throw new Error('La cadena de conexion SQL generada no contiene cifrado correcto.');
      encryptCount++;
      newParts.push(part);
      continue;
    }
    if (upperKey === 'TRUSTSERVERCERTIFICATE') continue;
    newParts.push(part);
  }

  if (trustedConnectionCount !== 1) throw new Error('La cadena de conexion SQL generada no contiene autenticacion integrada correcta.');
  if (encryptCount !== 1) throw new Error('La cadena de conexion SQL generada no contiene cifrado correcto.');

  newParts.push(`TrustServerCertificate=${trustCert ? 'Yes' : 'No'}`);
  (conn as {conn_str: string}).conn_str = newParts.join(';');
}

export function validateSqlParameters(input: unknown): asserts input is readonly SqlParameter[] {
  if (!Array.isArray(input)) throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Parameters must be an array.');
  if (input.length > 2100) throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Too many parameters.');

  const names = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const p = input[i];
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Invalid parameter object.');
    }

    const name = (p as Record<string, unknown>).name;
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Invalid parameter name.');
    }

    const lowerName = name.toLowerCase();
    if (names.has(lowerName)) {
      throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Duplicate parameter name.');
    }
    names.add(lowerName);

    const nullable = (p as Record<string, unknown>).nullable;
    if (typeof nullable !== 'boolean') {
      throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Nullable must be boolean.');
    }

    const value = (p as Record<string, unknown>).value;
    if (value === null) {
      if (!nullable) throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Null value not allowed.');
    }

    const type = (p as Record<string, unknown>).type;
    if (type === 'varchar' || type === 'nvarchar') {
      if (value !== null && typeof value !== 'string') throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'String expected.');
      const length = (p as Record<string, unknown>).length;
      if (length !== 'MAX' && (!Number.isInteger(length) || (length as number) < 1)) throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Invalid length.');
      if (type === 'varchar' && length !== 'MAX' && (length as number) > 8000) throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Invalid length.');
      if (type === 'nvarchar' && length !== 'MAX' && (length as number) > 4000) throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Invalid length.');
      if (value !== null && typeof value === 'string' && length !== 'MAX' && value.length > (length as number)) {
        throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'String length exceeds maximum.');
      }
    } else if (type === 'uniqueidentifier') {
      if (value !== null) {
        if (typeof value !== 'string') throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'String UUID expected.');
        if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
          throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Invalid UUID format.');
        }
      }
    } else if (type === 'int') {
      if (value !== null) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
          throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Invalid int.');
        }
      }
    } else if (type === 'bigint') {
      if (value !== null) {
        if (typeof value !== 'bigint' || value < -9223372036854775808n || value > 9223372036854775807n) {
          throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Invalid bigint.');
        }
      }
    } else if (type === 'bit') {
      if (value !== null) {
        if (typeof value !== 'boolean') throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Invalid bit.');
      }
    } else if (type === 'datetime2') {
      const scale = (p as Record<string, unknown>).scale;
      if (typeof scale !== 'number' || !Number.isInteger(scale) || scale < 0 || scale > 7) {
        throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Invalid scale.');
      }
      if (value !== null) {
        if (!(value instanceof Date) || isNaN(value.getTime())) {
          throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Invalid datetime2.');
        }
      }
    } else {
      throw new SqlRuntimeError('SQL_INVALID_PARAMETER', 'Invalid type.');
    }
  }
}

function validateSqlString(sql: unknown): asserts sql is string {
  if (typeof sql !== 'string' || sql.trim() === '') {
    throw new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'Invalid SQL text.');
  }
}

function isSqlRow(value: unknown): value is SqlRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRecordset(recordset: unknown): SqlRow[] {
  if (!Array.isArray(recordset)) throw new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'Invalid recordset.');
  const rows: SqlRow[] = [];
  for (let i = 0; i < recordset.length; i++) {
    const row = recordset[i];
    if (!isSqlRow(row)) throw new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'Invalid row in recordset.');
    rows.push(row);
  }
  return rows;
}

function validateRowsAffected(rowsAffected: unknown): number {
  if (!Array.isArray(rowsAffected)) throw new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'Invalid rowsAffected.');
  let sum = 0;
  for (let i = 0; i < rowsAffected.length; i++) {
    const val = rowsAffected[i];
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) throw new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'Invalid row count.');
    sum += val;
  }
  if (!Number.isSafeInteger(sum)) throw new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'rowsAffected sum exceeds safe integer.');
  return sum;
}

const transactionContext = new AsyncLocalStorage<boolean>();

export class SqlServerRuntime implements ISqlServerRuntime {
  private poolPromise: Promise<ISqlServerRuntimeConnection> | null = null;
  private closePromise: Promise<void> | null = null;
  private isClosed: boolean = false;

  constructor(private config: PrioGlpiSqlConfig, private driver: ISqlServerRuntimeDriver) {}

  private getPool(): Promise<ISqlServerRuntimeConnection> {
    if (this.isClosed || this.closePromise) return Promise.reject(new SqlRuntimeError('SQL_CONNECTION_ERROR', 'Runtime is closed or closing.'));

    if (!this.poolPromise) {
      const sqlConfig = {
        server: this.config.server,
        port: this.config.port,
        database: this.config.database,
        driver: this.config.odbcDriver,
        connectionTimeout: this.config.connectionTimeoutMs,
        requestTimeout: this.config.requestTimeoutMs,
        options: {
          trustedConnection: this.config.trustedConnection,
          encrypt: this.config.encrypt,
        },
        pool: {
          max: this.config.poolMax,
          min: 0,
          idleTimeoutMillis: 30000
        },
        beforeConnect: (conn: unknown) => {
          applyBeforeConnectStrict(conn, this.config.trustServerCertificate);
        }
      };

      this.poolPromise = this.driver.connect(sqlConfig).catch(() => {
        this.poolPromise = null;
        throw new SqlRuntimeError('SQL_CONNECTION_ERROR', 'Error de conexion SQL.');
      });
    }
    return this.poolPromise;
  }

  private mapSqlType(p: SqlParameter) {
    const types = this.driver.getTypes();
    switch (p.type) {
      case 'varchar': return types.VarChar(p.length);
      case 'nvarchar': return types.NVarChar(p.length);
      case 'uniqueidentifier': return types.UniqueIdentifier();
      case 'int': return types.Int();
      case 'bigint': return types.BigInt();
      case 'bit': return types.Bit();
      case 'datetime2': return types.DateTime2(p.scale);
    }
  }

  private prepareRequest(request: ISqlServerRuntimeRequest, params: readonly SqlParameter[]): void {
    for (const p of params) {
      request.input(p.name, this.mapSqlType(p), p.value);
    }
  }

  async query(queryString: unknown, params: unknown = []): Promise<SqlRow[]> {
    if (transactionContext.getStore()) {
      throw new SqlRuntimeError('SQL_TRANSACTION_SESSION_REQUIRED', 'Direct runtime queries are forbidden inside a transaction block.');
    }
    validateSqlString(queryString);
    validateSqlParameters(params);

    try {
      const pool = await this.getPool();
      const request = pool.request();
      this.prepareRequest(request, params);
      const result = await request.query(queryString);
      return validateRecordset(result.recordset);
    } catch (err: any) {
      if (err instanceof SqlRuntimeError) throw err;
      throw new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', `Error ejecutando consulta SQL PrioGLPI: ${err?.message || 'Unknown'}`);
    }
  }

  async execute(queryString: unknown, params: unknown = []): Promise<number> {
    if (transactionContext.getStore()) {
      throw new SqlRuntimeError('SQL_TRANSACTION_SESSION_REQUIRED', 'Direct runtime executions are forbidden inside a transaction block.');
    }
    validateSqlString(queryString);
    validateSqlParameters(params);

    try {
      const pool = await this.getPool();
      const request = pool.request();
      this.prepareRequest(request, params);
      const result = await request.query(queryString);
      return validateRowsAffected(result.rowsAffected);
    } catch (err) {
      if (err instanceof SqlRuntimeError) throw err;
      throw new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'Error ejecutando operacion SQL PrioGLPI');
    }
  }

  async withTransaction<T>(options: TransactionOptions | undefined, callback: (tx: ISqlServerTransaction) => Promise<T>): Promise<T> {
    if (transactionContext.getStore()) {
      throw new SqlRuntimeError('SQL_NESTED_TRANSACTION_UNSUPPORTED', 'Anidacion de transacciones no soportada.');
    }

    const pool = await this.getPool();
    const transaction = pool.transaction();
    const types = this.driver.getTypes();

    let isolation = undefined;
    if (options?.isolation === 'read_committed') isolation = types.ISOLATION_LEVEL.READ_COMMITTED;
    if (options?.isolation === 'repeatable_read') isolation = types.ISOLATION_LEVEL.REPEATABLE_READ;
    if (options?.isolation === 'serializable') isolation = types.ISOLATION_LEVEL.SERIALIZABLE;

    try {
      await transaction.begin(isolation);
    } catch {
      throw new SqlRuntimeError('SQL_CONNECTION_ERROR', 'Error al iniciar la transaccion SQL');
    }

    let isClosed = false;

    const txSession: ISqlServerTransaction = {
      query: async (queryString: unknown, params: unknown = []) => {
        if (isClosed) throw new SqlRuntimeError('SQL_TRANSACTION_ALREADY_CLOSED', 'La transaccion ya esta cerrada.');
        validateSqlString(queryString);
        validateSqlParameters(params);
        try {
          const request = transaction.request();
          this.prepareRequest(request, params);
          const result = await request.query(queryString);
          return validateRecordset(result.recordset);
        } catch (err) {
          if (err instanceof SqlRuntimeError) throw err;
          console.error('[SQL QUERY ERROR]', err);
          throw new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'Error ejecutando consulta en transaccion SQL');
        }
      },
      execute: async (queryString: unknown, params: unknown = []) => {
        if (isClosed) throw new SqlRuntimeError('SQL_TRANSACTION_ALREADY_CLOSED', 'La transaccion ya esta cerrada.');
        validateSqlString(queryString);
        validateSqlParameters(params);
        try {
          const request = transaction.request();
          this.prepareRequest(request, params);
          const result = await request.query(queryString);
          return validateRowsAffected(result.rowsAffected);
        } catch (err) {
          if (err instanceof SqlRuntimeError) throw err;
          console.error('[SQL EXECUTE ERROR]', err);
          throw new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'Error ejecutando operacion en transaccion SQL');
        }
      }
    };

    return transactionContext.run(true, async () => {
      let result: T;
      try {
        result = await callback(txSession);
      } catch (callbackError) {
        if (isClosed) throw callbackError;
        isClosed = true;
        try {
          await transaction.rollback();
        } catch {
          throw new SqlRuntimeError('SQL_TRANSACTION_ROLLBACK_FAILED', 'Rollback failed', callbackError instanceof Error ? callbackError : new Error(String(callbackError)));
        }
        throw callbackError;
      }

      if (isClosed) throw new SqlRuntimeError('SQL_TRANSACTION_ALREADY_CLOSED', 'La transaccion ya fue cerrada por un error previo.');
      isClosed = true;
      try {
        await transaction.commit();
        return result;
      } catch {
        throw new SqlRuntimeError('SQL_TRANSACTION_COMMIT_STATE_UNKNOWN', 'El estado del commit es incierto tras un fallo de red o del driver.');
      }
    });
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    if (this.closePromise) return this.closePromise;

    if (this.poolPromise) {
      this.closePromise = this.poolPromise.then(async (pool) => {
        try {
          await pool.close();
        } catch {
          throw new SqlRuntimeError('SQL_CONNECTION_ERROR', 'Error al cerrar el pool SQL');
        } finally {
          this.poolPromise = null;
          this.isClosed = true;
        }
      }, () => {
        this.poolPromise = null;
        this.isClosed = true;
      });
      return this.closePromise;
    } else {
      this.isClosed = true;
    }
  }
}
