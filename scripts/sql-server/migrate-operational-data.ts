import 'dotenv/config';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import * as path from 'path';
import { runPreflight, calculatePhysicalHash } from './preflight-operational-migration';
import { createSnapshot, runVerificationCore, SnapshotData } from './verify-operational-data';
import { OperationalSqlClient, SqlRowData } from './operational-sql-client';
import {
    OPERATIONAL_MANIFEST,
    MIGRATION_LOAD_ORDER,
    parseStrictInteger,
    parseStrictBoolean,
    parseStrictIsoUtc,
    parseStrictString,
    resolveMssqlType,
    formatSqlIdentifier
} from './operational-migration-manifest';

type SqliteDatabase = InstanceType<typeof Database>;

const SQLITE_DB_PATH = path.resolve(process.cwd(), 'data/qa/appglpi-ldap-qa.sqlite');

function checkSqliteFiles() {
    if (fs.existsSync(SQLITE_DB_PATH + '-wal')) throw new Error('Abortando: Archivo -wal detectado');
    if (fs.existsSync(SQLITE_DB_PATH + '-shm')) throw new Error('Abortando: Archivo -shm detectado');
}

export async function migrate(): Promise<void> {
    let sqliteDb: SqliteDatabase | null = null;
    let sqlClient: OperationalSqlClient | null = null;
    let sqliteTransactionActive = false;
    let originalPhysicalHash = '';

    try {
        console.log('Iniciando validacion de preflight...');
        originalPhysicalHash = await runPreflight();

        checkSqliteFiles();

        console.log('Abriendo base de origen en modo lectura consistente...');
        sqliteDb = new Database(SQLITE_DB_PATH, { readonly: true, fileMustExist: true });
        sqliteDb.pragma('query_only = ON');

        console.log('Iniciando transaccion de lectura en SQLite...');
        sqliteDb.prepare('BEGIN').run();
        sqliteTransactionActive = true;

        console.log('Capturando snapshot en memoria...');
        const snapshot: SnapshotData = createSnapshot(sqliteDb);

        console.log('Abriendo conexion destino...');
        sqlClient = new OperationalSqlClient();

        console.log('Iniciando transaccion SERIALIZABLE en SQL Server...');
        const transaction = await sqlClient.beginSerializableTransaction();

        try {
            console.log('Adquiriendo bloqueos exclusivos en tablas destino (TABLOCKX, HOLDLOCK)...');
            for (const t of OPERATIONAL_MANIFEST) {
                const safeName = formatSqlIdentifier(t.sqlServerTable);
                const countRes = await transaction.request().query(`SELECT COUNT_BIG(*) AS row_count FROM ${safeName} WITH (TABLOCKX, HOLDLOCK)`);
                const rowCountStr = String((countRes.recordset[0] as Record<string, unknown>).row_count);
                if (rowCountStr !== '0') {
                    throw new Error('La tabla destino NO esta vacia bajo bloqueo');
                }
            }

            console.log('Migrando datos...');
            for (const tableName of MIGRATION_LOAD_ORDER) {
                const manifest = OPERATIONAL_MANIFEST.find(m => m.sqliteTable === tableName)!;
                const sourceData = snapshot[manifest.sqliteTable];

                if (!sourceData || sourceData.length === 0) continue;

                let identityInsertOn = false;
                const safeName = formatSqlIdentifier(manifest.sqlServerTable);

                if (manifest.hasIdentity) {
                    await transaction.request().query(`SET IDENTITY_INSERT ${safeName} ON`);
                    identityInsertOn = true;
                }

                let maxInsertedId = -1;

                try {
                    for (const row of sourceData) {
                        const req = transaction.request();
                        const colNames: string[] = [];
                        const varNames: string[] = [];

                        for (let idx = 0; idx < manifest.columns.length; idx++) {
                            const col = manifest.columns[idx];
                            const val = row[col.sourceCol];
                            let finalVal: unknown = null;
                            const mssqlType = resolveMssqlType(col.sqlType);

                            if (val !== null && val !== undefined) {
                                switch (col.sqlType.kind) {
                                    case 'int':
                                        finalVal = parseStrictInteger(val);
                                        if (manifest.hasIdentity && col.sourceCol === manifest.primaryKey) {
                                            const idVal = finalVal as number;
                                            if (idVal > maxInsertedId) maxInsertedId = idVal;
                                        }
                                        break;
                                    case 'bit':
                                        finalVal = parseStrictBoolean(val);
                                        break;
                                    case 'datetime2':
                                        const isoStr = parseStrictIsoUtc(val, col.type.startsWith('nullable'), 'source');
                                        if (isoStr) {
                                            finalVal = new Date(isoStr);
                                        }
                                        break;
                                    case 'nvarchar':
                                        const nvarcharLen = col.sqlType.length === 'max' ? undefined : col.sqlType.length as number;
                                        finalVal = parseStrictString(val, nvarcharLen);
                                        break;
                                }
                            } else {
                                if (!col.type.startsWith('nullable')) {
                                    throw new Error('NULL encontrado en columna obligatoria');
                                }
                            }

                            const pName = `p${idx}`;
                            req.input(pName, mssqlType, finalVal);

                            colNames.push(`[${col.targetCol}]`);
                            varNames.push(`@${pName}`);
                        }

                        const insertSql = `INSERT INTO ${safeName} (${colNames.join(', ')}) VALUES (${varNames.join(', ')})`;
                        await req.query(insertSql);
                    }
                } catch (insertErr: unknown) {
                    let insertErrorObj = insertErr instanceof Error ? insertErr : new Error('Desconocido');
                    if (identityInsertOn) {
                        try {
                            await transaction.request().query(`SET IDENTITY_INSERT ${safeName} OFF`);
                        } catch {
                            insertErrorObj = new Error(insertErrorObj.message + ' [Fallo apagado de IDENTITY_INSERT]');
                        }
                    }
                    throw insertErrorObj;
                }

                if (identityInsertOn) {
                    try {
                        await transaction.request().query(`SET IDENTITY_INSERT ${safeName} OFF`);
                    } catch {
                        throw new Error('Fallo apagado de IDENTITY_INSERT en cleanup');
                    }
                }

                if (manifest.hasIdentity && maxInsertedId > -1) {
                    const identCheck = await transaction.request().query(`SELECT IDENT_CURRENT('${safeName}') as curr`);
                    const currStr = String((identCheck.recordset[0] as Record<string, unknown>).curr);
                    if (currStr !== String(maxInsertedId)) {
                        throw new Error('Identidad no se actualizo correctamente. No es MAX(id)');
                    }
                }
            }

            console.log('Validando integridad post-insercion dentro de la transaccion...');
            const txWrapper = {
                query: (q: string) => transaction.request().query<SqlRowData>(q)
            };

            await runVerificationCore(snapshot, txWrapper);

            console.log('Comprobando inmutabilidad fisica antes del COMMIT...');
            const preCommitHash = calculatePhysicalHash(SQLITE_DB_PATH);
            if (preCommitHash !== originalPhysicalHash) {
                throw new Error('El archivo SQLite sufrio modificaciones. ROLLBACK forzado.');
            }
            checkSqliteFiles();

            console.log('Todo validado con exito. Haciendo COMMIT...');

            try {
                await transaction.commit();
            } catch (commitErr: unknown) {
                const cErr = commitErr instanceof Error ? commitErr.message : 'Error desconocido';
                throw new Error(`MIGRATION_COMMIT_STATE_UNKNOWN: El COMMIT fallo (${cErr}). Estado de la base de datos ambiguo.`);
            }

            console.log('MIGRATION_TX_COMMIT_OK');
        } catch (innerErr: unknown) {
            console.error('Error durante la transaccion SQL, ejecutando ROLLBACK...');
            try {
                await transaction.rollback();
            } catch {
                if (innerErr instanceof Error) {
                    innerErr.message += ' [Fallo rollback SQL Server]';
                }
            }
            throw innerErr;
        }

        try {
            console.log('Ejecutando validacion independiente post-commit usando el snapshot persistente...');
            const verifyClient = new OperationalSqlClient();
            let closeFailed = false;
            try {
                await runVerificationCore(snapshot, verifyClient);
            } finally {
                try {
                    await verifyClient.close();
                } catch {
                    closeFailed = true;
                }
            }
            if (closeFailed) throw new Error('Fallo cierre de cliente en verificacion post-commit');

            const postPhysicalHash = calculatePhysicalHash(SQLITE_DB_PATH);
            if (originalPhysicalHash !== postPhysicalHash) {
                throw new Error('ModificaciÃ³n SQLite tras COMMIT.');
            }
        } catch (verifyErr: unknown) {
            const vErr = verifyErr instanceof Error ? verifyErr.message : 'Desconocido';
            throw new Error(`MIGRATION_COMMITTED_POST_VERIFY_FAILED: FallÃ³ la validacion posterior: ${vErr}`);
        }

        // Cierre explÃ­cito para emitir OK al final
        if (sqliteTransactionActive && sqliteDb) {
            sqliteDb.prepare('ROLLBACK').run();
            sqliteTransactionActive = false;
        }
        if (sqliteDb) {
            sqliteDb.close();
            sqliteDb = null;
        }
        if (sqlClient) {
            await sqlClient.close();
            sqlClient = null;
        }

        console.log('MIGRATION_OK');
    } catch (err: unknown) {
        const mainError = err instanceof Error ? err : new Error('Desconocido');
        let cleanupErrorMsg = '';

        try {
            if (sqliteTransactionActive && sqliteDb) {
                sqliteDb.prepare('ROLLBACK').run();
                sqliteTransactionActive = false;
            }
        } catch {
            cleanupErrorMsg += ' [Fallo ROLLBACK de SQLite]';
        }

        try {
            if (sqliteDb) sqliteDb.close();
        } catch {
            cleanupErrorMsg += ' [Fallo cierre SQLite]';
        }

        try {
            if (sqlClient) await sqlClient.close();
        } catch {
            cleanupErrorMsg += ' [Fallo cierre SQL Server]';
        }

        if (cleanupErrorMsg !== '') {
            mainError.message += cleanupErrorMsg;
        }

        throw mainError;
    }
}

if (require.main === module) {
    const MIGRATION_GATE = process.env.PRIOGLPI_OPERATIONAL_MIGRATION_CONFIRM;
    const PREFLIGHT_GATE = process.env.PRIOGLPI_OPERATIONAL_PREFLIGHT;

    if (PREFLIGHT_GATE !== '1' || MIGRATION_GATE !== 'SQLITE_TO_PRIOGLPI') {
        console.error('Abortando: Confirmacion de migracion o preflight ausente o incorrecta.');
        process.exitCode = 1;
    } else {
        migrate().then(() => {
            process.exitCode = 0;
        }).catch((err: unknown) => {
            console.error(err instanceof Error ? err.message : 'Desconocido');
            process.exitCode = 1;
        });
    }
}
