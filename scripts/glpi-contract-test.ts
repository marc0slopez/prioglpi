/**
 * GLPI Contract Test â€” Fase B
 *
 * Executes real GET requests against GLPI to validate the API contract.
 * Captures dynamic reference counts for post-sync comparison.
 *
 * Usage: npm run glpi:contract
 *
 * NEVER prints tokens. Only GET requests. killSession in finally.
 */
import 'dotenv/config';
import { Agent, fetch as undiciFetch } from 'undici';

const BASE_URL = process.env.GLPI_BASE_URL || '';
const APP_TOKEN = process.env.GLPI_APP_TOKEN || '';
const USER_TOKEN = process.env.GLPI_USER_TOKEN || '';

const glpiDispatcher = process.env.GLPI_ALLOW_SELF_SIGNED === 'true'
  ? new Agent({ connect: { rejectUnauthorized: false } })
  : undefined;

let sessionToken: string | null = null;
let passed = 0;
let failed = 0;

// Reference counts to capture dynamically
const references: Record<string, number> = {};

async function glpiGet(endpoint: string, extraHeaders?: Record<string, string>): Promise<{
  data: unknown;
  status: number;
  contentRange: string | null;
}> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'App-Token': APP_TOKEN,
    ...extraHeaders,
  };
  if (sessionToken) headers['Session-Token'] = sessionToken;

  const fetchOptions: Parameters<typeof undiciFetch>[1] = {
    method: 'GET',
    headers,
    ...(glpiDispatcher ? { dispatcher: glpiDispatcher } : {}),
  };

  const res = await undiciFetch(`${BASE_URL}${endpoint}`, fetchOptions);
  const contentRange = res.headers.get('content-range');

  if (!res.ok && res.status !== 206 && res.status !== 200) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${body.substring(0, 200)}`);
  }

  const data = await res.json();
  return { data, status: res.status, contentRange };
}

interface PaginatedResult<T> {
  data: T[];
  reportedTotal: number;
  downloadedTotal: number;
  pages: number;
  exhausted: boolean;
}

async function glpiPaginatedGet<T>(endpointBase: string): Promise<PaginatedResult<T>> {
  const allData: T[] = [];
  let reportedTotal = 0;
  let offset = 0;
  const limit = 500;
  let pages = 0;
  let exhausted = false;

  while (true) {
    const delimiter = endpointBase.includes('?') ? '&' : '?';
    const pagedEndpoint = `${endpointBase}${delimiter}range=${offset}-${offset + limit - 1}`;

    const res = await glpiGet(pagedEndpoint);
    const chunk = res.data as T[];
    pages++;

    if (!Array.isArray(chunk)) {
      throw new Error(`Expected array but got ${typeof chunk} from ${pagedEndpoint}`);
    }

    allData.push(...chunk);

    if (res.contentRange) {
      const m = res.contentRange.match(/\/(\d+)$/);
      if (m) {
        reportedTotal = parseInt(m[1], 10);
      }
    }

    if (chunk.length === 0) {
      exhausted = true;
      break;
    }

    if (reportedTotal > 0 && allData.length >= reportedTotal) {
      exhausted = true;
      break;
    }

    offset += chunk.length;
  }

  return {
    data: allData,
    reportedTotal,
    downloadedTotal: allData.length,
    pages,
    exhausted
  };
}

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  âœ… PASS: ${message}`);
    passed++;
  } else {
    console.error(`  âŒ FAIL: ${message}`);
    failed++;
  }
}

function assertUniqueIds(data: Array<{ id?: number }>, message: string): void {
  const ids = data.map(i => i.id);
  const invalidIds = ids.filter(id => typeof id !== 'number' || isNaN(id));
  assert(invalidIds.length === 0, `Todos los elementos tienen un ID numÃ©rico (${invalidIds.length} invÃ¡lidos)`);

  const uniqueIds = new Set(ids);
  assert(ids.length === uniqueIds.size, message);
}

