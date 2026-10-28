import assert from 'node:assert/strict';
import { SqlServerOperationalTicketListContextRepository } from '../lib/db/operational/sqlserver-operational-ticket-list-context-repository';
import { OperationalTicketListContextError } from '../lib/db/operational/operational-ticket-list-context-types';
import { SqlRuntimeError } from '../lib/db/sqlserver-runtime-contract';
import type { ISqlServerSession, SqlRow, SqlParameter } from '../lib/db/sqlserver-runtime-contract';

class FakeSession implements ISqlServerSession {
  public rows: SqlRow[] = [];
  public forceError: Error | null = null;
  public queryLog: { sql: string, params: SqlParameter[] }[] = [];

  async query(sql: string, params?: SqlParameter[]): Promise<SqlRow[]> {
    if (this.forceError) throw this.forceError;
    this.queryLog.push({ sql, params: params || [] });
    return this.rows;
  }

  async execute(sql: string, params?: SqlParameter[]): Promise<number> {
    void sql;
    void params;
    return 0;
  }
}

let passed = 0;
let failed = 0;
let total = 0;

async function runTest(name: string, fn: () => Promise<void>) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] ${name}`);
    throw err;
  }
}

async function assertContextError(fn: () => Promise<unknown>, expectedCode: string, sentinel?: number) {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    if (err instanceof OperationalTicketListContextError) caught = err;
  }
  assert.ok(caught instanceof OperationalTicketListContextError);
  assert.equal(caught.code, expectedCode);
  if (sentinel !== undefined) {
    assert.ok(!caught.message.includes(String(sentinel)), 'Error expone el sentinela');
  }
}

async function main() {
  await runTest('1. referente activo con varios grupos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);
    session.rows = [
      { user_id: 100, glpi_group_id: 10 },
      { user_id: 100, glpi_group_id: 20 }
    ];
    const res = await repo.findActiveReferentContext(100);
    assert.ok(res !== null);
    assert.equal(res.userId, 100);
    assert.deepEqual(res.groupIds, [10, 20]);
    assert.ok(Object.isFrozen(res.groupIds), 'Array devuelto no es readonly');
  });

  await runTest('2. referente activo sin grupos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);
    session.rows = [
      { user_id: 100, glpi_group_id: null }
    ];
    const res = await repo.findActiveReferentContext(100);
    assert.ok(res !== null);
    assert.equal(res.userId, 100);
    assert.deepEqual(res.groupIds, []);
  });

  await runTest('3. referente inexistente', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);
    session.rows = [];
    const res = await repo.findActiveReferentContext(100);
    assert.equal(res, null);
  });

  await runTest('4. IDs referente invalidos sin query', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);
    const badIds: unknown[] = [0, -1, 1.5, NaN, null, '100', 9007199254740992, 2147483648];
    for (const bad of badIds) {
      await assertContextError(() => repo.findActiveReferentContext(bad), 'invalid_input');
    }
    assert.equal(session.queryLog.length, 0);
  });

  await runTest('5. user_id discordante entre filas', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);
    session.rows = [
      { user_id: 100, glpi_group_id: 10 },
      { user_id: 101, glpi_group_id: 20 }
    ];
    await assertContextError(() => repo.findActiveReferentContext(100), 'corrupt_data');
  });

  await runTest('6. grupos duplicados, desordenados, negativos o malformados y multiples nulls', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);

    session.rows = [{ user_id: 100, glpi_group_id: 10 }, { user_id: 100, glpi_group_id: 10 }]; // dup
    await assertContextError(() => repo.findActiveReferentContext(100), 'corrupt_data');

    session.rows = [{ user_id: 100, glpi_group_id: 20 }, { user_id: 100, glpi_group_id: 10 }]; // unordered
    await assertContextError(() => repo.findActiveReferentContext(100), 'corrupt_data');

    session.rows = [{ user_id: 100, glpi_group_id: -5 }]; // negative
    await assertContextError(() => repo.findActiveReferentContext(100), 'corrupt_data');

    session.rows = [{ user_id: 100, glpi_group_id: '10' }]; // malformed
    await assertContextError(() => repo.findActiveReferentContext(100), 'corrupt_data');

    session.rows = [{ user_id: 100, glpi_group_id: 10 }, { user_id: 100, glpi_group_id: null }]; // mixed
    await assertContextError(() => repo.findActiveReferentContext(100), 'corrupt_data');

    session.rows = [{ user_id: 100, glpi_group_id: null }, { user_id: 100, glpi_group_id: null }]; // null dup
    await assertContextError(() => repo.findActiveReferentContext(100), 'corrupt_data');
  });

  await runTest('7. requester permitido (true y 1)', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);

    session.rows = [{ is_allowed: true }];
    assert.equal(await repo.isActiveNonReferentRequesterInGroups(10, [20]), true);

    session.rows = [{ is_allowed: 1 }];
    assert.equal(await repo.isActiveNonReferentRequesterInGroups(10, [20]), true);
  });

  await runTest('8. requester no permitido (false y 0)', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);

    session.rows = [{ is_allowed: false }];
    assert.equal(await repo.isActiveNonReferentRequesterInGroups(10, [20]), false);

    session.rows = [{ is_allowed: 0 }];
    assert.equal(await repo.isActiveNonReferentRequesterInGroups(10, [20]), false);
  });

  await runTest('9. grupos vacios false sin query', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);
    assert.equal(await repo.isActiveNonReferentRequesterInGroups(10, []), false);
    assert.equal(session.queryLog.length, 0);
  });

  await runTest('10. requester y grupos invalidos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);

    await assertContextError(() => repo.isActiveNonReferentRequesterInGroups(0, [10]), 'invalid_input');
    await assertContextError(() => repo.isActiveNonReferentRequesterInGroups(-1, [10]), 'invalid_input');

    await assertContextError(() => repo.isActiveNonReferentRequesterInGroups(10, {}), 'invalid_input');

    await assertContextError(() => repo.isActiveNonReferentRequesterInGroups(10, [0]), 'invalid_input');
    await assertContextError(() => repo.isActiveNonReferentRequesterInGroups(10, [2147483648]), 'invalid_input');
    await assertContextError(() => repo.isActiveNonReferentRequesterInGroups(10, [10, 10]), 'invalid_input'); // dup

    assert.equal(session.queryLog.length, 0);
  });

  await runTest('11. mas de 200 grupos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);
    const manyGroups = Array.from({ length: 201 }, (_, i) => i + 1);
    await assertContextError(() => repo.isActiveNonReferentRequesterInGroups(10, manyGroups), 'invalid_input');
    assert.equal(session.queryLog.length, 0);
  });

  await runTest('12. SQL logico exacto de active referent context', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);
    const sentinelId = 987654321;
    session.rows = [{ user_id: sentinelId, glpi_group_id: null }];
    await repo.findActiveReferentContext(sentinelId);

    assert.equal(session.queryLog.length, 1);
    const { sql, params } = session.queryLog[0];

    assert.equal(params.length, 1);
    assert.equal(params[0].name, 'referentUserId');
    assert.equal(params[0].value, sentinelId);

    const s = sql.toLowerCase();
    assert.ok(!s.includes(String(sentinelId)), 'Sentinela hardcodeado en SQL');
    assert.ok(!/select\s+\*/i.test(s), 'Contiene select *');
    assert.ok(!s.includes('prisma'), 'Contiene prisma');
    assert.ok(!s.includes('sqlite'), 'Contiene sqlite');
    assert.ok(!s.includes('prioglpi_user_access'), 'Contiene prioglpi_user_access');
    assert.ok(!s.includes('app_user_id'), 'Contiene app_user_id (invalido en DDL)');

    assert.ok(s.includes('[prioglpi].[app_user]'), 'Falta app_user');
    assert.ok(s.includes('[prioglpi].[sector_referent_assignment]'), 'Falta sector_referent_assignment');
    assert.ok(s.includes('left join'), 'Falta LEFT JOIN');
    assert.ok(s.includes('u.[id] = a.[referent_user_id]'), 'Falta condicion ON u.id = a.referent_user_id');
    assert.ok(s.includes('u.[role] = n\'referente\''), 'Falta filtro de rol');
    assert.ok(s.includes('u.[is_active] = 1'), 'Falta filtro is_active');
    assert.ok(s.includes('order by a.[glpi_group_id] asc'), 'Falta order by');
  });

  await runTest('13. SQL logico exacto de requester in groups', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);
    const reqId = 888888;
    const groupSentinela1 = 111111;
    const groupSentinela2 = 222222;
    session.rows = [{ is_allowed: 1 }];
    await repo.isActiveNonReferentRequesterInGroups(reqId, [groupSentinela1, groupSentinela2]);

    assert.equal(session.queryLog.length, 1);
    const { sql, params } = session.queryLog[0];

    assert.equal(params.length, 3);
    assert.ok(params.find(p => p.name === 'requesterGlpiUserId' && p.value === reqId));
    assert.ok(params.find(p => p.name === 'group0' && p.value === groupSentinela1));
    assert.ok(params.find(p => p.name === 'group1' && p.value === groupSentinela2));

    const s = sql.toLowerCase();
    assert.ok(!s.includes(String(reqId)), 'Sentinela reqId hardcodeado');
    assert.ok(!s.includes(String(groupSentinela1)), 'Sentinela group1 hardcodeado');
    assert.ok(!/select\s+\*/i.test(s), 'Contiene select *');
    assert.ok(!s.includes('prioglpi_user_access'), 'Contiene prioglpi_user_access');
    assert.ok(!s.includes('app_user_id'), 'Contiene app_user_id (invalido en DDL)');

    assert.ok(s.includes('[prioglpi].[glpi_user_cache]'), 'Falta glpi_user_cache');
    assert.ok(s.includes('[prioglpi].[glpi_user_group_membership]'), 'Falta glpi_user_group_membership');
    assert.ok(s.includes('[prioglpi].[app_user]'), 'Falta app_user');
    assert.ok(s.includes('[prioglpi].[user_sector_scope]'), 'Falta user_sector_scope');

    assert.ok(s.includes('m.[user_id] = c.[glpi_user_id]'), 'Falta join en cache');
    assert.ok(s.includes('m.[group_id] in (@group0, @group1)'), 'Falta filtro in de group_id');
    assert.ok(s.includes('au.[id] = sc.[user_id]'), 'Falta join sc.user_id');
    assert.ok(s.includes('sc.[glpi_group_id] in (@group0, @group1)'), 'Falta sc in');

    assert.ok(s.includes('exists'), 'Falta exists');
    assert.ok(s.includes('not exists'), 'Falta not exists');
    assert.ok(s.includes('au.[role] = n\'referente\''), 'Falta filtro de rol referente');
  });

  await runTest('14. resultado requester con cero o multiples filas', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);

    session.rows = [];
    await assertContextError(() => repo.isActiveNonReferentRequesterInGroups(10, [20]), 'corrupt_data');

    session.rows = [{ is_allowed: 1 }, { is_allowed: 0 }];
    await assertContextError(() => repo.isActiveNonReferentRequesterInGroups(10, [20]), 'corrupt_data');
  });

  await runTest('15. BIT invalido', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);
    const badBits: unknown[] = [2, -1, '1', null, undefined, {}];
    for (const b of badBits) {
      session.rows = [{ is_allowed: b }];
      await assertContextError(() => repo.isActiveNonReferentRequesterInGroups(10, [20]), 'corrupt_data');
    }
  });

  await runTest('16. propagacion de SqlRuntimeError', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);
    const err = new SqlRuntimeError('SQL_CONNECTION_ERROR', 'test');
    session.forceError = err;

    let caught1: unknown = null;
    try { await repo.findActiveReferentContext(10); } catch (e) { caught1 = e; }
    assert.equal(caught1, err);

    let caught2: unknown = null;
    try { await repo.isActiveNonReferentRequesterInGroups(10, [20]); } catch (e) { caught2 = e; }
    assert.equal(caught2, err);
  });

  await runTest('17. Inmutabilidad en requester groups', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);
    session.rows = [{ is_allowed: 1 }];

    const inputGroups = [10, 20, 30];
    Object.freeze(inputGroups); // Inmutabilidad garantizada desde el caller

    await repo.isActiveNonReferentRequesterInGroups(10, inputGroups);
    assert.deepEqual(inputGroups, [10, 20, 30]); // sigue siendo igual
  });

  await runTest('18. Errores sin exposicion de sentinelas', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListContextRepository(session);
    const sentinelId = 987654321;

    // Un ID fuera del rango SQL INT debe producir invalid_input sin ejecutar query
    // y sin incluir el valor en el mensaje.
    const invalidId = 9007199254740992;
    await assertContextError(() => repo.isActiveNonReferentRequesterInGroups(invalidId, [20]), 'invalid_input', invalidId);
    assert.equal(session.queryLog.length, 0); // sin query

    // Un requester valido con recordset vacio debe producir corrupt_data sin incluir
    // el requester en el mensaje.
    session.rows = [];
    await assertContextError(() => repo.isActiveNonReferentRequesterInGroups(sentinelId, [20]), 'corrupt_data', sentinelId);
  });
}

void main().then(() => {
  console.log(`\nTests Operational Ticket List Context: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
