#!/usr/bin/env node
/**
 * glpi-progress-test.mjs
 * Script de prueba del campo de avance/progreso en GLPI.
 *
 * NO asume éxito por HTTP 200. Verifica el valor real después de cada PUT
 * usando el método de búsqueda descubierto (search option ID o campo directo).
 *
 * Uso: node scripts/glpi-progress-test.mjs <TICKET_ID> <VALOR> [SEARCH_OPT_ID]
 *   TICKET_ID      : ID del ticket a modificar
 *   VALOR          : 0, 25, 50, 75 o 100
 *   SEARCH_OPT_ID  : (opcional) ID de la search option del campo progreso
 *                    obtenido de glpi-discover-progress-field.mjs
 *                    Si se omite, se busca automáticamente.
 *
 * Vars .env:
 *   GLPI_PROGRESS_SEARCH_OPT_ID — alternativa a pasarlo por arg
 *   GLPI_PROGRESS_MAP_0..100    — IDs de dropdown si corresponde
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ─── Cargar .env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
      if (k && !(k in process.env)) process.env[k] = v;
    }
  } catch { console.error('❌ No se pudo leer .env'); process.exit(1); }
}
loadEnv();

const BASE_URL  = (process.env.GLPI_API_BASE_URL || process.env.GLPI_BASE_URL || '').replace(/\/$/, '');
const APP_TOKEN = process.env.GLPI_APP_TOKEN || '';
const USER_TOKEN = process.env.GLPI_USER_TOKEN || '';
const TIMEOUT_MS = parseInt(process.env.GLPI_WRITE_TIMEOUT_MS || '15000', 10);

const TICKET_ID   = parseInt(process.argv[2] || '0', 10);
const PERCENT_VAL = parseInt(process.argv[3] || '25', 10);
const CLI_OPT_ID  = process.argv[4] ? parseInt(process.argv[4], 10) : null;
const ENV_OPT_ID  = process.env.GLPI_PROGRESS_SEARCH_OPT_ID
  ? parseInt(process.env.GLPI_PROGRESS_SEARCH_OPT_ID, 10) : null;

if (!BASE_URL || !APP_TOKEN || !USER_TOKEN) {
  console.error('❌ Faltan vars de entorno GLPI'); process.exit(1);
}
if (!TICKET_ID || isNaN(TICKET_ID)) {
  console.error('❌ Uso: node scripts/glpi-progress-test.mjs <TICKET_ID> <VALOR> [SEARCH_OPT_ID]');
  process.exit(1);
}
if (![0, 25, 50, 75, 100].includes(PERCENT_VAL)) {
  console.error('❌ VALOR debe ser 0, 25, 50, 75 o 100'); process.exit(1);
}

// Mapping de dropdown desde env
function getGlpiValue(pct) {
  const envVal = process.env[`GLPI_PROGRESS_MAP_${pct}`];
  if (envVal && envVal.trim()) {
    const n = parseInt(envVal.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return pct;
}
const GLPI_VALUE = getGlpiValue(PERCENT_VAL);

// ─── HTTP helper ──────────────────────────────────────────────────────────────
async function req(method, endpoint, body, extraHeaders = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = { 'Content-Type': 'application/json', 'App-Token': APP_TOKEN, ...extraHeaders };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method, headers, signal: ctrl.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 500) }; }
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Timeout ${TIMEOUT_MS}ms`);
    throw e;
  } finally { clearTimeout(t); }
}

// ─── Leer valor real del campo progreso ──────────────────────────────────────
/**
 * Intenta leer el valor real del campo progreso usando múltiples métodos:
 * 1. /search/Ticket con el search option ID conocido
 * 2. GET /Ticket/<ID> y buscar campos de progreso
 * 3. Endpoint de plugin fields directo
 *
 * Retorna { value: <valor o null>, method: <descripción del método usado> }
 */
async function readProgressValue(sessionHeader, searchOptId) {
  // Método A: /search/Ticket con forcedisplay del search option ID
  if (searchOptId) {
    try {
      const r = await req('GET',
        `/search/Ticket?criteria[0][field]=2&criteria[0][searchtype]=equals&criteria[0][value]=${TICKET_ID}&forcedisplay[0]=${searchOptId}&rawdata=1`,
        undefined, sessionHeader
      );
      if (r.ok && Array.isArray(r.json?.data) && r.json.data.length > 0) {
        const row = r.json.data[0];
        // La clave en el resultado es el search option ID
        const val = row[searchOptId] ?? row[String(searchOptId)];
        return {
          value: val ?? null,
          method: `search/Ticket forcedisplay[${searchOptId}]`,
          raw: row
        };
      }
    } catch (e) {
      // ignorar y probar siguiente método
    }
  }

  // Método B: GET /Ticket/<ID> y buscar campo "validation_percent" u otros candidatos
  try {
    const r = await req('GET', `/Ticket/${TICKET_ID}?expand_dropdowns=true`, undefined, sessionHeader);
    if (r.ok && r.json) {
      const ticket = r.json;
      // Candidatos conocidos en GLPI base
      for (const k of ['validation_percent', 'percent_done', 'global_validation', '_plugin_fields']) {
        if (k in ticket) return { value: ticket[k], method: `GET /Ticket campo '${k}'`, raw: ticket };
      }
      // Buscar campos con keywords
      for (const [k, v] of Object.entries(ticket)) {
        if (/progres|avance|percent|plugin_field/i.test(k)) {
          return { value: v, method: `GET /Ticket campo '${k}'`, raw: ticket };
        }
      }
    }
  } catch { /* ignorar */ }

  // Método C: PluginFieldsTicket
  try {
    const r = await req('GET', `/PluginFieldsTicket?searchText[items_id]=${TICKET_ID}`, undefined, sessionHeader);
    if (r.ok && r.json) {
      return { value: r.json, method: 'GET /PluginFieldsTicket', raw: r.json };
    }
  } catch { /* ignorar */ }

  return { value: null, method: 'no detectado', raw: null };
}