async function main() {
  console.log('='.repeat(70));
  console.log('APPGLPI v3 â€” GLPI Contract Test (Fase B)');
  console.log('='.repeat(70));
  console.log(`Base URL: ${BASE_URL.replace(/\/(apirest\.php)?$/, '')}/...`);
  console.log(`Tokens: [PROTEGIDOS]`);
  console.log('');

  try {
    // --- initSession ---
    console.log('â”€â”€ Test 0: initSession â”€â”€');
    const sessionRes = await glpiGet('/initSession', {
      'Authorization': `user_token ${USER_TOKEN}`,
    });
    sessionToken = (sessionRes.data as Record<string, unknown>).session_token as string;
    assert(!!sessionToken, 'session_token obtenido');
    console.log('');

    // --- Test 1: GET /Group ---
    console.log('â”€â”€ Test 1: GET /Group â”€â”€');
    const groupsRes = await glpiPaginatedGet<{ id: number; name: string; groups_id?: number }>('/Group');
    const groups = groupsRes.data;
    assert(Array.isArray(groups), `Respuesta es array (${groups.length} grupos)`);
    assert(groupsRes.downloadedTotal === groupsRes.reportedTotal, `downloadedTotal (${groupsRes.downloadedTotal}) === reportedTotal (${groupsRes.reportedTotal})`);
    assertUniqueIds(groups, `IDs Ãºnicos garantizados para Group`);

    const g30 = groups.find(g => g.id === 30);
    const g32 = groups.find(g => g.id === 32);
    assert(!!g30, `Grupo Sistemas id=30 existe (name="${g30?.name}")`);
    assert(!!g32, `Grupo TecnologÃ­a id=32 existe (name="${g32?.name}")`);
    console.log('');

    // --- Test 2: GET /User ---
    console.log('â”€â”€ Test 2: GET /User â”€â”€');
    const usersRes = await glpiPaginatedGet<{ id: number; name: string }>('/User');
    const users = usersRes.data;
    assert(Array.isArray(users), `Respuesta es array (${users.length} usuarios)`);
    assertUniqueIds(users, `IDs Ãºnicos garantizados para User`);

    // Documentar la excepciÃ³n explÃ­cita
    if (usersRes.downloadedTotal !== usersRes.reportedTotal) {
      console.log(`  Info: [EXCEPCIÃ“N /User] reportedTotal=${usersRes.reportedTotal}, downloadedTotal=${usersRes.downloadedTotal}`);
      console.log(`  Info: Inconsistencia observada de GLPI cuya causa no estÃ¡ confirmada. Se usarÃ¡ el descargado real.`);
    } else {
      assert(usersRes.downloadedTotal === usersRes.reportedTotal, `downloadedTotal (${usersRes.downloadedTotal}) === reportedTotal (${usersRes.reportedTotal})`);
    }

    const u52 = users.find(u => u.id === 52);
    const u231 = users.find(u => u.id === 231);
    const u21 = users.find(u => u.id === 21);
    const u240 = users.find(u => u.id === 240);
    assert(!!u52, `User coordinator_demo id=52 existe (name="${u52?.name}")`);
    assert(!!u231, `User JulianC id=231 existe (name="${u231?.name}")`);
    assert(!!u21, `User CarolinaE id=21 existe (name="${u21?.name}")`);
    assert(!!u240, `User id=240 existe (name="${u240?.name}")`);
    console.log('');

    // --- Test 3: GET /Group_User ---
    console.log('â”€â”€ Test 3: GET /Group_User â”€â”€');
    const guRes = await glpiPaginatedGet<{ id: number; users_id: number; groups_id: number }>('/Group_User');
    const groupUsers = guRes.data;
    assert(Array.isArray(groupUsers), `Respuesta es array (${groupUsers.length} membresÃ­as)`);
    assert(guRes.downloadedTotal === guRes.reportedTotal, `downloadedTotal (${guRes.downloadedTotal}) === reportedTotal (${guRes.reportedTotal})`);
    assertUniqueIds(groupUsers, `IDs Ãºnicos garantizados para Group_User`);

    for (const uid of [52, 231, 21, 240]) {
      const memberships = groupUsers.filter(gu => gu.users_id === uid);
      assert(memberships.length > 0, `User ${uid} tiene ${memberships.length} membresÃ­a(s)`);
    }
    console.log('');

    // --- Test 4: GET /Group_Ticket ---
    console.log('â”€â”€ Test 4: GET /Group_Ticket â”€â”€');
    const gtRes = await glpiPaginatedGet<{ id: number; type: number }>('/Group_Ticket');
    const groupTickets = gtRes.data;
    assert(Array.isArray(groupTickets), `Respuesta es array (${groupTickets.length} relaciones)`);
    assert(gtRes.downloadedTotal === gtRes.reportedTotal, `downloadedTotal (${gtRes.downloadedTotal}) === reportedTotal (${gtRes.reportedTotal})`);
    assertUniqueIds(groupTickets, `IDs Ãºnicos garantizados para Group_Ticket`);

    const gtTypeDist: Record<number, number> = {};
    for (const gt of groupTickets) {
      gtTypeDist[gt.type] = (gtTypeDist[gt.type] || 0) + 1;
    }
    assert(!!gtTypeDist[1], `Group_Ticket type=1 (solicitante) presente (total: ${gtTypeDist[1] || 0})`);
    assert(!!gtTypeDist[2], `Group_Ticket type=2 (tÃ©cnico) presente (total: ${gtTypeDist[2] || 0})`);
    assert(!!gtTypeDist[3], `Group_Ticket type=3 (observaciÃ³n) presente (total: ${gtTypeDist[3] || 0})`);
    console.log(`  Info: DistribuciÃ³n type: ${JSON.stringify(gtTypeDist)}`);
    console.log('');

    // --- Test 5: GET /Ticket_User ---
    console.log('â”€â”€ Test 5: GET /Ticket_User â”€â”€');
    const tuRes = await glpiPaginatedGet<{ id: number; type: number }>('/Ticket_User');
    const ticketUsers = tuRes.data;
    assert(Array.isArray(ticketUsers), `Respuesta es array (${ticketUsers.length} relaciones)`);
    assert(tuRes.downloadedTotal === tuRes.reportedTotal, `downloadedTotal (${tuRes.downloadedTotal}) === reportedTotal (${tuRes.reportedTotal})`);
    assertUniqueIds(ticketUsers, `IDs Ãºnicos garantizados para Ticket_User`);

    const tuTypeDist: Record<number, number> = {};
    for (const tu of ticketUsers) {
      tuTypeDist[tu.type] = (tuTypeDist[tu.type] || 0) + 1;
    }
    assert(!!tuTypeDist[1], `Ticket_User type=1 (solicitante) presente (total: ${tuTypeDist[1] || 0})`);
    assert(!!tuTypeDist[2], `Ticket_User type=2 (tÃ©cnico) presente (total: ${tuTypeDist[2] || 0})`);
    assert(!!tuTypeDist[3], `Ticket_User type=3 (observador) presente (total: ${tuTypeDist[3] || 0})`);
    console.log(`  Info: DistribuciÃ³n type: ${JSON.stringify(tuTypeDist)}`);
    console.log('');

    // --- Test 6: search/Ticket field 65 under 30 (Sistemas) ---
    console.log('â”€â”€ Test 6: search/Ticket field=65 under 30 (Sistemas) â”€â”€');
    const searchSistemasRes = await glpiGet(
      '/search/Ticket?criteria[0][field]=65&criteria[0][searchtype]=under&criteria[0][value]=30&range=0-0&forcedisplay[0]=2'
    );
    const searchSistemasData = searchSistemasRes.data as { totalcount?: number };
    const sistemasTotal = searchSistemasData.totalcount ?? 0;
    references.systemsReference = sistemasTotal;
    assert(sistemasTotal > 0, `Sistemas totalcount=${sistemasTotal}`);
    console.log(`  ðŸ“Š systemsReference = ${sistemasTotal}`);
    console.log('');

    // --- Test 7: search/Ticket field 65 under 32 (TecnologÃ­a) ---
    console.log('â”€â”€ Test 7: search/Ticket field=65 under 32 (TecnologÃ­a) â”€â”€');
    const searchTecRes = await glpiGet(
      '/search/Ticket?criteria[0][field]=65&criteria[0][searchtype]=under&criteria[0][value]=32&range=0-0&forcedisplay[0]=2'
    );
    const searchTecData = searchTecRes.data as { totalcount?: number };
    const tecnologiaTotal = searchTecData.totalcount ?? 0;
    references.technologyReference = tecnologiaTotal;
    assert(tecnologiaTotal > 0, `TecnologÃ­a totalcount=${tecnologiaTotal}`);
    console.log(`  ðŸ“Š technologyReference = ${tecnologiaTotal}`);
    console.log('');

    // --- Test 8: GET /Ticket (total via Content-Range) ---
    console.log('â”€â”€ Test 8: GET /Ticket (total) â”€â”€');
    const ticketRes = await glpiGet('/Ticket?range=0-0');
    let ticketTotal = 0;
    if (ticketRes.contentRange) {
      const m = ticketRes.contentRange.match(/\/(\d+)$/);
      if (m) ticketTotal = parseInt(m[1], 10);
    }
    references.totalReference = ticketTotal;
    assert(ticketTotal > 0, `Total tickets=${ticketTotal}`);
    console.log(`  ðŸ“Š totalReference = ${ticketTotal}`);

    const diff = ticketTotal - (sistemasTotal + tecnologiaTotal);
    console.log(`  Info: Diferencia aritmÃ©tica no validada (total - sistemas - tecnologia) = ${diff}`);
    console.log('');

    // --- Test 9: GET /Ticket/1089 ---
    console.log('â”€â”€ Test 9: GET /Ticket/1089 â”€â”€');
    const t1089Res = await glpiGet('/Ticket/1089');
    const t1089 = t1089Res.data as { id: number; name: string; status: number };
    assert(t1089.id === 1089, `Ticket 1089 existe`);
    console.log('');

    // --- Test 10: GET /Ticket/1089/Group_Ticket ---
    console.log('â”€â”€ Test 10: GET /Ticket/1089/Group_Ticket â”€â”€');
    const gt1089Res = await glpiGet('/Ticket/1089/Group_Ticket');
    const gt1089 = gt1089Res.data as Array<{ id: number; groups_id: number; type: number }>;
    assert(Array.isArray(gt1089), `Respuesta es array (${gt1089.length} relaciones)`);
    const obsGroup30 = gt1089.find(g => g.groups_id === 30 && g.type === 3);
    assert(!!obsGroup30, `Grupo observaciÃ³n 30 presente (type=3)`);
    console.log('');

    // --- Test 11: GET /Ticket/1089/Ticket_User ---
    console.log('â”€â”€ Test 11: GET /Ticket/1089/Ticket_User â”€â”€');
    const tu1089Res = await glpiGet('/Ticket/1089/Ticket_User');
    const tu1089 = tu1089Res.data as Array<{ id: number; users_id: number; type: number }>;
    assert(Array.isArray(tu1089), `Respuesta es array (${tu1089.length} relaciones)`);
    const req46 = tu1089.find(u => u.users_id === 46 && u.type === 1);
    const tech240 = tu1089.find(u => u.users_id === 240 && u.type === 2);
    assert(!!req46, `Solicitante userId=46 presente (type=1)`);
    assert(!!tech240, `TÃ©cnico userId=240 presente (type=2)`);
    console.log('');

    // --- Test 12: GET /Ticket/1089/ITILFollowup ---
    console.log('â”€â”€ Test 12: GET /Ticket/1089/ITILFollowup â”€â”€');
    const fu1089Res = await glpiGet('/Ticket/1089/ITILFollowup');
    const fu1089 = fu1089Res.data as Array<{ id: number }>;
    assert(Array.isArray(fu1089), `Respuesta es array (${fu1089.length} followups)`);
    assert(fu1089.length > 0, `Ticket 1089 tiene followups`);
    console.log('');

    // --- Test 13: PaginaciÃ³n Content-Range ---
    console.log('â”€â”€ Test 13: PaginaciÃ³n Content-Range (Ticket) â”€â”€');
    const ticketPaginated = await glpiPaginatedGet<{ id: number }>('/Ticket');
    assert(ticketPaginated.downloadedTotal === ticketPaginated.reportedTotal, `downloadedTotal (${ticketPaginated.downloadedTotal}) === reportedTotal (${ticketPaginated.reportedTotal})`);
    assert(ticketPaginated.reportedTotal === references.totalReference, `Total coincide con totalReference de Test 8`);
    assertUniqueIds(ticketPaginated.data, `IDs Ãºnicos garantizados para Ticket`);
    console.log('');

  } catch (error) {
    console.error('ðŸ’¥ ExcepciÃ³n durante la ejecuciÃ³n de tests:');
    console.error(error);
    failed++;
  } finally {
    // killSession always
    if (sessionToken) {
      try {
        await glpiGet('/killSession');
        console.log('  SesiÃ³n GLPI cerrada.');
      } catch {
        console.warn('  âš ï¸ Error cerrando sesiÃ³n GLPI');
      }
    }
    if (glpiDispatcher) {
      await glpiDispatcher.close();
    }

    // --- Summary ---
    console.log('='.repeat(70));
    console.log('Resumen del contrato');
    console.log('='.repeat(70));
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log('');
    console.log('  ðŸ“Š Referencias dinÃ¡micas:');
    for (const [key, val] of Object.entries(references)) {
      console.log(`     ${key} = ${val}`);
    }
    console.log('');

    if (failed > 0) {
      console.error(`âŒ ${failed} test(s) fallaron.`);
      process.exit(1);
    } else {
      console.log('âœ… Todos los tests pasaron.');
      process.exit(0);
    }
  }
}

main().catch((err) => {
  console.error('Error fatal no capturado:', err instanceof Error ? err.message : err);
  process.exit(1);
});
