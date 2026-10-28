#!/usr/bin/env node
/**
 * glpi-followup-test.mjs
 * Script para probar distintas variantes de creación de seguimientos (ITILFollowup) en GLPI.
 *
 * Uso: node scripts/glpi-followup-test.mjs <TICKET_ID> <visibility>
 *   visibility: 'private' (interno) o 'public' (visible al solicitante)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"](.*)['"]$/, '$1');
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
const TIMEOUT_MS = parseInt(process.env.GLPI_WRITE_TIMEOUT_MS || '15000', 10);

const TICKET_ID = parseInt(process.argv[2] || '0', 10);
const VISIBILITY = (process.argv[3] || 'private').toLowerCase();
const isPrivate = VISIBILITY === 'private' ? 1 : 0;
const isPrivateBool = VISIBILITY === 'private';

if (!BASE_URL || !APP_TOKEN || !USER_TOKEN) {
  console.error('❌ Faltan vars de entorno GLPI'); process.exit(1);
}
if (!TICKET_ID || isNaN(TICKET_ID)) {
  console.error('❌ Uso: node scripts/glpi-followup-test.mjs <TICKET_ID> <private|public>');
  process.exit(1);
}

import { Agent, fetch as undiciFetch } from 'undici';

const dispatcher = process.env.GLPI_ALLOW_SELF_SIGNED === 'true'
  ? new Agent({ connect: { rejectUnauthorized: false } })
  : undefined;

// ─── HTTP helper ──────────────────────────────────────────────────────────────
async function req(method, endpoint, body, extraHeaders = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = { 'Content-Type': 'application/json', 'App-Token': APP_TOKEN, ...extraHeaders };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const fetchOptions = {
      method, headers, signal: ctrl.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(dispatcher ? { dispatcher } : {})
    };
    const r = await undiciFetch(url, fetchOptions);
    const text = await r.text().catch(() => '');
    let json = null;
    try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 500) }; }

    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Timeout ${TIMEOUT_MS}ms`);
    throw e;
  } finally { clearTimeout(t); }
}

function safeStringify(obj) {
  return JSON.stringify(obj).replace(/([a-zA-Z0-9+/=_\-]{30,})/g, '***REDACTED***');
}

async function runTests() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('   GLPI Followup Test');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Ticket: #${TICKET_ID}   Visibilidad: ${VISIBILITY}`);
  console.log('──────────────────────────────────────────────────────────\n');

  let sessionHeader = {};
  try {
    const r = await req('GET', '/initSession', undefined, { Authorization: `user_token ${USER_TOKEN}` });
    if (!r.ok || !r.json?.session_token) {
      console.error('❌ initSession falló:', r.status); process.exit(1);
    }
    sessionHeader = { 'Session-Token': r.json.session_token };
    console.log('✅ initSession exitoso\n');
  } catch (e) {
    console.error('❌', e.message); process.exit(1);
  }

  const payloads = [
    {
      label: 'A) POST /Ticket/{id}/ITILFollowup - sin items_id',
      method: 'POST',
      endpoint: `/Ticket/${TICKET_ID}/ITILFollowup`,
      body: { input: { content: `Test A (${VISIBILITY})`, is_private: isPrivate } }
    },
    {
      label: 'B) POST /Ticket/{id}/ITILFollowup - con items_id y itemtype',
      method: 'POST',
      endpoint: `/Ticket/${TICKET_ID}/ITILFollowup`,
      body: { input: { items_id: TICKET_ID, itemtype: 'Ticket', content: `Test B (${VISIBILITY})`, is_private: isPrivate } }
    },
    {
      label: 'C) POST /ITILFollowup - con items_id y itemtype',
      method: 'POST',
      endpoint: `/ITILFollowup`,
      body: { input: { items_id: TICKET_ID, itemtype: 'Ticket', content: `Test C (${VISIBILITY})`, is_private: isPrivate } }
    },
    {
      label: 'D) POST /ITILFollowup - con tickets_id (estilo plugin/especial)',
      method: 'POST',
      endpoint: `/ITILFollowup`,
      body: { input: { tickets_id: TICKET_ID, content: `Test D (${VISIBILITY})`, is_private: isPrivate } }
    },
    {
      label: 'E) POST /ITILFollowup - is_private como boolean (items_id/itemtype)',
      method: 'POST',
      endpoint: `/ITILFollowup`,
      body: { input: { items_id: TICKET_ID, itemtype: 'Ticket', content: `Test E (${VISIBILITY})`, is_private: isPrivateBool } }
    }
  ];

  for (const test of payloads) {
    console.log(`◆ Probando: ${test.label}`);
    try {
      const res = await req(test.method, test.endpoint, test.body, sessionHeader);
      if (res.ok) {
        console.log(`  ✅ ÉXITO (HTTP ${res.status})`);
        console.log(`  Respuesta: ${safeStringify(res.json).slice(0, 200)}\n`);
      } else {
        console.log(`  ❌ FALLÓ (HTTP ${res.status})`);
        console.log(`  Error: ${safeStringify(res.json).slice(0, 300)}\n`);
      }
    } catch (e) {
      console.log(`  ❌ ERROR LOCAL: ${e.message}\n`);
    }
  }

  try {
    await req('GET', '/killSession', undefined, sessionHeader);
    console.log('✅ killSession exitoso\n');
  } catch {
    console.log('⚠️ killSession falló (no crítico)\n');
  }
}

runTests().catch(e => console.error(e));
