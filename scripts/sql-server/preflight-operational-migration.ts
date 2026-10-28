import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { OperationalSqlClient } from './operational-sql-client';
import { createSnapshot } from './verify-operational-data';
import {
    OPERATIONAL_MANIFEST,
    formatSqlIdentifier,
    generateLogicalHash
} from './operational-migration-manifest';

type SqliteDatabase = InstanceType<typeof Database>;

export function calculatePhysicalHash(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

export async function runPreflight(): Promise<string> {
    const PREFLIGHT_GATE = process.env.PRIOGLPI_OPERATIONAL_PREFLIGHT;
    if (PREFLIGHT_GATE !== '1') {
        throw new Error('Abortando: Variable PRIOGLPI_OPERATIONAL_PREFLIGHT=1 obligatoria para preflight.');
    }

    let sqliteDb: SqliteDatabase | null = null;
    let sqlClient: OperationalSqlClient | null = null;
    let transactionActive = false;
    let physicalHash = '';

    try {
        console.log('Iniciando Preflight...');

        const ports = [8787, 8788, 8789];
        for (const p of ports) {
            const inUse = await new Promise<boolean>((resolve) => {
                const server = net.createServer().once('error', () => resolve(true)).once('listening', () => { server.close(); resolve(false); }).listen(p);
            });
            if (inUse) throw new Error(`El puerto ${p} esta en uso. PrioGLPI debe estar detenido.`);
        }

        const relativeSqlitePath = 'data/qa/appglpi-ldap-qa.sqlite';
        const expectedDbName = 'appglpi-ldap-qa.sqlite';
        const dbDir = path.resolve(process.cwd(), 'data/qa');
        const dbPath = path.resolve(process.cwd(), relativeSqlitePath);

        if (!fs.existsSync(dbPath)) throw new Error('SQLite no encontrado en ruta esperada');

        const realDbPath = fs.realpathSync(dbPath);
        const realDbDir = fs.realpathSync(dbDir);

        if (!realDbPath.startsWith(realDbDir)) throw new Error('El archivo SQLite no esta contenido en data/qa');
        if (path.basename(realDbPath) !== expectedDbName) throw new Error(`El nombre de base debe ser ${expectedDbName}`);

        const stat = fs.lstatSync(dbPath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('SQLite debe ser un archivo regular');
        if (stat.nlink !== 1) throw new Error('SQLite tiene multiples enlaces duros');

        if (fs.existsSync(dbPath + '-wal')) throw new Error('Archivo -wal detectado');
        if (fs.existsSync(dbPath + '-shm')) throw new Error('Archivo -shm detectado');

        physicalHash = calculatePhysicalHash(dbPath);

        sqliteDb = new Database(dbPath, { readonly: true, fileMustExist: true });
        sqliteDb.pragma('query_only = ON');

        const integrity = sqliteDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
        if (integrity.integrity_check !== 'ok') throw new Error('integrity_check fallo en SQLite');

        const fkCheck = sqliteDb.prepare('PRAGMA foreign_key_check').all() as unknown[];
        if (fkCheck.length > 0) throw new Error('Errores de foreign keys detectados via PRAGMA');

        sqliteDb.prepare('BEGIN').run();
        transactionActive = true;

        const tables = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
        const tableNames = tables.map(t => t.name).filter(n => n !== 'sqlite_sequence' && n !== '_prisma_migrations');
        if (tableNames.length !== 16) throw new Error('SQLite no contiene exactamente 16 tablas');

        for (const t of OPERATIONAL_MANIFEST) {
            if (!tableNames.includes(t.sqliteTable)) throw new Error(`Falta tabla ${t.sqliteTable} en SQLite`);
        }

        const snapshot = createSnapshot(sqliteDb);

        for (const t of OPERATIONAL_MANIFEST) {
            const rows = snapshot[t.sqliteTable];
            generateLogicalHash(rows, t, 'source');
        }

        sqlClient = new OperationalSqlClient();

        const schemaExists = await sqlClient.query("SELECT 1 FROM sys.schemas WHERE name = 'prioglpi'");
        if (schemaExists.recordset.length === 0) throw new Error('El schema prioglpi no existe');

        const allTablesRes = await sqlClient.query("SELECT t.name, t.object_id FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'prioglpi'");

        const parsedTables: Array<{ name: string; objectId: number }> = [];

        for (const row of allTablesRes.recordset) {
            const name = row.name;
            const objectId = row.object_id;

            if (typeof name !== 'string') throw new Error('sys.tables contiene name no string');
            if (
                typeof objectId !== 'number' ||
                !Number.isSafeInteger(objectId) ||
                objectId <= 0
            ) throw new Error('sys.tables contiene object_id invalido');

            parsedTables.push({ name, objectId });
        }

        if (parsedTables.length !== 16) throw new Error('Schema prioglpi no contiene exactamente 16 tablas');

        let totalColsCount = 0;

        for (const t of OPERATIONAL_MANIFEST) {
            const sqlTableName = t.sqlServerTable;

            const tableRec = parsedTables.find(r => r.name === sqlTableName);
            if (!tableRec) throw new Error(`Tabla ${sqlTableName} no encontrada`);

            const tableId = tableRec.objectId;

            const colsRes = await sqlClient.query(`
                SELECT c.name as col_name, ty.name as type_name, c.max_length, c.precision, c.scale, c.is_nullable
                FROM sys.columns c
                JOIN sys.types ty ON c.user_type_id = ty.user_type_id
                WHERE c.object_id = ${tableId}
            `);

            const parsedCols: Array<{
                colName: string;
                typeName: string;
                maxLength: number;
                precision: number;
                scale: number;
                isNullable: boolean;
            }> = [];

            for (const row of colsRes.recordset) {
                const colName = row.col_name;
                const typeName = row.type_name;
                const maxLength = row.max_length;
                const precision = row.precision;
                const scale = row.scale;
                const isNullable = row.is_nullable;

                if (typeof colName !== 'string') throw new Error('sys.columns contiene col_name no string');
                if (typeof typeName !== 'string') throw new Error('sys.columns contiene type_name no string');
                if (typeof maxLength !== 'number' || !Number.isSafeInteger(maxLength)) throw new Error('sys.columns contiene max_length invalido');
                if (typeof precision !== 'number' || !Number.isSafeInteger(precision)) throw new Error('sys.columns contiene precision invalido');
                if (typeof scale !== 'number' || !Number.isSafeInteger(scale)) throw new Error('sys.columns contiene scale invalido');
                if (typeof isNullable !== 'boolean') throw new Error('sys.columns contiene is_nullable invalido');

                parsedCols.push({
                    colName,
                    typeName,
                    maxLength,
                    precision,
                    scale,
                    isNullable
                });
            }

            if (parsedCols.length !== t.columns.length) throw new Error(`Cantidad de columnas en SQL difiere para ${sqlTableName}`);
            totalColsCount += parsedCols.length;

            for (const expected of t.columns) {
                const actual = parsedCols.find(c => c.colName === expected.targetCol);
                if (!actual) throw new Error(`Falta columna ${expected.targetCol} en SQL Server`);

                const expectedNullable = expected.type.startsWith('nullable');
                if (actual.isNullable !== expectedNullable) throw new Error(`Nulabilidad difiere en ${expected.targetCol}`);

                if (expected.sqlType.kind === 'int') {
                    if (actual.typeName !== 'int') throw new Error(`Se esperaba int en ${expected.targetCol}`);
                    if (actual.maxLength !== 4 || actual.precision !== 10 || actual.scale !== 0) throw new Error(`Metadatos INT incorrectos en ${expected.targetCol}`);
                }
                if (expected.sqlType.kind === 'bit') {
                    if (actual.typeName !== 'bit') throw new Error(`Se esperaba bit en ${expected.targetCol}`);
                    if (actual.maxLength !== 1 || actual.precision !== 1 || actual.scale !== 0) throw new Error(`Metadatos BIT incorrectos en ${expected.targetCol}`);
                }
                if (expected.sqlType.kind === 'datetime2') {
                    if (actual.typeName !== 'datetime2') throw new Error(`Se esperaba datetime2 en ${expected.targetCol}`);
                    if (actual.maxLength !== 7 || actual.precision !== 23 || actual.scale !== 3) throw new Error(`Metadatos DATETIME2(3) incorrectos en ${expected.targetCol}`);
                }
                if (expected.sqlType.kind === 'nvarchar') {
                    if (actual.typeName !== 'nvarchar') throw new Error(`Se esperaba nvarchar en ${expected.targetCol}`);
                    const expectedMax = expected.sqlType.length === 'max' ? -1 : (expected.sqlType.length as number) * 2;
                    if (actual.maxLength !== expectedMax || actual.precision !== 0 || actual.scale !== 0) throw new Error(`Metadatos NVARCHAR incorrectos en ${expected.targetCol}`);
                }
            }

            const safeName = formatSqlIdentifier(t.sqlServerTable);
            const emptyCheck = await sqlClient.query(`SELECT TOP 1 1 FROM ${safeName}`);
            if (emptyCheck.recordset.length > 0) throw new Error(`La tabla destino ${safeName} NO esta vacia`);

            const permRes = await sqlClient.query(`SELECT permission_name FROM fn_my_permissions('${safeName}', 'OBJECT')`);
            const perms: string[] = [];
            for (const row of permRes.recordset) {
                const permName = row.permission_name;
                if (typeof permName !== 'string') throw new Error('fn_my_permissions devolvió un permiso no string');
                perms.push(permName);
            }

            if (!perms.includes('SELECT')) throw new Error(`Sin permiso SELECT en ${safeName}`);
            if (!perms.includes('INSERT')) throw new Error(`Sin permiso INSERT en ${safeName}`);
            if (t.hasIdentity && !perms.includes('ALTER')) throw new Error(`Sin permiso ALTER en ${safeName}`);
        }

        if (totalColsCount !== 153) throw new Error(`Se esperaban exactamente 153 columnas, se detectaron ${totalColsCount}`);

        // Cierre explícito para poder asegurar que todo terminó correctamente antes de emitir OK.
        if (transactionActive && sqliteDb) {
            sqliteDb.prepare('ROLLBACK').run();
            transactionActive = false;
        }
        if (sqliteDb) {
            sqliteDb.close();
            sqliteDb = null;
        }
        if (sqlClient) {
            await sqlClient.close();
            sqlClient = null;
        }

        console.log('PREFLIGHT_OK');
        return physicalHash;

    } catch (err: unknown) {
        const mainError = err instanceof Error ? err : new Error('Desconocido');
        let cleanupErrorMsg = '';

        try {
            if (transactionActive && sqliteDb) {
                sqliteDb.prepare('ROLLBACK').run();
                transactionActive = false;
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
        runPreflight().then(() => {
            process.exitCode = 0;
        }).catch((err: unknown) => {
            console.error(err instanceof Error ? err.message : 'Error desconocido');
            process.exitCode = 1;
        });
    });
}
