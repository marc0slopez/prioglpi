import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { spawn, ChildProcess } from 'child_process';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const isolatedDbPath = path.resolve(projectRoot, 'data/qa/appglpi_qa_isolated.sqlite');
const testDbPath = path.resolve(projectRoot, 'data/qa/appglpi_qa_api_test.sqlite');

type SqliteDatabase = InstanceType<typeof Database>;

interface AuditRow {
  id: number;
  action: string;
  beforeJson: string | null;
  afterJson: string | null;
}

function getTableHash(db: SqliteDatabase, table: string) {
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all();
  const hashSum = crypto.createHash('sha256');
  hashSum.update(JSON.stringify(rows));
  return hashSum.digest('hex');
}

async function login(username: string, roleExpected: string) {
  const res = await fetch('http://localhost:8788/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: `${username}123` })
  });

  assert.strictEqual(res.status, 200, 'Login status must be 200');
  const body = await res.json();
  assert.strictEqual(body.user.username, username, `Username must be ${username}`);
  assert.strictEqual(body.user.role, roleExpected, `Role must be ${roleExpected}`);

  const cookie = res.headers.get('set-cookie');
  assert.ok(cookie, 'Cookie must be present');

  return cookie as string;
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function waitForServerReady(childProcess: ChildProcess, state: { spawnError: Error | null }) {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    if (state.spawnError) {
      throw new Error(`Error en el subproceso: ${state.spawnError.message}`);
    }
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      throw new Error('El proceso Next.js terminÃ³ inesperadamente antes de estar listo.');
    }
    try {
      const res = await fetch('http://localhost:8788/login');
      if (res.ok) return;
    } catch {
      // Ignorar errores de red mientras levanta
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Timeout esperando a que el servidor responda en /login');
}

