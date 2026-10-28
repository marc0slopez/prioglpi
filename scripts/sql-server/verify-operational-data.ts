import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { OperationalSqlClient, SqlQueryExecutor, SqlRowData } from './operational-sql-client';
import {
    OPERATIONAL_MANIFEST,
    generateLogicalHash,
    formatSqlIdentifier,
    StrictRow
} from './operational-migration-manifest';

const SQLITE_DB_PATH = path.resolve(process.cwd(), 'data/qa/appglpi-ldap-qa.sqlite');

export type SnapshotData = Record<string, StrictRow[]>;

export function createSnapshot(sqliteDb: InstanceType<typeof Database>): SnapshotData {
    const snapshot: SnapshotData = {};
    for (const t of OPERATIONAL_MANIFEST) {
        snapshot[t.sqliteTable] = sqliteDb.prepare(`SELECT * FROM ${t.sqliteTable}`).all() as StrictRow[];
    }
    return snapshot;
}

export async function runVerificationCore(snapshot: SnapshotData, sqlExecutor: SqlQueryExecutor): Promise<void> {
    for (const t of OPERATIONAL_MANIFEST) {
        const sqliteRows = snapshot[t.sqliteTable] || [];
        const sqliteCount = sqliteRows.length;
        const sqliteHash = generateLogicalHash(sqliteRows, t, 'source');

        const safeName = formatSqlIdentifier(t.sqlServerTable);
        const sqlRowsRes = await sqlExecutor.query(`SELECT * FROM ${safeName}`);
        const sqlRows = sqlRowsRes.recordset as StrictRow[];
        const sqlCount = sqlRows.length;
        const sqlHash = generateLogicalHash(sqlRows, t, 'target');

        if (sqliteCount !== sqlCount) throw new Error(`Conteo fallido en ${t.sqliteTable}`);
        if (sqliteHash !== sqlHash) throw new Error(`Hash logico fallido en ${t.sqliteTable}`);

        if (sqliteCount > 0 && t.primaryKey) {
            const sqliteIds = sqliteRows.map(r => r[t.primaryKey] as number).filter(id => typeof id === 'number');
            if (sqliteIds.length > 0) {
                const sqliteMin = Math.min(...sqliteIds);
                const sqliteMax = Math.max(...sqliteIds);
                const pkTargetCol = t.columns.find(c => c.sourceCol === t.primaryKey)!.targetCol;

                const sqlMinMax = await sqlExecutor.query(`SELECT MIN([${pkTargetCol}]) as minId, MAX([${pkTargetCol}]) as maxId FROM ${safeName}`);
                const minRec = sqlMinMax.recordset[0] as { minId: number, maxId: number };
                if (minRec.minId !== sqliteMin) throw new Error(`MIN(${pkTargetCol}) no coincide`);
                if (minRec.maxId !== sqliteMax) throw new Error(`MAX(${pkTargetCol}) no coincide`);

                if (t.hasIdentity) {
                    const identCheck = await sqlExecutor.query(`SELECT IDENT_CURRENT('${safeName}') as curr`);
                    const identRec = identCheck.recordset[0] as { curr: number };
                    if (identRec.curr !== sqliteMax) {
                        throw new Error(`IDENT_CURRENT no coincide con MAX(id) en ${t.sqlServerTable}`);
                    }
                }
            }
        }
    }

    const orfandadQ1 = await sqlExecutor.query(`SELECT TOP 1 1 FROM prioglpi.user_sector_scope child LEFT JOIN prioglpi.app_user parent ON child.user_id = parent.id WHERE parent.id IS NULL`);
    if (orfandadQ1.recordset.length > 0) throw new Error('Orfandad en Rel 1');

    const orfandadQ2 = await sqlExecutor.query(`SELECT TOP 1 1 FROM prioglpi.ticket_ranking child LEFT JOIN prioglpi.glpi_ticket_cache parent ON child.ticket_id = parent.ticket_id WHERE parent.ticket_id IS NULL`);
    if (orfandadQ2.recordset.length > 0) throw new Error('Orfandad en Rel 2');

    const orfandadQ3 = await sqlExecutor.query(`SELECT TOP 1 1 FROM prioglpi.ticket_ranking child LEFT JOIN prioglpi.app_user parent ON child.created_by_user_id = parent.id WHERE parent.id IS NULL`);
    if (orfandadQ3.recordset.length > 0) throw new Error('Orfandad en Rel 3');

    const orfandadQ4 = await sqlExecutor.query(`SELECT TOP 1 1 FROM prioglpi.ticket_ranking child LEFT JOIN prioglpi.app_user parent ON child.updated_by_user_id = parent.id WHERE parent.id IS NULL`);
    if (orfandadQ4.recordset.length > 0) throw new Error('Orfandad en Rel 4');

    const orfandadQ5 = await sqlExecutor.query(`SELECT TOP 1 1 FROM prioglpi.sector_referent_assignment child LEFT JOIN prioglpi.app_user parent ON child.referent_user_id = parent.id WHERE parent.id IS NULL`);
    if (orfandadQ5.recordset.length > 0) throw new Error('Orfandad en Rel 5');

    const orfandadQ6 = await sqlExecutor.query(`SELECT TOP 1 1 FROM prioglpi.ticket_coordination child LEFT JOIN prioglpi.glpi_ticket_cache parent ON child.ticket_id = parent.ticket_id WHERE parent.ticket_id IS NULL`);
    if (orfandadQ6.recordset.length > 0) throw new Error('Orfandad en Rel 6');

    const orfandadQ7 = await sqlExecutor.query(`SELECT TOP 1 1 FROM prioglpi.ticket_coordination child LEFT JOIN prioglpi.app_user parent ON child.updated_by_user_id = parent.id WHERE parent.id IS NULL`);
    if (orfandadQ7.recordset.length > 0) throw new Error('Orfandad en Rel 7');

    const orfandadQ8 = await sqlExecutor.query(`SELECT TOP 1 1 FROM prioglpi.audit_log child LEFT JOIN prioglpi.app_user parent ON child.user_id = parent.id WHERE child.user_id IS NOT NULL AND parent.id IS NULL`);
    if (orfandadQ8.recordset.length > 0) throw new Error('Orfandad en Rel 8');

    function buildDistributionMap(rows: StrictRow[], keyCols: string[]): Map<string, number> {
        const m = new Map<string, number>();
        for (const r of rows) {
            const key = keyCols.map(c => String(r[c])).join('|');
            m.set(key, (m.get(key) || 0) + 1);
        }
        return m;
    }

    function compareMaps(sqliteMap: Map<string, number>, sqlMapRes: SqlRowData[], sqlKeyCols: string[], sqlCountCol: string) {
        const sqlMap = new Map<string, number>();
        for (const r of sqlMapRes) {
            const key = sqlKeyCols.map(c => String(r[c])).join('|');
            sqlMap.set(key, Number(r[sqlCountCol]));
        }
        if (sqliteMap.size !== sqlMap.size) throw new Error('Distribucion size mismatch');
        for (const [k, v] of sqliteMap.entries()) {
            if (sqlMap.get(k) !== v) throw new Error(`Distribucion mismatch for key ${k}: ${v} vs ${sqlMap.get(k)}`);
        }
    }

    const sqliteUsers = snapshot['User'] || [];
    const sqliteUserMap = buildDistributionMap(sqliteUsers, ['role', 'authSource']);
    const sqlUserRes = await sqlExecutor.query(`SELECT role, auth_source, COUNT(*) as c FROM prioglpi.app_user GROUP BY role, auth_source`);
    compareMaps(sqliteUserMap, sqlUserRes.recordset as SqlRowData[], ['role', 'auth_source'], 'c');

    const sqliteSync = snapshot['SyncRun'] || [];
    const sqliteSyncMap = buildDistributionMap(sqliteSync, ['status']);
    const sqlSyncRes = await sqlExecutor.query(`SELECT status, COUNT(*) as c FROM prioglpi.sync_run GROUP BY status`);
    compareMaps(sqliteSyncMap, sqlSyncRes.recordset as SqlRowData[], ['status'], 'c');

    const sqliteGroupActor = snapshot['GlpiTicketGroupActor'] || [];
    const sqliteGroupActorMap = buildDistributionMap(sqliteGroupActor, ['actorType']);
    const sqlGroupActorRes = await sqlExecutor.query(`SELECT actor_type, COUNT(*) as c FROM prioglpi.glpi_ticket_group_actor GROUP BY actor_type`);
    compareMaps(sqliteGroupActorMap, sqlGroupActorRes.recordset as SqlRowData[], ['actor_type'], 'c');

    const sqliteUserActor = snapshot['GlpiTicketUserActor'] || [];
    const sqliteUserActorMap = buildDistributionMap(sqliteUserActor, ['actorType']);
    const sqlUserActorRes = await sqlExecutor.query(`SELECT actor_type, COUNT(*) as c FROM prioglpi.glpi_ticket_user_actor GROUP BY actor_type`);
    compareMaps(sqliteUserActorMap, sqlUserActorRes.recordset as SqlRowData[], ['actor_type'], 'c');

    const uq1 = await sqlExecutor.query(`SELECT username FROM prioglpi.app_user GROUP BY username HAVING COUNT(*) > 1`);
    if (uq1.recordset.length > 0) throw new Error('UNIQUE 1 fallido');

    const uq2 = await sqlExecutor.query(`SELECT glpi_user_id FROM prioglpi.app_user WHERE glpi_user_id IS NOT NULL GROUP BY glpi_user_id HAVING COUNT(*) > 1`);
    if (uq2.recordset.length > 0) throw new Error('UNIQUE 2 fallido');

    const uq3 = await sqlExecutor.query(`SELECT ad_object_id FROM prioglpi.app_user WHERE ad_object_id IS NOT NULL GROUP BY ad_object_id HAVING COUNT(*) > 1`);
    if (uq3.recordset.length > 0) throw new Error('UNIQUE 3 fallido');

    const uq4 = await sqlExecutor.query(`SELECT user_id, sector_name FROM prioglpi.user_sector_scope GROUP BY user_id, sector_name HAVING COUNT(*) > 1`);
    if (uq4.recordset.length > 0) throw new Error('UNIQUE 4 fallido');

    const uq5 = await sqlExecutor.query(`SELECT user_id, glpi_group_id FROM prioglpi.user_sector_scope WHERE glpi_group_id IS NOT NULL GROUP BY user_id, glpi_group_id HAVING COUNT(*) > 1`);
    if (uq5.recordset.length > 0) throw new Error('UNIQUE 5 fallido');

    const uq6 = await sqlExecutor.query(`SELECT ticket_id, glpi_group_id FROM prioglpi.ticket_ranking GROUP BY ticket_id, glpi_group_id HAVING COUNT(*) > 1`);
    if (uq6.recordset.length > 0) throw new Error('UNIQUE 6 fallido');

    const uq7 = await sqlExecutor.query(`SELECT glpi_group_id FROM prioglpi.sector_referent_assignment GROUP BY glpi_group_id HAVING COUNT(*) > 1`);
    if (uq7.recordset.length > 0) throw new Error('UNIQUE 7 fallido');

    const uq8 = await sqlExecutor.query(`SELECT ticket_id FROM prioglpi.ticket_coordination GROUP BY ticket_id HAVING COUNT(*) > 1`);
    if (uq8.recordset.length > 0) throw new Error('UNIQUE 8 fallido');

    const uq9 = await sqlExecutor.query(`SELECT user_id, group_id FROM prioglpi.glpi_user_group_membership GROUP BY user_id, group_id HAVING COUNT(*) > 1`);
    if (uq9.recordset.length > 0) throw new Error('UNIQUE 9 fallido');
}

