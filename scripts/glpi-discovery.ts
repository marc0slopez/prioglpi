/**
 * Script de descubrimiento GLPI — Fase 0
 *
 * Ejecutar con: npm run glpi:discover
 *
 * Valida:
 * 1. initSession funciona
 * 2. Grupos: Sistemas=30, Tecnología=32
 * 3. Muestra de tickets
 * 4. killSession
 *
 * NO imprime tokens.
 */

import 'dotenv/config';
import { Agent, fetch as undiciFetch } from 'undici';

// Dispatcher acotado para self-signed (solo GLPI)
const glpiDispatcher = process.env.GLPI_ALLOW_SELF_SIGNED === 'true'
  ? new Agent({ connect: { rejectUnauthorized: false } })
  : undefined;

const BASE_URL = process.env.GLPI_BASE_URL || '';
const APP_TOKEN = process.env.GLPI_APP_TOKEN || '';
const USER_TOKEN = process.env.GLPI_USER_TOKEN || '';

async function glpiGet(endpoint: string, sessionToken?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'App-Token': APP_TOKEN,
  };
  if (sessionToken) headers['Session-Token'] = sessionToken;
  if (!sessionToken && endpoint === '/initSession') {
    headers['Authorization'] = `user_token ${USER_TOKEN}`;
  }

  const fetchOptions: Parameters<typeof undiciFetch>[1] = {
    method: 'GET',
    headers,
    ...(glpiDispatcher ? { dispatcher: glpiDispatcher } : {})
  };

  const res = await undiciFetch(`${BASE_URL}${endpoint}`, fetchOptions);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

async function main() {
  console.log('='.repeat(60));
  console.log('APPGLPI v3 — Descubrimiento GLPI');
  console.log('='.repeat(60));
  console.log(`Base URL: ${BASE_URL.replace(/\/apirest\.php$/, '')}`);
  console.log(`Tokens: [PROTEGIDOS]`);
  console.log('');

  try {
    // 1. initSession
    console.log('📡 1. Probando initSession...');
    let sessionToken: string;
    try {
      const session = await glpiGet('/initSession');
      sessionToken = (session as Record<string, unknown>).session_token as string;
      console.log('   ✅ session_token obtenido.');
    } catch (err) {
      console.error('   ❌ Error:', (err as Error).message);
      process.exit(1);
    }

    // 2. Grupos
    console.log('');
    console.log('📡 2. Consultando grupos...');
    try {
      const groups = await glpiGet('/Group/?range=0-500', sessionToken) as Array<{ id: number, name: string, sons_cache: string }>;
      const sistemas = groups.find((g) => g.id === 30);
      const tecnologia = groups.find((g) => g.id === 32);

      if (sistemas) {
        console.log(`   ✅ Sistemas: id=${sistemas.id}, name="${sistemas.name}"`);
        console.log(`      sons_cache: ${sistemas.sons_cache || 'N/A'}`);
      } else {
        console.log('   ⚠️ Grupo Sistemas (id=30) NO encontrado.');
      }

      if (tecnologia) {
        console.log(`   ✅ Tecnología: id=${tecnologia.id}, name="${tecnologia.name}"`);
        console.log(`      sons_cache: ${tecnologia.sons_cache || 'N/A'}`);
      } else {
        console.log('   ⚠️ Grupo Tecnología (id=32) NO encontrado.');
      }

      console.log(`   Total grupos: ${groups.length}`);
    } catch (err) {
      console.error('   ❌ Error:', (err as Error).message);
    }

    // 3. Opciones de búsqueda
    console.log('');
    console.log('📡 3. Consultando listSearchOptions/Ticket...');
    try {
      const opts = await glpiGet('/listSearchOptions/Ticket', sessionToken) as Record<string, unknown>;
      const keys = Object.keys(opts);
      console.log(`   ✅ ${keys.length} opciones de búsqueda disponibles.`);
    } catch (err) {
      console.error('   ❌ Error:', (err as Error).message);
    }

    // 4. Muestra de tickets
    console.log('');
    console.log('📡 4. Consultando tickets (rango 0-20)...');
    try {
      const tickets = await glpiGet('/Ticket?range=0-20&expand_dropdowns=true', sessionToken) as Array<{ id: number, name?: string, status: number, priority: number }>;
      console.log(`   ✅ ${tickets.length} tickets obtenidos.`);

      if (tickets.length > 0) {
        console.log('');
        console.log('   Primeros 5 tickets:');
        for (const t of tickets.slice(0, 5)) {
          console.log(`   - #${t.id} | ${t.name?.substring(0, 60)} | status=${t.status} | priority=${t.priority}`);
        }
      }
    } catch (err) {
      console.error('   ❌ Error:', (err as Error).message);
    }

    // 5. killSession
    console.log('');
    console.log('📡 5. Cerrando sesión GLPI...');
    try {
      await glpiGet('/killSession', sessionToken);
      console.log('   ✅ Sesión cerrada.');
    } catch (err) {
      console.error('   ⚠️ Error al cerrar sesión:', (err as Error).message);
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Descubrimiento completado.');
    console.log('='.repeat(60));
  } finally {
    if (glpiDispatcher) {
      await glpiDispatcher.close();
    }
  }
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
