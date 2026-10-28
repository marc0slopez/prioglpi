import sql from 'mssql/msnodesqlv8';
import type {
  ISqlServerRuntimeDriver,
  ISqlServerRuntimeConnection,
  ISqlServerTypes
} from './sqlserver-runtime-contract';

export class MsNodeSqlV8RuntimeDriver implements ISqlServerRuntimeDriver {
  async connect(config: unknown): Promise<ISqlServerRuntimeConnection> {
    const pool = await new sql.ConnectionPool(config as sql.config).connect();

    return {
      close: async () => {
        await pool.close();
      },
      request: () => {
        const req = pool.request();
        return {
          input: (name: string, type: unknown, value: unknown) => {
            req.input(name, type as sql.ISqlType, value);
          },
          query: async (sqlStr: string) => {
            const res = await req.query(sqlStr);
            return {
              recordset: res.recordset,
              rowsAffected: res.rowsAffected
            };
          }
        };
      },
      transaction: () => {
        const tx = pool.transaction();
        return {
          begin: async (isolation?: unknown) => {
            await tx.begin(isolation as sql.IIsolationLevel);
          },
          commit: async () => {
            await tx.commit();
          },
          rollback: async () => {
            await tx.rollback();
          },
          request: () => {
            const req = tx.request();
            return {
              input: (name: string, type: unknown, value: unknown) => {
                req.input(name, type as sql.ISqlType, value);
              },
              query: async (sqlStr: string) => {
                const res = await req.query(sqlStr);
                return {
                  recordset: res.recordset,
                  rowsAffected: res.rowsAffected
                };
              }
            };
          }
        };
      }
    };
  }

  getTypes(): ISqlServerTypes {
    return {
      VarChar: (length: number | 'MAX') => length === 'MAX' ? sql.VarChar(sql.MAX) : sql.VarChar(length),
      NVarChar: (length: number | 'MAX') => length === 'MAX' ? sql.NVarChar(sql.MAX) : sql.NVarChar(length),
      UniqueIdentifier: () => sql.UniqueIdentifier(),
      Int: () => sql.Int(),
      BigInt: () => sql.BigInt(),
      Bit: () => sql.Bit(),
      DateTime2: (scale: number) => sql.DateTime2(scale),
      ISOLATION_LEVEL: {
        READ_COMMITTED: sql.ISOLATION_LEVEL.READ_COMMITTED,
        REPEATABLE_READ: sql.ISOLATION_LEVEL.REPEATABLE_READ,
        SERIALIZABLE: sql.ISOLATION_LEVEL.SERIALIZABLE
      }
    };
  }
}