export async function runVerificationCli(): Promise<void> {
    const VERIFY_GATE = process.env.PRIOGLPI_OPERATIONAL_VERIFY;
    if (VERIFY_GATE !== '1') {
        throw new Error('Abortando: Variable PRIOGLPI_OPERATIONAL_VERIFY=1 obligatoria para verificacion CLI.');
    }

    let sqliteDb: InstanceType<typeof Database> | null = null;
    let sqlClient: OperationalSqlClient | null = null;
    let txActive = false;

    try {
        if (fs.existsSync(SQLITE_DB_PATH + '-wal')) throw new Error('Archivo -wal detectado');
        if (fs.existsSync(SQLITE_DB_PATH + '-shm')) throw new Error('Archivo -shm detectado');

        sqliteDb = new Database(SQLITE_DB_PATH, { readonly: true, fileMustExist: true });
        sqliteDb.pragma('query_only = ON');
        sqliteDb.prepare('BEGIN').run();
        txActive = true;

        const snapshot = createSnapshot(sqliteDb);
        sqlClient = new OperationalSqlClient();

        await runVerificationCore(snapshot, sqlClient);

        // Cerramos explícitamente para asegurar que el OK se emita sólo si no hubo roturas al cerrar
        if (txActive && sqliteDb) {
            sqliteDb.prepare('ROLLBACK').run();
            txActive = false;
        }
        if (sqliteDb) {
            sqliteDb.close();
            sqliteDb = null;
        }
        if (sqlClient) {
            await sqlClient.close();
            sqlClient = null;
        }

        console.log('VALIDACION_DATOS_SQLSERVER_OK');
    } catch (err: unknown) {
        const mainError = err instanceof Error ? err : new Error('Desconocido');
        let cleanupErrorMsg = '';

        try {
            if (txActive && sqliteDb) {
                sqliteDb.prepare('ROLLBACK').run();
                txActive = false;
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
    import('dotenv/config').then(() => {
        runVerificationCli().then(() => {
            process.exitCode = 0;
        }).catch((err: unknown) => {
            console.error(err instanceof Error ? err.message : 'Error desconocido');
            process.exitCode = 1;
        });
    });
}
