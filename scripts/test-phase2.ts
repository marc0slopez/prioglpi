import { strict as assert } from 'node:assert';

const EXTERNAL_SERVER_URL = process.env.APPGLPI_TEST_EXTERNAL_SERVER_URL || 'http://localhost:8788';

async function loginAndGetCookie(username: string, pass: string): Promise<{ cookie: string, role: string }> {
  console.log(`Logueando a ${username}...`);
  const res = await fetch(`${EXTERNAL_SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: pass }),
  });
  assert.equal(res.status, 200, `Error de login para ${username}. HTTP ${res.status}`);
  const rawCookie = res.headers.get('set-cookie');
  assert.ok(rawCookie, `No se devolviÃ³ cookie para ${username}`);
  const cookie = rawCookie.split(';')[0];

  const meRes = await fetch(`${EXTERNAL_SERVER_URL}/api/auth/me`, {
    headers: { Cookie: cookie },
  });
  assert.equal(meRes.status, 200, `Error verificando sesiÃ³n de ${username}`);
  const meData = await meRes.json();
  assert.ok(meData.role, `No se encontrÃ³ rol para ${username}`);

  return { cookie, role: meData.role };
}

async function fetchWithAuth(path: string, cookie: string, options: RequestInit = {}) {
  return fetch(`${EXTERNAL_SERVER_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Cookie: cookie,
    },
  });
}

async function runTests() {
  console.log('--- Iniciando test-phase2.ts ---');
  let exitCode = 0;

  try {
    // 1. Iniciar sesiÃ³n una sola vez por perfil
    const authMauro = await loginAndGetCookie('coordinator_demo', 'coordinator_demo123'); // coordinador_sistemas
    assert.equal(authMauro.role, 'coordinador_sistemas', 'Rol incorrecto para coordinator_demo');

    const authJulian = await loginAndGetCookie('julianc', 'julianc123'); // referente
    assert.equal(authJulian.role, 'referente', 'Rol incorrecto para julianc');

    const authCarolina = await loginAndGetCookie('carolinar', 'carolinar123'); // supervisor
    assert.equal(authCarolina.role, 'supervisor', 'Rol incorrecto para carolinar');

    // 2. Obtener un ticket abierto visible para Mauro
    console.log('Obteniendo ticket abierto para Mauro...');
    const tixRes = await fetchWithAuth('/api/tickets?view=open&limit=1', authMauro.cookie);
    assert.equal(tixRes.status, 200, 'Fallo al obtener tickets para Mauro');
    const tixData = await tixRes.json();
    assert.ok(tixData.tickets && tixData.tickets.length > 0, 'No hay tickets abiertos para testear');

    const testTicket = tixData.tickets[0];
    const ticketId = testTicket.ticketId;
    console.log(`Usando ticket dinÃ¡mico #${ticketId}`);

    // 3. Progreso aceptado
    console.log('Probando progreso aceptado...');
    for (const val of [0, 25, 50, 75, 100]) {
      const res = await fetchWithAuth(`/api/coordination/${ticketId}`, authMauro.cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progressPercent: val })
      });
      assert.equal(res.status, 200, `Progreso ${val} fallÃ³`);
    }

    // 4. Progreso rechazado
    console.log('Probando progreso rechazado...');
    for (const val of [33, '25', 12.5, -5, 105]) {
      const res = await fetchWithAuth(`/api/coordination/${ticketId}`, authMauro.cookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progressPercent: val })
      });
      assert.equal(res.status, 400, `Progreso invÃ¡lido ${val} no devolviÃ³ 400`);
    }

    // 5. Test de toExclusive vs fecha real del ticket
    console.log('Probando toExclusive con fecha real...');
    const openedAt = testTicket.openedAt; // e.g. "2026-07-06 14:00:00"

    // Si filtramos con toExclusive = openedAt, NO debe traer el ticket (porque toExclusive excluye la cota superior)
    const exRes = await fetchWithAuth(`/api/tickets?ticketId=${ticketId}&toExclusive=${encodeURIComponent(openedAt)}`, authMauro.cookie);
    assert.equal(exRes.status, 200, 'toExclusive query no devolviÃ³ 200');
    const exData = await exRes.json();
    assert.equal(exData.tickets.length, 0, 'toExclusive no excluyÃ³ el lÃ­mite superior');
    assert.equal(exData.total, 0, 'toExclusive total no es 0');

    // CombinaciÃ³n invÃ¡lida de to y toExclusive
    const combRes = await fetchWithAuth(`/api/tickets?to=2026-01-01&toExclusive=2026-01-01`, authMauro.cookie);
    assert.equal(combRes.status, 400, 'CombinaciÃ³n de to y toExclusive no devolviÃ³ 400');

    // 6. Probar APIs de mÃ©tricas para 400 en invalid status y period
    console.log('Probando APIs de mÃ©tricas...');
    const metricsRoutes = [
      { path: '/api/metrics/coordinator', cookie: authMauro.cookie },
      { path: '/api/metrics/referent', cookie: authJulian.cookie },
      { path: '/api/metrics/supervisor', cookie: authCarolina.cookie }
    ];

    for (const route of metricsRoutes) {
      console.log(`Validando ${route.path}...`);

      // Periodo invÃ¡lido
      const resPeriod = await fetchWithAuth(`${route.path}?period=year`, route.cookie);
      assert.equal(resPeriod.status, 400, `Period invÃ¡lido fallÃ³ en ${route.path}`);

      const resPeriodEmpty = await fetchWithAuth(`${route.path}?period=`, route.cookie);
      assert.equal(resPeriodEmpty.status, 400, `Period vacÃ­o fallÃ³ en ${route.path}`);

      // Status invÃ¡lido
      for (const st of ['0', '7', '1.5', 'texto', '']) {
        const resStatus = await fetchWithAuth(`${route.path}?status=${st}`, route.cookie);
        assert.equal(resStatus.status, 400, `Status invÃ¡lido '${st}' no devolviÃ³ 400 en ${route.path}`);
      }

      // Llamada vÃ¡lida sin period (debe asumir month)
      const resValid = await fetchWithAuth(route.path, route.cookie);
      assert.equal(resValid.status, 200, `Llamada vÃ¡lida fallÃ³ en ${route.path}`);
    }

    // 7. Verificar 403 fuera de perfil
    console.log('Probando 403 fuera de perfil...');

    // Carolina (supervisora) no puede editar coordinaciÃ³n
    const supCoord = await fetchWithAuth(`/api/coordination/${ticketId}`, authCarolina.cookie, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progressPercent: 50 })
    });
    assert.equal(supCoord.status, 403, 'Supervisora editando coordinaciÃ³n no devolviÃ³ 403');

    // Julian (referente) no puede acceder a mÃ©tricas de supervisor (sin rol admin)
    const refSup = await fetchWithAuth('/api/metrics/supervisor', authJulian.cookie);
    assert.equal(refSup.status, 403, 'Referente accediendo a mÃ©tricas de supervisor no devolviÃ³ 403');

    console.log('âœ… Todos los tests pasaron exitosamente.');
  } catch (err) {
    console.error('âŒ Error en los tests:', err);
    exitCode = 1;
  }

  process.exit(exitCode);
}

runTests();
