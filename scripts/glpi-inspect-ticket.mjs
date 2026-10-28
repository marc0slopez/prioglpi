#!/usr/bin/env node
/**
 * glpi-inspect-ticket.mjs
 * Script de inspección de campos GLPI de un ticket.
 * Muestra: time_to_resolve, _plugin_fields, campos de avance y respuesta completa filtrada.
 * NUNCA imprime tokens.
 *
 * Uso: node scripts/glpi-inspect-ticket.mjs <TICKET_ID>
 *
 * Requiere: .env en la raíz del proyecto con GLPI_BASE_URL / GLPI_API_BASE_URL,
 *           GLPI_APP_TOKEN, GLPI_USER_TOKEN.
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
        .replace(/^'(.*)'$/, '$1')
        .replace(/^"(.*)"$/, '$1');
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch {
    console.error('❌ No se pudo leer .env');
    process.exit(1);
  }
}
loadEnv();

const BASE_URL = (process.env.GLPI_API_BASE_URL || process.env.GLPI_BASE_URL || '').replace(/\/$/, '');
const APP_TOKEN = process.env.GLPI_APP_TOKEN || '';
const USER_TOKEN = process.env.GLPI_USER_TOKEN || '';
const TIMEOUT_MS = parseInt(process.env.GLPI_WRITE_TIMEOUT_MS || process.env.GLPI_TIMEOUT_MS || '15000', 10);

const TICKET_ID = parseInt(process.argv[2] || '0', 10);

if (!BASE_URL) { console.error('❌ GLPI_API_BASE_URL / GLPI_BASE_URL no configurado'); process.exit(1); }
if (!APP_TOKEN || !USER_TOKEN) { console.error('❌ GLPI_APP_TOKEN o GLPI_USER_TOKEN no configurado'); process.exit(1); }
if (!TICKET_ID || isNaN(TICKET_ID) || TICKET_ID < 1) {
  console.error('❌ Ticket ID inválido. Uso: node scripts/glpi-inspect-ticket.mjs <TICKET_ID>');
  process.exit(1);
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────
async function glpiRequest(method, endpoint, body, extraHeaders = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'App-Token': APP_TOKEN,
    ...extraHeaders,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const opts = {
      method,
      headers,
      signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    const res = await fetch(url, opts);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = { _rawText: text.slice(0, 500) }; }
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout (${TIMEOUT_MS}ms)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Redactar tokens del output ───────────────────────────────────────────────
function redactTokens(obj) {
  if (typeof obj === 'string') {
    return obj.replace(/(token|Token|TOKEN)([^":\s]*\s*[:=]\s*)["']?[a-zA-Z0-9+/=_\-]{10,}["']?/g,
      '$1$2"***REDACTED***"');
  }
  if (Array.isArray(obj)) return obj.map(redactTokens);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/token|password|secret|credential/i.test(k)) {
        out[k] = '***REDACTED***';
      } else {
        out[k] = redactTokens(v);
      }
    }
    return out;
  }
  return obj;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('   GLPI Ticket Inspector');
console.log('══════════════════════════════════════════════════════');
console.log(`  Ticket: #${TICKET_ID}   Base: ${BASE_URL}`);
console.log('──────────────────────────────────────────────────────\n');

// 1. initSession
let sessionToken = null;
try {
  const res = await glpiRequest('GET', '/initSession', undefined, {
    Authorization: `user_token ${USER_TOKEN}`,
  });
  if (!res.ok || !res.json?.session_token) {
    console.error('❌ initSession falló:', res.status, JSON.stringify(res.json).slice(0, 200));
    process.exit(1);
  }
  sessionToken = res.json.session_token;
  console.log('✅ initSession OK\n');
} catch (e) {
  console.error('❌ initSession error:', e.message);
  process.exit(1);
}

const SESSION_HEADER = { 'Session-Token': sessionToken };

// 2. GET Ticket base
console.log(`── GET /Ticket/${TICKET_ID} ─────────────────────────────────`);
let ticketBase = null;
try {
  const res = await glpiRequest('GET', `/Ticket/${TICKET_ID}`, undefined, SESSION_HEADER);
  if (!res.ok) {
    console.error('❌ GET Ticket falló:', res.status, JSON.stringify(res.json).slice(0, 300));
  } else {
    ticketBase = res.json;
    console.log('  Nombre        :', ticketBase.name?.slice(0, 80));
    console.log('  Estado        :', ticketBase.status);
    console.log('  time_to_resolve:', ticketBase.time_to_resolve ?? '(vacío)');
    console.log('  date_creation :', ticketBase.date_creation);
    console.log('  date_mod      :', ticketBase.date_mod);

    // Campos que mencionan "progreso" o "plugin"
    const progressKeys = Object.keys(ticketBase).filter(k =>
      /progres|plugin|avance|advance|percent|field/i.test(k)
    );
    if (progressKeys.length > 0) {
      console.log('\n  ── Campos relacionados con progreso/plugin ──');
      for (const k of progressKeys) {
        console.log(`  ${k}:`, JSON.stringify(ticketBase[k]));
      }
    } else {
      console.log('\n  ⚠️  No se encontraron campos de progreso/plugin en la respuesta base del ticket.');
      console.log('      (El plugin_fields puede requerir expand_dropdowns o endpoint específico)');
    }
  }
} catch (e) {
  console.error('❌ GET Ticket error:', e.message);
}

// 3. GET Ticket con expand_dropdowns
console.log(`\n── GET /Ticket/${TICKET_ID}?expand_dropdowns=true ──────────────`);
try {
  const res = await glpiRequest('GET', `/Ticket/${TICKET_ID}?expand_dropdowns=true`, undefined, SESSION_HEADER);
  if (res.ok) {
    const expandedKeys = Object.keys(res.json).filter(k =>
      /progres|plugin|avance|advance|percent|field/i.test(k)
    );
    if (expandedKeys.length > 0) {
      console.log('  ── Campos con expand_dropdowns ──');
      for (const k of expandedKeys) {
        console.log(`  ${k}:`, JSON.stringify(res.json[k]));
      }
    } else {
      console.log('  ⚠️  Tampoco hay campos de progreso/plugin con expand_dropdowns.');
    }
  }
} catch (e) {
  console.error('  Error:', e.message);
}

// 4. GET Plugin Fields específico (endpoint directo del plugin)
console.log(`\n── GET /PluginFieldsTicket?searchText[items_id]=${TICKET_ID} ──`);
try {
  const res = await glpiRequest(
    'GET',
    `/PluginFieldsTicket?searchText[items_id]=${TICKET_ID}&expand_dropdowns=true`,
    undefined,
    SESSION_HEADER
  );
  console.log('  HTTP:', res.status);
  if (res.ok) {
    console.log('  Respuesta:', JSON.stringify(redactTokens(res.json), null, 2).slice(0, 2000));
  } else {
    console.log('  Respuesta:', JSON.stringify(res.json).slice(0, 300));
  }
} catch (e) {
  console.error('  Error:', e.message);
}

// 5. GET plugin_fields_mtricasdegestincontainers directamente
console.log(`\n── GET /plugin_fields_mtricasdegestincontainers?searchText[items_id]=${TICKET_ID} ──`);
try {
  const res = await glpiRequest(
    'GET',
    `/plugin_fields_mtricasdegestincontainers?searchText[items_id]=${TICKET_ID}&expand_dropdowns=true`,
    undefined,
    SESSION_HEADER
  );
  console.log('  HTTP:', res.status);
  if (res.ok) {
    console.log('  Respuesta:', JSON.stringify(redactTokens(res.json), null, 2).slice(0, 2000));
  } else {
    console.log('  Respuesta:', JSON.stringify(res.json).slice(0, 300));
  }
} catch (e) {
  console.error('  Error:', e.message);
}

// 6. Listar dropdowns disponibles para el campo progreso (si existe como dropdown)
console.log(`\n── GET /Dropdown/PluginFieldsDropdown (búsqueda "progreso") ──`);
try {
  const res = await glpiRequest(
    'GET',
    `/Dropdown/PluginFieldsDropdown?searchText=progres&limit=20`,
    undefined,
    SESSION_HEADER
  );
  console.log('  HTTP:', res.status);
  if (res.ok && Array.isArray(res.json)) {
    console.log(`  ${res.json.length} opciones:`, JSON.stringify(res.json.slice(0, 10)));
  } else {
    console.log('  Respuesta:', JSON.stringify(res.json).slice(0, 300));
  }
} catch (e) {
  console.error('  Error:', e.message);
}

// 7. Respuesta completa del ticket (filtrada de tokens)
console.log(`\n── Respuesta completa GET /Ticket/${TICKET_ID} (sin tokens) ──`);
if (ticketBase) {
  console.log(JSON.stringify(redactTokens(ticketBase), null, 2).slice(0, 4000));
}

// killSession
try {
  await glpiRequest('GET', '/killSession', undefined, SESSION_HEADER);
  console.log('\n✅ killSession OK');
} catch {
  console.log('\n⚠️  killSession no crítico');
}

console.log('\n══════════════════════════════════════════════════════\n');
