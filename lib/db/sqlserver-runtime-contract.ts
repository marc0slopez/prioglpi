export type SqlServerRuntimeErrorCode =
  | 'SQL_TRANSACTION_ROLLBACK_FAILED'
  | 'SQL_TRANSACTION_COMMIT_STATE_UNKNOWN'
  | 'SQL_TRANSACTION_ALREADY_CLOSED'
  | 'SQL_INVALID_PARAMETER'
  | 'SQL_CONNECTION_ERROR'
  | 'SQL_QUERY_EXECUTION_ERROR'
  | 'SQL_NESTED_TRANSACTION_UNSUPPORTED'
  | 'SQL_TRANSACTION_SESSION_REQUIRED';

export class SqlRuntimeError extends Error {
  constructor(public code: SqlServerRuntimeErrorCode, message: string, public cause?: Error) {
    super(message);
    this.name = 'SqlRuntimeError';
  }
}

export type SqlRow = Readonly<Record<string, unknown>>;

export type SqlParameter =
  | { name: string; type: 'varchar'; nullable: boolean; value: string | null; length: number | 'MAX' }
  | { name: string; type: 'nvarchar'; nullable: boolean; value: string | null; length: number | 'MAX' }
  | { name: string; type: 'uniqueidentifier'; nullable: boolean; value: string | null }
  | { name: string; type: 'int'; nullable: boolean; value: number | null }
  | { name: string; type: 'bigint'; nullable: boolean; value: bigint | null }
  | { name: string; type: 'bit'; nullable: boolean; value: boolean | null }
  | { name: string; type: 'datetime2'; nullable: boolean; value: Date | null; scale: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 };

export interface ISqlServerSession {
  query(sql: string, params?: SqlParameter[]): Promise<SqlRow[]>;
  execute(sql: string, params?: SqlParameter[]): Promise<number>;
}

export type ISqlServerTransaction = ISqlServerSession;

export interface TransactionOptions {
  isolation?: 'read_committed' | 'repeatable_read' | 'serializable';
}

export interface ISqlServerRuntime extends ISqlServerSession {
  withTransaction<T>(options: TransactionOptions | undefined, callback: (tx: ISqlServerTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Interfaces to abstract the underlying mssql driver for offline testing
export interface ISqlServerRuntimeDriver {
  connect(config: unknown): Promise<ISqlServerRuntimeConnection>;
  getTypes(): ISqlServerTypes;
}

export interface ISqlServerRuntimeConnection {
  close(): Promise<void>;
  request(): ISqlServerRuntimeRequest;
  transaction(): ISqlServerRuntimeTransaction;
}

export interface ISqlServerRuntimeRequest {
  input(name: string, type: unknown, value: unknown): void;
  query(sql: string): Promise<{ recordset: unknown[]; rowsAffected: number[] }>;
}

export interface ISqlServerRuntimeTransaction {
  begin(isolation?: unknown): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  request(): ISqlServerRuntimeRequest;
}

export interface ISqlServerTypes {
  VarChar(length: number | 'MAX'): unknown;
  NVarChar(length: number | 'MAX'): unknown;
  UniqueIdentifier(): unknown;
  Int(): unknown;
  BigInt(): unknown;
  Bit(): unknown;
  DateTime2(scale: number): unknown;
  ISOLATION_LEVEL: {
    READ_COMMITTED: unknown;
    REPEATABLE_READ: unknown;
    SERIALIZABLE: unknown;
  };
}