// ─── Comparar valores antes/después ──────────────────────────────────────────
function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Intentar PUT y verificar cambio real ─────────────────────────────────────
async function tryPayloadAndVerify(label, payload, sessionHeader, searchOptId, beforeValue) {
  console.log(`\n  ◆ ${label}`);
  console.log(`    Payload: ${JSON.stringify(payload).slice(0, 200)}`);

  // PUT
  let putResult = null;
  try {
    const r = await req('PUT', `/Ticket/${TICKET_ID}`, payload, sessionHeader);
    putResult = { ok: r.ok, status: r.status, json: r.json };
    if (!r.ok) {
      console.log(`    PUT: ❌ HTTP ${r.status} — ${JSON.stringify(r.json).slice(0, 200)}`);
      return { result: 'error', putStatus: r.status };
    }
    console.log(`    PUT: ✅ HTTP ${r.status} (respuesta: ${JSON.stringify(r.json).slice(0, 100)})`);
  } catch (e) {
    console.log(`    PUT: ❌ Error — ${e.message}`);
    return { result: 'error', error: e.message };
  }

  // Leer valor real después
  await new Promise(r => setTimeout(r, 300)); // pequeña pausa para que GLPI procese
  const afterResult = await readProgressValue(sessionHeader, searchOptId);

  if (afterResult.value === null && beforeValue === null) {
    console.log(`    Verificación: ⚠️  Campo no detectable — HTTP 200 pero sin lectura posible`);
    console.log(`                  GLPI puede haber ignorado el payload silenciosamente.`);
    return { result: 'unverifiable' };
  }

  if (valuesEqual(afterResult.value, beforeValue)) {
    console.log(`    Verificación: ⚠️  HTTP OK pero SIN CAMBIO real (valor: ${JSON.stringify(afterResult.value)})`);
    console.log(`                  GLPI ignoró el payload — campo/estructura incorrecta.`);
    return { result: 'no_change', value: afterResult.value };
  }

  console.log(`    Verificación: ✅ CAMBIO CONFIRMADO`);
  console.log(`      ANTES : ${JSON.stringify(beforeValue)}`);
  console.log(`      DESPUÉS: ${JSON.stringify(afterResult.value)}`);
  console.log(`      Método lectura: ${afterResult.method}`);
  return { result: 'changed', before: beforeValue, after: afterResult.value, method: afterResult.method };
}

