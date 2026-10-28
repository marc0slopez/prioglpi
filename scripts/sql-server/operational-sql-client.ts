import sql from 'mssql/msnodesqlv8';
import { parsePrioGlpiSqlConfig } from '../../lib/config/prioglpi-sql-config';
import { applyBeforeConnectStrict } from '../../lib/db/sqlserver-runtime';

export type SqlRowData = Record<string, unknown>;

export interface SqlQueryExecutor {
    query(queryText: string): Promise<sql.IResult<SqlRowData>>;
}

export class OperationalSqlClient implements SqlQueryExecutor {
    private poolPromise: Promise<sql.ConnectionPool> | null = null;
    private pool: sql.ConnectionPool | null = null;

    private async getPool(): Promise<sql.ConnectionPool> {
        if (!this.poolPromise) {
            const config = parsePrioGlpiSqlConfig(process.env as Record<string, string | undefined>);

            const sqlConfig: sql.config = {
                server: config.server,
                port: config.port,
                database: config.database,
                driver: config.odbcDriver,
                connectionTimeout: config.connectionTimeoutMs,
                requestTimeout: config.requestTimeoutMs,
                options: {
                    trustedConnection: config.trustedConnection,
                    encrypt: config.encrypt,
                },
                pool: {
                    max: config.poolMax,
                    min: 0,
                    idleTimeoutMillis: 30000
                },
                beforeConnect: (conn: unknown) => {
                    applyBeforeConnectStrict(conn, config.trustServerCertificate);
                }
            };

            this.poolPromise = new sql.ConnectionPool(sqlConfig).connect().then((p: sql.ConnectionPool) => {
                this.pool = p;
                return p;
            }).catch(() => {
                this.poolPromise = null;
                throw new Error('Error al inicializar pool SQL Server');
            });
        }
        return this.poolPromise;
    }

    public async query(queryText: string): Promise<sql.IResult<SqlRowData>> {
        const p = await this.getPool();
        return p.request().query<SqlRowData>(queryText);
    }

    public async beginSerializableTransaction(): Promise<sql.Transaction> {
        const p = await this.getPool();
        const transaction = new sql.Transaction(p);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        return transaction;
    }

    public async close(): Promise<void> {
        if (this.poolPromise) {
            try {
                const p = await this.poolPromise;
                if (p) {
                    await p.close();
                }
            } catch {
                throw new Error('Error al cerrar la conexion SQL');
            } finally {
                this.poolPromise = null;
                this.pool = null;
            }
        }
    }
}