async function runTests() {
  console.log('--- PREPARANDO ENTORNO DE TEST ---');
  const isExternalServer = process.env.APPGLPI_TEST_EXTERNAL_SERVER === '1';

  if (!isExternalServer) {
    if (!fs.existsSync(isolatedDbPath)) {
      console.error('Isolated DB no existe. Ejecutar backup y remediaciÃ³n primero.');
      process.exitCode = 1;
      return;
    }

    if (!(await isPortFree(8788))) {
      console.error('ERROR: El puerto 8788 estÃ¡ ocupado. Abortando pruebas.');
      process.exitCode = 1;
      return;
    }
  } else {
    if (!fs.existsSync(testDbPath)) {
      console.error(`ERROR: En modo externo, la base ${testDbPath} debe existir previamente.`);
      process.exitCode = 1;
      return;
    }
    try {
      const healthCheck = await fetch('http://localhost:8788/login');
      if (!healthCheck.ok) throw new Error();
    } catch {
      console.error('ERROR: En modo externo, el servidor Next.js debe estar levantado en el puerto 8788 y respondiendo en /login.');
      process.exitCode = 1;
      return;
    }
  }

  console.log(isExternalServer ? 'Utilizando servidor externo en puerto 8788...' : 'Levantando servidor API de prueba en puerto 8788...');
  const nextCli = path.resolve(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
  let nextProcess: ChildProcess | null = null;
  let db: SqliteDatabase | null = null;

  try {
    const processState: { spawnError: Error | null } = { spawnError: null };

    if (!isExternalServer) {
      fs.copyFileSync(isolatedDbPath, testDbPath);
      console.log(`Copia de prueba creada en: ${testDbPath}`);

      nextProcess = spawn(process.execPath, [nextCli, 'start', '-p', '8788'], {
        cwd: projectRoot,
        env: {
          ...process.env,
          APPGLPI_RUNTIME_MODE: 'qa',
          DATABASE_URL: `file:${testDbPath}`
        },
        shell: false
      });

      nextProcess.on('error', (err) => {
        console.error('Error al spawnear Next.js:', err);
        processState.spawnError = err;
      });
      nextProcess.on('exit', (code, signal) => {
        console.log(`Proceso Next.js terminÃ³ con cÃ³digo ${code} y seÃ±al ${signal}`);
      });
    }

    db = new Database(testDbPath, { readonly: true, fileMustExist: true });

    if (!isExternalServer && nextProcess) {
      await waitForServerReady(nextProcess, processState);
      console.log('Servidor iniciado correctamente.');
    } else {
      console.log('Servidor externo verificado correctamente.');
    }

    const cookieJulian = await login('julianc', 'referente');
    const headersJulian = { 'Content-Type': 'application/json', 'Cookie': cookieJulian };

    const healthRes = await fetch('http://localhost:8788/api/health', { headers: headersJulian });
    assert.strictEqual(healthRes.status, 200, 'HTTP Status de /api/health debe ser 200 con sesiÃ³n autenticada');
    console.log('âœ… /api/health verificado con sesiÃ³n vÃ¡lida');

    const cookieMauro = await login('coordinator_demo', 'coordinador_sistemas');
    const meRes = await fetch('http://localhost:8788/api/auth/me', {
      headers: { 'Cookie': cookieMauro }
    });
    assert.strictEqual(meRes.status, 200, 'HTTP Status de /api/auth/me debe ser 200');

    interface MeResponse {
      userId: number;
      username: string;
      displayName: string;
      role: string;
      sectors: string[];
    }
    const meBody = (await meRes.json()) as MeResponse;
    assert.strictEqual(meBody.username, 'coordinator_demo', 'username debe ser coordinator_demo');
    assert.strictEqual(meBody.role, 'coordinador_sistemas', 'role debe ser coordinador_sistemas');
    console.log('âœ… /api/auth/me verificado con coordinator_demo');

    if (!db) throw new Error('DB is not initialized');

    const rankHashBefore = getTableHash(db, 'TicketRanking');
    const auditCountStmt = db.prepare('SELECT COUNT(*) as c FROM AuditLog').get() as { c: number };
    const auditCountBefore = auditCountStmt.c;
    const auditHashBefore = getTableHash(db, 'AuditLog');

    const checkNoOp = () => {
      if (!db) throw new Error('DB is not initialized');
      const rankHashAfter = getTableHash(db, 'TicketRanking');
      const auditCountAfter = (db.prepare('SELECT COUNT(*) as c FROM AuditLog').get() as { c: number }).c;
      const auditHashAfter = getTableHash(db, 'AuditLog');

      assert.strictEqual(rankHashBefore, rankHashAfter, 'Hash lÃ³gico de TicketRanking debe ser idÃ©ntico');
      assert.strictEqual(auditCountBefore, auditCountAfter, 'Conteo de AuditLog debe ser idÃ©ntico');
      assert.strictEqual(auditHashBefore, auditHashAfter, 'Hash lÃ³gico de AuditLog debe ser idÃ©ntico');
    };

    console.log('Test 1: POST reorder idÃ©ntico (NO-OP)');
    const t1 = await fetch('http://localhost:8788/api/rankings/reorder', {
      method: 'POST',
      headers: headersJulian,
      body: JSON.stringify({ sector: 'Impuestos', orderedTicketIds: [624, 795, 646] })
    });
    const t1Body = await t1.json();
    assert.strictEqual(t1.status, 200, 'HTTP Status debe ser 200');
    assert.strictEqual(t1Body.changed, false, 'changed debe ser false');
    checkNoOp();
    console.log('âœ… Test 1 OK');

    console.log('Test 2: PATCH posiciÃ³n actual (NO-OP)');
    const t2 = await fetch('http://localhost:8788/api/rankings/624', {
      method: 'PATCH',
      headers: headersJulian,
      body: JSON.stringify({ sector: 'Impuestos', newPosition: 1 })
    });
    const t2Body = await t2.json();
    assert.strictEqual(t2.status, 200, 'HTTP Status debe ser 200');
    assert.strictEqual(t2Body.changed, false, 'changed debe ser false');
    checkNoOp();
    console.log('âœ… Test 2 OK');

    console.log('Test 3: POST con ID duplicado');
    const t3 = await fetch('http://localhost:8788/api/rankings/reorder', {
      method: 'POST',
      headers: headersJulian,
      body: JSON.stringify({ sector: 'Impuestos', orderedTicketIds: [624, 795, 624] })
    });
    assert.strictEqual(t3.status, 400, 'HTTP Status debe ser 400');
    checkNoOp();
    console.log('âœ… Test 3 OK');

    console.log('Test 4: POST con conjunto incompleto');
    const t4 = await fetch('http://localhost:8788/api/rankings/reorder', {
      method: 'POST',
      headers: headersJulian,
      body: JSON.stringify({ sector: 'Impuestos', orderedTicketIds: [624, 795] })
    });
    assert.strictEqual(t4.status, 400, 'HTTP Status debe ser 400');
    checkNoOp();
    console.log('âœ… Test 4 OK');

    console.log('Test 5: Cambio real');
    const t5 = await fetch('http://localhost:8788/api/rankings/reorder', {
      method: 'POST',
      headers: headersJulian,
      body: JSON.stringify({ sector: 'Impuestos', orderedTicketIds: [795, 624, 646] })
    });
    const t5Body = await t5.json();
    assert.strictEqual(t5.status, 200, 'HTTP Status debe ser 200');
    assert.strictEqual(t5Body.changed, true, 'changed debe ser true');

    const auditCountFinal = (db.prepare('SELECT COUNT(*) as c FROM AuditLog').get() as { c: number }).c;
    assert.strictEqual(auditCountFinal, auditCountBefore + 1, 'Exactamente un AuditLog debe haber sido creado');

    const lastAudit = db.prepare('SELECT * FROM AuditLog ORDER BY id DESC LIMIT 1').get() as AuditRow | undefined;
    if (!lastAudit) {
      throw new Error('No se encontrÃ³ el AuditLog de ranking_reorder');
    }
    assert.strictEqual(lastAudit.action, 'ranking_reorder', 'Action debe ser ranking_reorder');

    const finalOrderRows = db.prepare(`SELECT ticketId FROM TicketRanking WHERE sectorName = 'Impuestos' AND isActive = 1 ORDER BY rankPosition ASC, id ASC`).all() as { ticketId: number }[];
    const finalOrder = finalOrderRows.map(r => r.ticketId).join(',');
    assert.strictEqual(finalOrder, '795,624,646', 'El orden final debe ser exactamente 795, 624, 646');
    console.log('âœ… Test 5 OK');

  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (db) {
      try { db.close(); } catch {}
    }

    let processDead = true;
    if (!isExternalServer && nextProcess && nextProcess.exitCode === null && nextProcess.signalCode === null) {
      console.log('Iniciando cierre de servidor...');
      nextProcess.kill();
      processDead = false;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.error('ERROR: Timeout esperando a que NextJS termine.');
          process.exitCode = 1;
          resolve();
        }, 5000);

        nextProcess!.on('exit', () => {
          clearTimeout(timeout);
          processDead = true;
          resolve();
        });

        if (nextProcess!.exitCode !== null || nextProcess!.signalCode !== null) {
          clearTimeout(timeout);
          processDead = true;
          resolve();
        }
      });
    }

    let cleanupFailed = false;
    if (!isExternalServer && fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
        console.log('Copia descartable eliminada exitosamente.');
      } catch (err) {
        console.error('ERROR: No se pudo eliminar la copia descartable:', err);
        cleanupFailed = true;
        process.exitCode = 1;
      }
    }

    const hasError = process.exitCode !== 0 && process.exitCode !== undefined;
    const hasCleanupError = (!isExternalServer && !processDead) || cleanupFailed;

    if (!hasError && !hasCleanupError) {
      console.log('--- TODOS LOS TESTS PASARON Y ENTORNO LIMPIO ---');
    } else if (hasError && !hasCleanupError) {
      console.error('--- TESTS FINALIZADOS CON ERRORES ---');
    } else if (!hasError && hasCleanupError) {
      console.error('--- TESTS COMPLETADOS PERO CON ERRORES DE LIMPIEZA ---');
    } else {
      console.error('--- TESTS FINALIZADOS CON ERRORES DE EJECUCIÃ“N Y DE LIMPIEZA ---');
    }
  }
}

runTests();