// ─── Auto-detectar search option ID del campo progreso ───────────────────────
async function autoDetectSearchOptId(sessionHeader) {
  try {
    const r = await req('GET', '/listSearchOptions/Ticket', undefined, sessionHeader);
    if (!r.ok) return null;
    const keywords = ['progres', 'avance', 'metric', 'gestion', 'gestión'];
    for (const [id, opt] of Object.entries(r.json || {})) {
      const str = JSON.stringify(opt).toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (keywords.some(kw => str.includes(kw))) {
        return parseInt(id, 10);
      }
    }
  } catch { /* ignorar */ }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════');
console.log('   GLPI Progress Field Test — verificación real de cambio');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Ticket: #${TICKET_ID}   Valor: ${PERCENT_VAL}%   Valor GLPI: ${GLPI_VALUE}`);
console.log(`  Search Opt ID: ${CLI_OPT_ID ?? ENV_OPT_ID ?? 'auto-detectar'}`);
console.log('──────────────────────────────────────────────────────────\n');

// initSession
let SH = {};
try {
  const r = await req('GET', '/initSession', undefined, { Authorization: `user_token ${USER_TOKEN}` });
  if (!r.ok || !r.json?.session_token) {
    console.error('❌ initSession:', r.status); process.exit(1);
  }
  SH = { 'Session-Token': r.json.session_token };
  console.log('✅ initSession\n');
} catch (e) { console.error('❌', e.message); process.exit(1); }

// Determinar search option ID
let searchOptId = CLI_OPT_ID ?? ENV_OPT_ID;
if (!searchOptId) {
  process.stdout.write('  Auto-detectando search option ID del campo progreso... ');
  searchOptId = await autoDetectSearchOptId(SH);
  if (searchOptId) {
    console.log(`✅ Encontrado: ID ${searchOptId}`);
    console.log(`  💡 Para evitar la auto-detección: node ... ${TICKET_ID} ${PERCENT_VAL} ${searchOptId}`);
    console.log(`  💡 O agregar en .env: GLPI_PROGRESS_SEARCH_OPT_ID=${searchOptId}`);
  } else {
    console.log('⚠️  No detectado — se usará GET /Ticket y PluginFieldsTicket como fallback');
  }
}

// Leer valor ANTES
console.log('\n── Valor inicial ────────────────────────────────────────────');
const beforeResult = await readProgressValue(SH, searchOptId);
console.log(`  Valor: ${JSON.stringify(beforeResult.value)}`);
console.log(`  Método lectura: ${beforeResult.method}`);

const beforeValue = beforeResult.value;

// ─── Probar payloads estructurados (solo cuando el campo real esté descubierto) ──
console.log('\n── Probando payloads de escritura ───────────────────────────');
console.log('  (No se declara éxito por HTTP 200 — se verifica el cambio real)\n');

const results = [];

// Payload A
results.push(await tryPayloadAndVerify(
  'Payload A — _plugin_fields anidado con plugin_fields_progresodelticketfielddropdowns_id',
  { input: { _plugin_fields: { plugin_fields_mtricasdegestincontainers: { plugin_fields_progresodelticketfielddropdowns_id: GLPI_VALUE } } } },
  SH, searchOptId, beforeValue
));

// Payload B
results.push(await tryPayloadAndVerify(
  'Payload B — _plugin_fields anidado con PluginFieldsTicketmtricasdegestin',
  { input: { _plugin_fields: { PluginFieldsTicketmtricasdegestin: { plugin_fields_progresodelticketfielddropdowns_id: GLPI_VALUE } } } },
  SH, searchOptId, beforeValue
));

// Payload C
results.push(await tryPayloadAndVerify(
  'Payload C — campo plano plugin_fields_progresodelticketfielddropdowns_id',
  { input: { plugin_fields_progresodelticketfielddropdowns_id: GLPI_VALUE } },
  SH, searchOptId, beforeValue
));

// Payload D
if (searchOptId) {
  results.push(await tryPayloadAndVerify(
    `Payload D — _${searchOptId} directo con GLPI_VALUE`,
    { input: { [`_${searchOptId}`]: GLPI_VALUE } },
    SH, searchOptId, beforeValue
  ));
}


// ─── Resumen ──────────────────────────────────────────────────────────────────
console.log('\n── Resumen ──────────────────────────────────────────────────');

const changed = results.filter(r => r.result === 'changed');
const noChange = results.filter(r => r.result === 'no_change');
const errors = results.filter(r => r.result === 'error');
const unverifiable = results.filter(r => r.result === 'unverifiable');

if (changed.length > 0) {
  console.log(`✅ ${changed.length} payload(s) confirmaron CAMBIO REAL en GLPI.`);
  for (const r of changed) {
    console.log(`   Método: ${r.method}`);
  }
  console.log('\n💡 Copiar el payload que funcionó al archivo:');
  console.log('   lib/glpi/glpi-write-client.ts → updateTicketProgress()');
} else if (unverifiable.length === results.length) {
  console.log('⚠️  No se pudo verificar si el campo cambió (campo no detectable por API).');
  console.log('   Verificar manualmente en la UI de GLPI.');
  console.log('\n💡 Correr primero:');
  console.log('   node scripts/glpi-discover-progress-field.mjs ' + TICKET_ID);
  console.log('   para encontrar el search option ID correcto.');
} else {
  console.log('❌ GLPI ignoró todos los payloads — el campo NO fue actualizado.');
  console.log('   Ni estructura, nombre ni tipo de valor coincidieron con lo que GLPI espera.');
  console.log('\n💡 Próximos pasos:');
  console.log('   1. Correr: node scripts/glpi-discover-progress-field.mjs ' + TICKET_ID);
  console.log('   2. Identificar el search option ID exacto del campo progreso.');
  console.log('   3. Correr: node scripts/glpi-progress-test.mjs ' + TICKET_ID + ' 25 <SEARCH_OPT_ID>');
  console.log('   4. Si el campo es dropdown, obtener los IDs y configurar GLPI_PROGRESS_MAP_* en .env');
}

if (noChange.length > 0) {
  console.log(`\n  ${noChange.length} payload(s) con HTTP 200 pero sin cambio real (GLPI los ignoró silenciosamente).`);
}
if (errors.length > 0) {
  console.log(`  ${errors.length} payload(s) con error HTTP.`);
}

// killSession
try { await req('GET', '/killSession', undefined, SH); } catch { /* no crítico */ }
console.log('\n══════════════════════════════════════════════════════════\n');
