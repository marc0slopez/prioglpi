import assert from 'node:assert/strict';
import { SqlServerOperationalTicketListFilterRepository } from '../lib/db/operational/sqlserver-operational-ticket-list-filter-repository';
import { OperationalTicketListFilterError } from '../lib/db/operational/operational-ticket-list-filter-types';
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

async function assertFilterError(fn: () => Promise<unknown>, expectedCode: string, sentinel?: string | number) {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    if (err instanceof OperationalTicketListFilterError) caught = err;
  }
  if (!(caught instanceof OperationalTicketListFilterError)) {
    assert.fail('No se lanzó OperationalTicketListFilterError');
  }
  assert.equal(caught.code, expectedCode);
  if (sentinel !== undefined) {
    assert.ok(!caught.message.includes(String(sentinel)), 'Error expone el sentinela');
  }
}

async function main() {
  await runTest('1. IDs inválidos devuelven invalid_input sin ejecutar query', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);
    const badIds: unknown[] = [0, -1, 1.5, '100', 9007199254740992, 2147483648];
    for (const bad of badIds) {
      await assertFilterError(() => repo.listHistoricalRankedTicketIdsByReferent(bad), 'invalid_input');
      await assertFilterError(() => repo.listTicketIdsByDirectTechnician(bad), 'invalid_input');
      await assertFilterError(() => repo.listTicketIdsAssignedToActiveUsersInGroup(bad), 'invalid_input');
      await assertFilterError(() => repo.listTicketIdsByRequester(bad), 'invalid_input');
    }
    // null explicitamente rechazado excepto en canonical tech
    await assertFilterError(() => repo.listTicketIdsByDirectTechnician(null), 'invalid_input');
    assert.equal(session.queryLog.length, 0);
  });

  await runTest('2. Metadata exacta de los parámetros de queries numéricos', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);

    await repo.listHistoricalRankedTicketIdsByReferent(111);
    assert.equal(session.queryLog[0].params.length, 1);
    const p1 = session.queryLog[0].params[0];
    assert.ok(p1 !== undefined);
    if (p1.type !== 'int') {
      assert.fail('Expected int parameter');
    }
    assert.equal(p1.name, 'referentUserId');
    assert.equal(p1.nullable, false);
    assert.equal(p1.value, 111);

    await repo.listTicketIdsByDirectTechnician(222);
    assert.equal(session.queryLog[1].params.length, 1);
    const p2 = session.queryLog[1].params[0];
    assert.ok(p2 !== undefined);
    if (p2.type !== 'int') {
      assert.fail('Expected int parameter');
    }
    assert.equal(p2.name, 'technicianGlpiUserId');
    assert.equal(p2.nullable, false);
    assert.equal(p2.value, 222);

    await repo.listTicketIdsByRequester(333);
    assert.equal(session.queryLog[2].params.length, 1);
    const p3 = session.queryLog[2].params[0];
    assert.ok(p3 !== undefined);
    if (p3.type !== 'int') {
      assert.fail('Expected int parameter');
    }
    assert.equal(p3.name, 'requesterGlpiUserId');
    assert.equal(p3.nullable, false);
    assert.equal(p3.value, 333);

    await repo.listTicketIdsAssignedToActiveUsersInGroup(444);
    assert.equal(session.queryLog[3].params.length, 1);
    const p4 = session.queryLog[3].params[0];
    assert.ok(p4 !== undefined);
    if (p4.type !== 'int') {
      assert.fail('Expected int parameter');
    }
    assert.equal(p4.name, 'groupId');
    assert.equal(p4.nullable, false);
    assert.equal(p4.value, 444);
  });

  await runTest('3. SQL de listHistoricalRankedTicketIdsByReferent', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);
    session.rows = [{ ticket_id: 10 }];
    const res = await repo.listHistoricalRankedTicketIdsByReferent(999);
    assert.deepEqual(res, [10]);

    const s = session.queryLog[0].sql.toLowerCase();
    assert.ok(s.includes('[prioglpi].[ticket_ranking]'));
    assert.ok(s.includes('[is_active] = 0'));
    assert.ok(s.includes('[updated_by_user_id] = @referentuserid'));
    assert.ok(s.includes('select distinct [ticket_id]'));
    assert.ok(s.includes('order by [ticket_id] asc'));
  });

  await runTest('4. SQL de listTicketIdsByDirectTechnician', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);
    session.rows = [{ ticket_id: 5 }];
    await repo.listTicketIdsByDirectTechnician(888);
    const s = session.queryLog[0].sql.toLowerCase();
    assert.ok(s.includes('[prioglpi].[glpi_ticket_user_actor]'));
    assert.ok(s.includes('[actor_type] = 2'));
    assert.ok(s.includes('[glpi_user_id] = @technicianglpiuserid'));
    assert.ok(s.includes('select distinct [ticket_id]'));
  });

  await runTest('5. SQL de listTicketIdsByRequester', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);
    session.rows = [];
    await repo.listTicketIdsByRequester(777);
    const s = session.queryLog[0].sql.toLowerCase();
    assert.ok(s.includes('[prioglpi].[glpi_ticket_user_actor]'));
    assert.ok(s.includes('[actor_type] = 1'));
    assert.ok(s.includes('[glpi_user_id] = @requesterglpiuserid'));
  });

  await runTest('6. SQL de listTicketIdsAssignedToActiveUsersInGroup', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);
    session.rows = [{ ticket_id: 100 }];
    await repo.listTicketIdsAssignedToActiveUsersInGroup(30);
    const s = session.queryLog[0].sql.toLowerCase();
    assert.ok(s.includes('membership.[group_id] = @groupid'));
    assert.ok(s.includes('cache.[glpi_user_id] = membership.[user_id]'));
    assert.ok(s.includes('cache.[is_active] = 1'));
    assert.ok(s.includes('actor.[glpi_user_id] = cache.[glpi_user_id]'));
    assert.ok(s.includes('actor.[actor_type] = 2'));
    assert.ok(!s.includes('glpi_group_id'));
    assert.ok(s.includes('select distinct actor.[ticket_id]'));
  });

  await runTest('7. SQL de listTicketIdsByCanonicalTechnician estático, LOWER y CTE', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);

    // Testeamos con ID numérico
    await repo.listTicketIdsByCanonicalTechnician(456);
    assert.equal(session.queryLog[0].params.length, 1);
    const p1 = session.queryLog[0].params[0];
    assert.ok(p1 !== undefined);
    if (p1.type !== 'int') {
      assert.fail('Expected int parameter');
    }
    assert.equal(p1.name, 'technicianGlpiUserId');
    assert.equal(p1.nullable, true);
    assert.equal(p1.value, 456);

    const sqlNum = session.queryLog[0].sql;
    const s = sqlNum.toLowerCase();
    assert.ok(s.includes('membership.[group_id] = 30'));
    assert.ok(s.includes('cache.[is_active] = 1'));
    assert.ok(s.includes('cache.[glpi_user_id] <> 231'));
    assert.ok(sqlNum.includes('LOWER(cache.[display_name]) NOT LIKE N\'%julián cancio%\''), 'Falta LOWER explicit');
    assert.ok(sqlNum.includes('LOWER(cache.[display_name]) NOT LIKE N\'%julian cancio%\''));
    assert.ok(sqlNum.includes('LOWER(cache.[display_name]) NOT LIKE N\'%joel lugo%\''));
    assert.ok(sqlNum.includes('LOWER(cache.[display_name]) NOT LIKE N\'%guillermo kunz%\''));
    assert.ok(s.includes('au.[role] = n\'referente\''));
    assert.ok(s.includes('outer apply'));
    assert.ok(s.includes('select top (1)'));
    assert.ok(s.includes('actor.[actor_type] = 2'));
    assert.ok(s.includes('order by actor.[id] asc'));
    assert.ok(s.includes('cache.[is_sistemas_scope] = 1'));
    assert.ok(!s.includes('app_user_id'));

    // Verifica que el SQL sea estático para el where condition de NULL
    assert.ok(s.includes('@technicianglpiuserid is null'));
    assert.ok(s.includes('canonicaltech.[canonical_tech_id] = @technicianglpiuserid'));

    // Testeamos con NULL explícitamente y comprobamos que es exactamente el mismo string de consulta
    await repo.listTicketIdsByCanonicalTechnician(null);
    assert.equal(session.queryLog[1].params.length, 1);
    const p2 = session.queryLog[1].params[0];
    assert.ok(p2 !== undefined);
    if (p2.type !== 'int') {
      assert.fail('Expected int parameter');
    }
    assert.equal(p2.value, null);
    assert.equal(p2.nullable, true);
    assert.equal(session.queryLog[0].sql, session.queryLog[1].sql, 'El SQL debe ser idéntico y estático para numérico y null');
  });

  await runTest('8. Búsqueda de Texto: Metadata exacta, UNION y visibilidad', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);

    // Followup Text
    await repo.listTicketIdsByFollowupText('test', 'private_only');
    assert.equal(session.queryLog[0].params.length, 1);
    const p1 = session.queryLog[0].params[0];
    assert.ok(p1 !== undefined);
    if (p1.type !== 'nvarchar') {
      assert.fail('Expected nvarchar parameter');
    }
    assert.equal(p1.name, 'pattern');
    assert.equal(p1.length, 2000);
    assert.equal(p1.nullable, false);
    assert.equal(p1.value, 'test');

    const sqlFup = session.queryLog[0].sql;
    assert.ok(sqlFup.includes(`[content_plain] LIKE N'%' + @pattern + N'%' ESCAPE N'~'`));
    assert.ok(sqlFup.includes('AND [is_private] = 1'));

    // Activity Text (UNION)
    await repo.listTicketIdsByActivityText('test', 'public_only');
    assert.equal(session.queryLog[1].params.length, 1);
    const p2 = session.queryLog[1].params[0];
    assert.ok(p2 !== undefined);
    if (p2.type !== 'nvarchar') {
      assert.fail('Expected nvarchar parameter');
    }
    assert.equal(p2.name, 'pattern');
    assert.equal(p2.length, 2000);
    assert.equal(p2.nullable, false);
    assert.equal(p2.value, 'test');

    const sqlAct = session.queryLog[1].sql.toLowerCase();
    assert.ok(sqlAct.includes('union'));
    const matches = sqlAct.match(/and \[is_private\] = 0/g);
    assert.ok(matches && matches.length === 2, 'Debe aplicar filtro public_only a ambas tablas');
    assert.ok(sqlAct.includes(`like n'%' + @pattern + n'%' escape n'~'`));
  });

  await runTest('9. Búsqueda de Texto: Borde de 1000 % y escape', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);

    const text1000 = '%'.repeat(1000);
    await repo.listTicketIdsByFollowupText(text1000, 'all');

    assert.equal(session.queryLog[0].params.length, 1);
    const param = session.queryLog[0].params[0];
    assert.ok(param !== undefined);
    if (param.type !== 'nvarchar') {
      assert.fail('Expected nvarchar parameter');
    }
    assert.equal(param.name, 'pattern');
    assert.equal(param.length, 2000);
    assert.equal(param.nullable, false);

    // Cada '%' se escapa como '~%' -> 2 caracteres
    assert.equal(String(param.value).length, 2000);
    assert.equal(String(param.value), '~%'.repeat(1000));

    assert.ok(!session.queryLog[0].sql.includes(text1000));
    assert.ok(!session.queryLog[0].sql.includes('~%')); // el valor viaja en parametro unicamente
  });

  await runTest('10. Búsqueda de Texto: textos no permitidos (vacíos, control, tipo)', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);

    await assertFilterError(() => repo.listTicketIdsByFollowupText('', 'all'), 'invalid_input');
    await assertFilterError(() => repo.listTicketIdsByFollowupText('test\x07', 'all'), 'invalid_input', 'test\x07');
    await assertFilterError(() => repo.listTicketIdsByFollowupText('a'.repeat(1001), 'all'), 'invalid_input');
    await assertFilterError(() => repo.listTicketIdsByActivityText(123, 'all'), 'invalid_input');

    // visibility no permitida pasado directamente como unknown (rechazo tipable runtime)
    await assertFilterError(() => repo.listTicketIdsByActivityText('test', 'invalid_visibility'), 'invalid_input');
    await assertFilterError(() => repo.listTicketIdsByFollowupText('test', 'invalid_enum'), 'invalid_input');

    assert.equal(session.queryLog.length, 0); // Todo fue validado pre-query
  });

  await runTest('11. Filas devueltas con propiedades faltantes o inválidas', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);

    // Objeto sin propiedades (simulando que la DB devolvió un SqlRow tipable pero sin ticket_id)
    session.rows = [{}];
    await assertFilterError(() => repo.listHistoricalRankedTicketIdsByReferent(999), 'corrupt_data');

    // ticket_id nulo u otro tipo primitivo
    session.rows = [{ ticket_id: null }];
    await assertFilterError(() => repo.listHistoricalRankedTicketIdsByReferent(999), 'corrupt_data');

    session.rows = [{ ticket_id: '1' }];
    await assertFilterError(() => repo.listHistoricalRankedTicketIdsByReferent(999), 'corrupt_data');

    session.rows = [{ ticket_id: -5 }];
    await assertFilterError(() => repo.listHistoricalRankedTicketIdsByReferent(999), 'corrupt_data');
  });

  await runTest('12. Filas devueltas desordenadas o duplicadas', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);

    session.rows = [{ ticket_id: 10 }, { ticket_id: 10 }];
    await assertFilterError(() => repo.listTicketIdsByDirectTechnician(999), 'corrupt_data');

    session.rows = [{ ticket_id: 20 }, { ticket_id: 10 }];
    await assertFilterError(() => repo.listTicketIdsByDirectTechnician(999), 'corrupt_data');
  });

  await runTest('13. Propagacion de SqlRuntimeError (Sin intercepciones sucias)', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);
    const err = new SqlRuntimeError('SQL_CONNECTION_ERROR', 'test err');
    session.forceError = err;

    let caught: unknown = null;
    try {
      await repo.listTicketIdsByRequester(999);
    } catch (e) {
      caught = e;
    }
    assert.equal(caught, err);
  });

  await runTest('14. Ausencia de sentinelas o marcas de otros frameworks', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);
    const sentinelId = 987654321;
    session.rows = [{ ticket_id: 10 }];

    await repo.listHistoricalRankedTicketIdsByReferent(sentinelId);
    const s = session.queryLog[0].sql.toLowerCase();

    assert.ok(!s.includes('987654321'));
    assert.ok(!s.includes('prisma'));
    assert.ok(!s.includes('sqlite'));
    assert.ok(!/select\s+\*/i.test(s));
  });

  await runTest('15. Rechazo riguroso pre-query de NaN, Infinito y cero', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);
    await assertFilterError(() => repo.listHistoricalRankedTicketIdsByReferent(NaN), 'invalid_input');
    await assertFilterError(() => repo.listHistoricalRankedTicketIdsByReferent(Infinity), 'invalid_input');
    await assertFilterError(() => repo.listHistoricalRankedTicketIdsByReferent(-Infinity), 'invalid_input');
    await assertFilterError(() => repo.listHistoricalRankedTicketIdsByReferent(0), 'invalid_input');
    assert.equal(session.queryLog.length, 0);
  });

  await runTest('16. Inmutabilidad (Object.isFrozen)', async () => {
    const session = new FakeSession();
    const repo = new SqlServerOperationalTicketListFilterRepository(session);
    session.rows = [{ ticket_id: 10 }];
    const res = await repo.listHistoricalRankedTicketIdsByReferent(999);

    assert.ok(Object.isFrozen(res));
    // Testea que mutarlo lanza un error (en modo estricto)
    assert.throws(() => {
      Reflect.apply(Array.prototype.push, res, [20]);
    }, TypeError);
    assert.deepEqual(res, [10]);
  });
}

void main().then(() => {
  console.log(`\nTests Operational Ticket List Filter: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
