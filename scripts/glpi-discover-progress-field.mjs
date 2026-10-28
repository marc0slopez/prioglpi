#!/usr/bin/env node
/**
 * glpi-discover-progress-field.mjs
 * Descubre el campo plugin "Progreso del Ticket" usando la API REST de GLPI.
 *
 * Estrategia:
 *   1. GET /listSearchOptions/Ticket  → busca todas las opciones de búsqueda
 *      que contengan palabras clave de progreso / plugin / métrica.
 *   2. Si encuentra el campo, hace GET /search/Ticket con forcedisplay del ID
 *      encontrado para el ticket especificado y muestra el valor real.
 *   3. También intenta endpoints de plugin fields directos para exploración.
 *
 * Uso: node scripts/glpi-discover-progress-field.mjs <TICKET_ID>
 * NUNCA imprime tokens.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Cargar .env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim()
        .replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch { console.error('❌ No se pudo leer .env'); process.exit(1); }
}
loadEnv();

const BASE_URL = (process.env.GLPI_API_BASE_URL || process.env.GLPI_BASE_URL || '').replace(/\/$/, '');
const APP_TOKEN = process.env.GLPI_APP_TOKEN || '';
const USER_TOKEN = process.env.GLPI_USER_TOKEN || '';
const TIMEOUT_MS = parseInt(process.env.GLPI_WRITE_TIMEOUT_MS || process.env.GLPI_TIMEOUT_MS || '20000', 10);
const TICKET_ID  = parseInt(process.argv[2] || '0', 10);

if (!BASE_URL || !APP_TOKEN || !USER_TOKEN) {
  console.error('❌ Faltan vars de entorno GLPI (GLPI_BASE_URL, GLPI_APP_TOKEN, GLPI_USER_TOKEN)');
  process.exit(1);
}
if (!TICKET_ID || isNaN(TICKET_ID)) {
  console.error('❌ Uso: node scripts/glpi-discover-progress-field.mjs <TICKET_ID>');
  process.exit(1);
}

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
    try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 800) }; }
    return { ok: r.ok, status: r.status, json, headers: r.headers };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Timeout ${TIMEOUT_MS}ms: ${endpoint}`);
    throw e;
  } finally { clearTimeout(t); }
}

// ─── Redactar tokens del output ───────────────────────────────────────────────
function redact(obj) {
  if (typeof obj === 'string') return obj.replace(/[a-zA-Z0-9+/=_\-]{30,}/g, v =>
    /(token|Token|TOKEN|key|KEY)/i.test(v) ? '***' : v);
  if (Array.isArray(obj)) return obj.map(redact);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = /token|password|secret|credential|apikey/i.test(k) ? '***REDACTED***' : redact(v);
    }
    return out;
  }
  return obj;
}

// ─── Palabras clave para buscar el campo plugin ───────────────────────────────
const KEYWORDS = [
  'progres', 'progress', 'metric', 'métric', 'metric',
  'gestión', 'gestion', 'plugin', 'avance', 'advance',
  'percent', 'porcentaje', 'campo', 'field',
];

function matchesKeywords(str) {
  if (typeof str !== 'string') return false;
  const lower = str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quitar tildes para comparar
  return KEYWORDS.some(kw => lower.includes(kw.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
}

function optionMatchesKeywords(opt) {
  if (typeof opt !== 'object' || !opt) return false;
  return Object.values(opt).some(v => matchesKeywords(String(v ?? '')));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════');
console.log('   GLPI Progress Field Discoverer');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Base URL : ${BASE_URL}`);
console.log(`  Ticket   : #${TICKET_ID}`);
console.log(`  Timeout  : ${TIMEOUT_MS}ms`);
console.log('──────────────────────────────────────────────────────────\n');

// 1. initSession
let SH = {};
{
  process.stdout.write('1. initSession... ');
  const r = await req('GET', '/initSession', undefined, { Authorization: `user_token ${USER_TOKEN}` });
  if (!r.ok || !r.json?.session_token) {
    console.log(`❌ HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
    process.exit(1);
  }
  SH = { 'Session-Token': r.json.session_token };
  console.log('✅\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /listSearchOptions/Ticket — buscar opciones de campo
// ─────────────────────────────────────────────────────────────────────────────
console.log('── PASO 1: GET /listSearchOptions/Ticket ────────────────────');
let foundOptions = {};
{
  const r = await req('GET', '/listSearchOptions/Ticket', undefined, SH);
  console.log(`  HTTP: ${r.status}`);

  if (r.ok && r.json && typeof r.json === 'object') {
    const opts = r.json;
    const total = Object.keys(opts).length;
    console.log(`  Total opciones: ${total}`);
    console.log('');

    // Filtrar las que coinciden con keywords
    for (const [id, opt] of Object.entries(opts)) {
      if (optionMatchesKeywords(opt)) {
        foundOptions[id] = opt;
      }
    }

    if (Object.keys(foundOptions).length === 0) {
      console.log('  ⚠️  No se encontró ninguna opción de búsqueda con palabras clave de progreso/plugin.');
      console.log('  → Imprimiendo TODAS las opciones que mencionen "plugin" en tabla o nombre:\n');

      // Segundo intento más amplio: solo "plugin"
      for (const [id, opt] of Object.entries(opts)) {
        const str = JSON.stringify(opt).toLowerCase();
        if (str.includes('plugin')) {
          foundOptions[id] = opt;
        }
      }
    }

    if (Object.keys(foundOptions).length > 0) {
      console.log(`  ✅ Opciones relevantes encontradas (${Object.keys(foundOptions).length}):\n`);
      for (const [id, opt] of Object.entries(foundOptions)) {
        console.log(`  ── Search Option ID: ${id} ──`);
        console.log(JSON.stringify(opt, null, 4));
        console.log('');
      }
    } else {
      console.log('  ❌ No se encontró ningún campo con "plugin" en listSearchOptions/Ticket.');
      console.log('     El plugin puede no estar expuesto en la API REST o puede requerir permisos adicionales.');

      // Imprimir muestra de las últimas 30 opciones (IDs altos = probablemente plugins)
      const allIds = Object.keys(opts).map(Number).filter(n => !isNaN(n)).sort((a, b) => b - a);
      const sampleIds = allIds.slice(0, 30);
      console.log(`\n  Muestra de opciones con IDs altos (últimas ${sampleIds.length}):`);
      for (const id of sampleIds) {
        const opt = opts[id];
        if (opt && typeof opt === 'object') {
          const name = opt.name || opt.field || opt.table || '(sin nombre)';
          console.log(`    ID ${id}: ${name} | table: ${opt.table || '-'} | field: ${opt.field || '-'} | type: ${opt.datatype || '-'}`);
        }
      }
    }
  } else {
    console.log(`  ❌ Respuesta inesperada: ${JSON.stringify(r.json).slice(0, 300)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Si encontramos search options, usar /search/Ticket para leer el valor real
// ─────────────────────────────────────────────────────────────────────────────
if (Object.keys(foundOptions).length > 0) {
  console.log('\n── PASO 2: GET /search/Ticket — leer valor real del ticket ────');

  const optIds = Object.keys(foundOptions);
  // forcedisplay: [{ "link": "AND", "field": ID, "searchtype": "contains", "value": "" }]
  // criteria: buscar por ID exacto del ticket
  const criteriaParam = encodeURIComponent(JSON.stringify([
    { field: '2', searchtype: 'equals', value: String(TICKET_ID) }
  ]));
  const forcedisplayParam = optIds.map((id, i) => `forcedisplay[${i}]=${id}`).join('&');
  const searchUrl = `/search/Ticket?criteria[0][field]=2&criteria[0][searchtype]=equals&criteria[0][value]=${TICKET_ID}&${forcedisplayParam}&rawdata=1`;

  const r = await req('GET', searchUrl, undefined, SH);
  console.log(`  HTTP: ${r.status}`);

  if (r.ok && r.json) {
    const data = r.json?.data;
    if (Array.isArray(data) && data.length > 0) {
      console.log(`  ✅ Ticket encontrado. Datos relevantes:`);
      for (const row of data) {
        console.log(JSON.stringify(row, null, 2));
      }
    } else {
      console.log('  ⚠️  No se retornaron datos del ticket en la búsqueda.');
      console.log('      Respuesta completa:');
      console.log(JSON.stringify(r.json, null, 2).slice(0, 2000));
    }
  } else {
    console.log(`  Respuesta: ${JSON.stringify(r.json).slice(0, 400)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Explorar endpoints de plugin fields directamente
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── PASO 3: Exploración directa de endpoints plugin fields ─────');

const pluginEndpoints = [
  // Endpoint estándar del plugin "Plugin Fields" de GLPI
  `/PluginFieldsTicket?searchText[items_id]=${TICKET_ID}&expand_dropdowns=true`,
  `/PluginFieldsTicket?criteria[0][field]=4&criteria[0][searchtype]=equals&criteria[0][value]=${TICKET_ID}`,
  // Nombres alternativos conocidos del container/plugin
  `/plugin_fields_ticket_mtricasdegestincontainers?searchText[items_id]=${TICKET_ID}`,
  `/plugin_fields_ticket_mtricasdegestin?searchText[items_id]=${TICKET_ID}`,
  `/PluginFieldsTicket`,
  // Buscar via search
  `/search/PluginFieldsTicket?criteria[0][field]=4&criteria[0][searchtype]=equals&criteria[0][value]=${TICKET_ID}`,
  // Listar tipos disponibles
  `/listSearchOptions/PluginFieldsTicket`,
];

for (const ep of pluginEndpoints) {
  const epShort = ep.split('?')[0];
  process.stdout.write(`  GET ${epShort}... `);
  try {
    const r = await req('GET', ep, undefined, SH);
    if (r.ok) {
      console.log(`✅ HTTP ${r.status}`);
      const out = JSON.stringify(r.json, null, 2).slice(0, 1500);
      console.log(out);
      console.log('');
    } else {
      console.log(`❌ HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Buscar en listSearchOptions/Ticket los IDs extremos (campos plugin suelen
//    tener IDs > 1000) e imprimir sus tablas para identificar el container
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── PASO 4: Listado de tablas únicas en listSearchOptions ───────');
{
  const r = await req('GET', '/listSearchOptions/Ticket', undefined, SH);
  if (r.ok && r.json) {
    const tables = new Set();
    for (const [, opt] of Object.entries(r.json)) {
      if (opt?.table) tables.add(opt.table);
    }
    const pluginTables = [...tables].filter(t =>
      /plugin|metric|gestión|gestion|progres/i.test(t)
    );
    if (pluginTables.length > 0) {
      console.log('  Tablas de plugin encontradas en searchOptions:');
      for (const t of pluginTables) {
        console.log(`    ${t}`);

        // Para cada tabla de plugin, intentar acceder al endpoint directamente
        const tableName = t.replace(/^glpi_/, '');
        const capName = tableName.charAt(0).toUpperCase() + tableName.slice(1);
        for (const ep of [`/${capName}?searchText[items_id]=${TICKET_ID}`, `/${tableName}?searchText[items_id]=${TICKET_ID}`]) {
          try {
            const pr = await req('GET', ep, undefined, SH);
            if (pr.ok) {
              console.log(`    ✅ ${ep.split('?')[0]}: HTTP ${pr.status}`);
              console.log(`       ${JSON.stringify(pr.json, null, 2).slice(0, 600)}`);
              break;
            }
          } catch { /* ignorar */ }
        }
      }
    } else {
      console.log('  ⚠️  No se encontraron tablas de plugin en searchOptions.');
      console.log('  Todas las tablas únicas:');
      for (const t of [...tables].sort()) console.log(`    ${t}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. GET /Ticket/<ID> con rawdata y expand_dropdowns — ver todos los campos
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n── PASO 5: GET /Ticket/${TICKET_ID} completo (expand_dropdowns) ──`);
{
  const r = await req('GET', `/Ticket/${TICKET_ID}?expand_dropdowns=true`, undefined, SH);
  if (r.ok) {
    const ticket = redact(r.json);
    // Buscar campos que puedan referirse a progreso
    const progFields = {};
    for (const [k, v] of Object.entries(ticket)) {
      if (matchesKeywords(k) || matchesKeywords(String(v ?? ''))) {
        progFields[k] = v;
      }
    }
    if (Object.keys(progFields).length > 0) {
      console.log('  Campos con coincidencia de keywords:');
      console.log(JSON.stringify(progFields, null, 2));
    } else {
      console.log('  ⚠️  No hay campos con keywords de progreso en GET /Ticket.');
    }
    console.log('\n  Campos disponibles del ticket (nombres):');
    console.log(' ', Object.keys(ticket).join(', '));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Explorar opciones del dropdown PluginFieldsProgresodelticketfieldDropdown
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── PASO 6: Explorar opciones del dropdown (PluginFieldsProgresodelticketfieldDropdown) ──');
const dropdownEps = [
  '/PluginFieldsProgresodelticketfieldDropdown?range=0-500',
  '/search/PluginFieldsProgresodelticketfieldDropdown?range=0-500',
  '/listSearchOptions/PluginFieldsProgresodelticketfieldDropdown'
];

for (const ep of dropdownEps) {
  process.stdout.write(`  GET ${ep.split('?')[0]}... `);
  try {
    const r = await req('GET', ep, undefined, SH);
    if (r.ok && r.json) {
      console.log(`✅ HTTP ${r.status}`);
      let items = [];
      if (Array.isArray(r.json)) items = r.json;
      else if (r.json.data && Array.isArray(r.json.data)) items = r.json.data;

      if (items.length > 0) {
        console.log(`    Encontradas ${items.length} opciones:`);
        for (const it of items) {
          const id = it.id || it['2']; // En search el id suele ser el field 2
          const name = it.name || it.completename || it['1'] || it['completename'];
          console.log(`      - ID: ${id} | Nombre: ${name}`);
        }
      } else {
        console.log(`    (Respuesta no es array u opciones no encontradas)`);
      }
    } else {
      console.log(`❌ HTTP ${r.status}`);
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }
}

// killSession
try { await req('GET', '/killSession', undefined, SH); } catch { /* no crítico */ }

console.log('\n══════════════════════════════════════════════════════════');
console.log('  Resultado: correr este output y compartirlo para');
console.log('  determinar el endpoint/campo correcto del plugin.');
console.log('══════════════════════════════════════════════════════════\n');
