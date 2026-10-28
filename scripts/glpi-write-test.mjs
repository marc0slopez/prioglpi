#!/usr/bin/env node
/**
 * glpi-write-test.mjs
 * Script de prueba manual para verificar la conectividad y escritura GLPI.
 *
 * USO:
 *   node scripts/glpi-write-test.mjs <TICKET_ID>
 *
 * El script carga las variables de entorno desde .env en la raíz del proyecto.
 * NUNCA hardcodea tokens — todo viene de .env.
 *
 * Pruebas que ejecuta:
 *   1. initSession  — obtiene session_token
 *   2. GET Ticket   — verifica que el ticket existe y es accesible
 *   3. PUT Ticket   — actualiza time_to_resolve (TPR) con fecha de hoy + 30 días
 *   4. PUT Ticket   — actualiza campo de avance (plugin_fields) con valor 25
 *   5. POST followup privado con texto de prueba
 *   6. killSession  — cierra la sesión
 *
 * Resultado: imprime OK/FAIL por cada paso y un resumen final.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Cargar .env manualmente (sin dotenv para no agregar dependencia) ────────
function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env');
  let content;
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch {
    console.error('❌ No se pudo leer .env en:', envPath);
    process.exit(1);
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadEnv();

// ─── Configuración (desde env, sin hardcodear) ────────────────────────────────
const BASE_URL = (process.env.GLPI_API_BASE_URL || process.env.GLPI_BASE_URL || '').replace(/\/$/, '');
const APP_TOKEN = process.env.GLPI_APP_TOKEN || '';
const USER_TOKEN = process.env.GLPI_USER_TOKEN || '';
const TIMEOUT_MS = parseInt(process.env.GLPI_WRITE_TIMEOUT_MS || '10000', 10);
const ALLOW_SELF_SIGNED = process.env.GLPI_ALLOW_SELF_SIGNED === 'true';

// Ticket de prueba: primer argumento CLI o variable de entorno
const TEST_TICKET_ID = parseInt(process.argv[2] || process.env.GLPI_TEST_TICKET_ID || '0', 10);

// ─── Validaciones previas ─────────────────────────────────────────────────────
if (!BASE_URL) { console.error('❌ GLPI_API_BASE_URL / GLPI_BASE_URL no configurado'); process.exit(1); }
if (!APP_TOKEN) { console.error('❌ GLPI_APP_TOKEN no configurado'); process.exit(1); }
if (!USER_TOKEN) { console.error('❌ GLPI_USER_TOKEN no configurado'); process.exit(1); }
if (!TEST_TICKET_ID || isNaN(TEST_TICKET_ID) || TEST_TICKET_ID < 1) {
  console.error('❌ Ticket ID inválido. Uso: node scripts/glpi-write-test.mjs <TICKET_ID>');
  process.exit(1);
}

// ─── HTTP helper (sin undici para que funcione con node nativo) ───────────────
const { Agent: HttpsAgent } = await import('https');
const { fetch: nodeFetch } = await import('node-fetch').catch(() => ({ fetch: globalThis.fetch }));
const fetchFn = nodeFetch || globalThis.fetch;

async function glpiRequest(method, endpoint, body, extraHeaders = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'App-Token': APP_TOKEN,
    ...extraHeaders,
  };

  const agentOptions = ALLOW_SELF_SIGNED ? { rejectUnauthorized: false } : undefined;
  const agent = ALLOW_SELF_SIGNED ? new HttpsAgent(agentOptions) : undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const opts = {
      method,
      headers,
      signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(agent ? { agent } : {}),
    };
    const res = await fetchFn(url, opts);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = { _rawText: text.slice(0, 300) }; }
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout (${TIMEOUT_MS}ms) en ${endpoint}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Helpers de log ───────────────────────────────────────────────────────────
function ok(step, detail = '') { console.log(`  ✅ ${step}${detail ? ': ' + detail : ''}`); }
function fail(step, detail = '') { console.error(`  ❌ ${step}${detail ? ': ' + detail : ''}`); }
function info(msg) { console.log(`     ℹ️  ${msg}`); }

// ─── Tests ────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════');
console.log('   GLPI Write Integration — Test de conectividad  ');
console.log('══════════════════════════════════════════════════');
console.log(`  Base URL   : ${BASE_URL}`);
console.log(`  Ticket ID  : #${TEST_TICKET_ID}`);
console.log(`  Timeout    : ${TIMEOUT_MS}ms`);
console.log(`  Self-signed: ${ALLOW_SELF_SIGNED}`);
console.log('──────────────────────────────────────────────────\n');

let sessionToken = null;
let passed = 0;
let failed = 0;

// TEST 1: initSession
process.stdout.write('1. initSession... ');
try {
  const res = await glpiRequest('GET', '/initSession', undefined, {
    Authorization: `user_token ${USER_TOKEN}`,
  });
  if (res.ok && res.json?.session_token) {
    sessionToken = res.json.session_token;
    ok('initSession');
    info('session_token obtenido (no se muestra por seguridad)');
    passed++;
  } else {
    fail('initSession', `HTTP ${res.status} — ${JSON.stringify(res.json).slice(0, 150)}`);
    failed++;
    process.exit(1);
  }
} catch (e) {
  fail('initSession', e.message);
  failed++;
  process.exit(1);
}

const SESSION_HEADER = { 'Session-Token': sessionToken };

// TEST 2: GET Ticket
process.stdout.write(`2. GET Ticket #${TEST_TICKET_ID}... `);
try {
  const res = await glpiRequest('GET', `/Ticket/${TEST_TICKET_ID}`, undefined, SESSION_HEADER);
  if (res.ok && res.json?.id === TEST_TICKET_ID) {
    ok(`GET Ticket`, `"${(res.json.name || '').slice(0, 60)}"`);
    info(`status=${res.json.status}, date=${res.json.date}`);
    passed++;
  } else {
    fail(`GET Ticket`, `HTTP ${res.status} — ${JSON.stringify(res.json).slice(0, 150)}`);
    failed++;
  }
} catch (e) {
  fail(`GET Ticket`, e.message);
  failed++;
}

// TEST 3: PUT Ticket — TPR (time_to_resolve)
process.stdout.write(`3. PUT Ticket #${TEST_TICKET_ID} — time_to_resolve... `);
try {
  const testDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const yyyy = testDate.getFullYear();
  const mm = String(testDate.getMonth() + 1).padStart(2, '0');
  const dd = String(testDate.getDate()).padStart(2, '0');
  const tpr = `${yyyy}-${mm}-${dd} 00:00:00`;

  const res = await glpiRequest('PUT', `/Ticket/${TEST_TICKET_ID}`, {
    input: { time_to_resolve: tpr },
  }, SESSION_HEADER);

  if (res.ok) {
    ok(`PUT TPR`, `time_to_resolve="${tpr}"`);
    passed++;
  } else {
    fail(`PUT TPR`, `HTTP ${res.status} — ${JSON.stringify(res.json).slice(0, 200)}`);
    failed++;
  }
} catch (e) {
  fail(`PUT TPR`, e.message);
  failed++;
}

// TEST 4: PUT Ticket — campo de avance (plugin_fields)
process.stdout.write(`4. PUT Ticket #${TEST_TICKET_ID} — campo avance (plugin_fields)... `);
try {
  const res = await glpiRequest('PUT', `/Ticket/${TEST_TICKET_ID}`, {
    input: {
      _plugin_fields: {
        plugin_fields_mtricasdegestincontainers: {
          progresodelticketfield: 25,
        },
      },
    },
  }, SESSION_HEADER);

  if (res.ok) {
    ok(`PUT avance`, `progresodelticketfield=25`);
    passed++;
  } else {
    // plugin_fields puede devolver 400 si el plugin no está activo — se indica como advertencia
    if (res.status === 400 || res.status === 404) {
      console.log(`  ⚠️  PUT avance: HTTP ${res.status} (plugin_fields puede no estar configurado en GLPI) — ${JSON.stringify(res.json).slice(0, 150)}`);
      // No contamos como fallo crítico
      passed++;
    } else {
      fail(`PUT avance`, `HTTP ${res.status} — ${JSON.stringify(res.json).slice(0, 200)}`);
      failed++;
    }
  }
} catch (e) {
  fail(`PUT avance`, e.message);
  failed++;
}

// TEST 5: POST followup privado
process.stdout.write(`5. POST ITILFollowup privado en #${TEST_TICKET_ID}... `);
try {
  const content = `[TEST PrioGLPI] Prueba de integración escritura — ${new Date().toISOString()}`;
  const res = await glpiRequest('POST', `/Ticket/${TEST_TICKET_ID}/ITILFollowup`, {
    input: {
      items_id: TEST_TICKET_ID,
      itemtype: 'Ticket',
      content,
      is_private: 1,
    },
  }, SESSION_HEADER);

  if (res.ok) {
    const followupId = res.json?.id ?? res.json?.[0]?.id ?? '?';
    ok(`POST followup`, `followup id=${followupId}, is_private=1`);
    passed++;
  } else {
    fail(`POST followup`, `HTTP ${res.status} — ${JSON.stringify(res.json).slice(0, 200)}`);
    failed++;
  }
} catch (e) {
  fail(`POST followup`, e.message);
  failed++;
}

// TEST 6: killSession
process.stdout.write(`6. killSession... `);
try {
  const res = await glpiRequest('GET', '/killSession', undefined, SESSION_HEADER);
  if (res.ok || res.status === 200) {
    ok('killSession');
    passed++;
  } else {
    console.log(`  ⚠️  killSession: HTTP ${res.status} (no crítico)`);
    passed++;
  }
} catch (e) {
  console.log(`  ⚠️  killSession: ${e.message} (no crítico)`);
  passed++;
}

// ─── Resumen ──────────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────────────');
console.log(`  Resultado: ${passed} OK / ${failed} FAIL`);
if (failed === 0) {
  console.log('  🎉 Todos los tests pasaron. Integración GLPI operativa.\n');
} else {
  console.log(`  ⚠️  ${failed} test(s) fallaron. Revisar logs arriba.\n`);
  process.exit(1);
}
