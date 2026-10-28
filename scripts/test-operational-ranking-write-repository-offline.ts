import assert from 'node:assert/strict';
import { SqlServerOperationalRankingWriteRepository } from '../lib/db/operational/sqlserver-operational-ranking-write-repository';
import { OperationalRankingWriteError } from '../lib/db/operational/operational-ranking-write-repository';
import { SqlRuntimeError, type ISqlServerTransaction, type SqlParameter, type SqlRow } from '../lib/db/sqlserver-runtime-contract';

class FakeTransaction implements ISqlServerTransaction {
  public executeCalls = 0;
  public queryCalls = 0;
  public lastSql: string | null = null;
  public lastParams: readonly SqlParameter[] | null = null;

  public rowsAffectedToReturn = 1;
  public queryRowsToReturn: SqlRow[] = [];
  public errorToThrow: Error | null = null;

  async execute(sql: string, params: SqlParameter[] = []): Promise<number> {
    this.executeCalls++;
    this.lastSql = sql;
    this.lastParams = params;
    if (this.errorToThrow) throw this.errorToThrow;
    return this.rowsAffectedToReturn;
  }

  async query(sql: string, params: SqlParameter[] = []): Promise<SqlRow[]> {
    this.queryCalls++;
    this.lastSql = sql;
    this.lastParams = params;
    if (this.errorToThrow) throw this.errorToThrow;
    return this.queryRowsToReturn;
  }
}

let passed = 0, failed = 0, total = 0;
async function runTest(name: string, fn: () => void | Promise<void>) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    const message = err instanceof Error ? err.message : 'Unknown test failure';
    console.error(`[FAIL] ${name}: ${message}`);
    throw err;
  }
}

async function assertError(fn: () => Promise<unknown>, code: string): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  if (!(caught instanceof OperationalRankingWriteError)) {
    assert.fail(`Expected OperationalRankingWriteError for ${code}`);
  }
  assert.equal(caught.code, code);
}

function requireLastSql(tx: FakeTransaction): string {
  if (tx.lastSql === null) assert.fail('Expected tx.lastSql to not be null');
  return tx.lastSql;
}

function requireLastParams(tx: FakeTransaction): readonly SqlParameter[] {
  if (tx.lastParams === null) assert.fail('Expected tx.lastParams to not be null');
  return tx.lastParams;
}

function requireParameter(params: readonly SqlParameter[], name: string): SqlParameter {
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p !== undefined && p.name === name) {
      return p;
    }
  }
  assert.fail(`Parameter ${name} not found`);
}

interface IntParameter {
  readonly name: string;
  readonly type: 'int';
  readonly nullable: boolean;
  readonly value: number | null;
}

function requireIntParameter(params: readonly SqlParameter[], name: string): IntParameter {
  const p = requireParameter(params, name);
  if (p.type !== 'int') {
    assert.fail(`Parameter ${name} is not int`);
  }
  if (typeof p.value !== 'number' && p.value !== null) {
    assert.fail(`Parameter ${name} value is not number or null`);
  }
  return {
    name: p.name,
    type: 'int',
    nullable: p.nullable,
    value: p.value
  };
}

interface NVarCharParameter {
  readonly name: string;
  readonly type: 'nvarchar';
  readonly length: number | 'MAX';
  readonly nullable: boolean;
  readonly value: string | null;
}

function requireNVarCharParameter(params: readonly SqlParameter[], name: string): NVarCharParameter {
  const p = requireParameter(params, name);
  if (p.type !== 'nvarchar') {
    assert.fail(`Parameter ${name} is not nvarchar`);
  }
  if (typeof p.value !== 'string' && p.value !== null) {
    assert.fail(`Parameter ${name} value is not string or null`);
  }
  return {
    name: p.name,
    type: 'nvarchar',
    length: p.length,
    nullable: p.nullable,
    value: p.value
  };
}

interface DateTime2Parameter {
  readonly name: string;
  readonly type: 'datetime2';
  readonly scale: number;
  readonly nullable: boolean;
  readonly value: Date | null;
}

function requireDateTime2Parameter(params: readonly SqlParameter[], name: string): DateTime2Parameter {
  const p = requireParameter(params, name);
  if (p.type !== 'datetime2') {
    assert.fail(`Parameter ${name} is not datetime2`);
  }
  if (!(p.value instanceof Date) && p.value !== null) {
    assert.fail(`Parameter ${name} value is not Date or null`);
  }
  if (p.scale === undefined) {
    assert.fail(`Parameter ${name} scale is undefined`);
  }
  return {
    name: p.name,
    type: 'datetime2',
    scale: p.scale,
    nullable: p.nullable,
    value: p.value
  };
}

const dt = new Date('2023-01-01T00:00:00Z');

async function main() {
  await runTest('1. ticket válido, ausente y ambiguo', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);

    tx.queryRowsToReturn = [{
      'ticket_id': 100, 'is_sistemas_scope': true, 'status': 1, 'status_label': 'L',
      'detected_sector': 'S', 'detected_sector_group_id': null
    }];
    const r1 = await repo.findTicketById(100);
    assert.ok(r1);
    assert.equal(r1.ticketId, 100);
    assert.equal(r1.isSistemasScope, true);

    tx.queryRowsToReturn = [];
    const r2 = await repo.findTicketById(100);
    assert.equal(r2, null);

    tx.queryRowsToReturn = [
      { 'ticket_id': 100, 'is_sistemas_scope': 1, 'status': 1, 'status_label': 'L', 'detected_sector': 'S', 'detected_sector_group_id': 10 },
      { 'ticket_id': 100, 'is_sistemas_scope': 0, 'status': 1, 'status_label': 'L', 'detected_sector': 'S', 'detected_sector_group_id': 10 }
    ];
    await assertError(() => repo.findTicketById(100), 'ambiguous_result');
  });

  await runTest('2. ticket con claves/tipos/BIT corruptos', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);

    tx.queryRowsToReturn = [{ 'ticket_id': 100 }];
    await assertError(() => repo.findTicketById(100), 'invalid_input');

    tx.queryRowsToReturn = [{
      'ticket_id': '100', 'is_sistemas_scope': 1, 'status': 1, 'status_label': 'L',
      'detected_sector': 'S', 'detected_sector_group_id': 10
    }];
    await assertError(() => repo.findTicketById(100), 'corrupt_data');

    tx.queryRowsToReturn = [{
      'ticket_id': 100, 'is_sistemas_scope': 2, 'status': 1, 'status_label': 'L',
      'detected_sector': 'S', 'detected_sector_group_id': 10
    }];
    await assertError(() => repo.findTicketById(100), 'corrupt_data');
  });

  await runTest('3. group válido, ausente y ambiguo', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);

    tx.queryRowsToReturn = [{ 'group_id': 10, 'name': 'N', 'complete_name': 'CN' }];
    const r1 = await repo.findGroupById(10);
    assert.ok(r1);
    assert.equal(r1.groupId, 10);

    tx.queryRowsToReturn = [];
    const r2 = await repo.findGroupById(10);
    assert.equal(r2, null);

    tx.queryRowsToReturn = [
      { 'group_id': 10, 'name': 'N', 'complete_name': 'CN' },
      { 'group_id': 10, 'name': 'N', 'complete_name': 'CN' }
    ];
    await assertError(() => repo.findGroupById(10), 'ambiguous_result');
  });

  await runTest('4. group con claves o strings corruptos', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);

    tx.queryRowsToReturn = [{ 'group_id': 10, 'name': 'N' }];
    await assertError(() => repo.findGroupById(10), 'invalid_input');

    tx.queryRowsToReturn = [{ 'group_id': 10, 'name': 123, 'complete_name': 'CN' }];
    await assertError(() => repo.findGroupById(10), 'corrupt_data');
  });

  await runTest('5. lista activa válida y vacía', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);

    tx.queryRowsToReturn = [];
    const r1 = await repo.listActiveRankingsByGroupId(10);
    assert.equal(r1.length, 0);

    tx.queryRowsToReturn = [{
      'id': 1, 'ticket_id': 100, 'sector_name': 'S', 'glpi_group_id': 10, 'rank_position': 1,
      'created_by_user_id': 1, 'updated_by_user_id': 1, 'created_at': dt, 'updated_at': dt, 'is_active': 1
    }];
    const r2 = await repo.listActiveRankingsByGroupId(10);
    assert.equal(r2.length, 1);
    const item = r2[0];
    if (item === undefined) assert.fail();
    assert.equal(item.id, 1);
  });

  await runTest('6. lista activa con fechas clonadas e inmutabilidad profunda', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);
    const dateRef = new Date('2023-01-01T00:00:00Z');

    tx.queryRowsToReturn = [{
      'id': 1, 'ticket_id': 100, 'sector_name': 'S', 'glpi_group_id': 10, 'rank_position': 1,
      'created_by_user_id': 1, 'updated_by_user_id': 1, 'created_at': dateRef, 'updated_at': dateRef, 'is_active': 1
    }];
    const r = await repo.listActiveRankingsByGroupId(10);
    const item = r[0];
    if (item === undefined) assert.fail();
    assert.ok(Object.isFrozen(r));
    assert.ok(Object.isFrozen(item));
    assert.ok(item.createdAt !== dateRef);
    assert.equal(item.createdAt.getTime(), dateRef.getTime());
  });

  await runTest('7. lista con group/is_active discordantes', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);

    tx.queryRowsToReturn = [{
      'id': 1, 'ticket_id': 100, 'sector_name': 'S', 'glpi_group_id': 99, 'rank_position': 1,
      'created_by_user_id': 1, 'updated_by_user_id': 1, 'created_at': dt, 'updated_at': dt, 'is_active': 1
    }];
    await assertError(() => repo.listActiveRankingsByGroupId(10), 'corrupt_data');

    tx.queryRowsToReturn = [{
      'id': 1, 'ticket_id': 100, 'sector_name': 'S', 'glpi_group_id': 10, 'rank_position': 1,
      'created_by_user_id': 1, 'updated_by_user_id': 1, 'created_at': dt, 'updated_at': dt, 'is_active': 0
    }];
    await assertError(() => repo.listActiveRankingsByGroupId(10), 'corrupt_data');
  });

  await runTest('8. lista duplicada o desordenada', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);

    const baseRow = {
      'id': 1, 'ticket_id': 100, 'sector_name': 'S', 'glpi_group_id': 10, 'rank_position': 1,
      'created_by_user_id': 1, 'updated_by_user_id': 1, 'created_at': dt, 'updated_at': dt, 'is_active': 1
    };

    tx.queryRowsToReturn = [baseRow, baseRow];
    await assertError(() => repo.listActiveRankingsByGroupId(10), 'corrupt_data');

    tx.queryRowsToReturn = [
      baseRow,
      Object.assign({}, baseRow, { 'id': 2 })
    ];
    await assertError(() => repo.listActiveRankingsByGroupId(10), 'corrupt_data');

    tx.queryRowsToReturn = [
      Object.assign({}, baseRow, { 'id': 2, 'ticket_id': 200, 'rank_position': 2 }),
      Object.assign({}, baseRow, { 'id': 1, 'ticket_id': 100, 'rank_position': 1 })
    ];
    await assertError(() => repo.listActiveRankingsByGroupId(10), 'corrupt_data');

    tx.queryRowsToReturn = [
      Object.assign({}, baseRow, { 'id': 1, 'ticket_id': 200, 'rank_position': 1 }),
      Object.assign({}, baseRow, { 'id': 2, 'ticket_id': 100, 'rank_position': 1 })
    ];
    await assertError(() => repo.listActiveRankingsByGroupId(10), 'corrupt_data');

    tx.queryRowsToReturn = [
      Object.assign({}, baseRow, { 'id': 2, 'ticket_id': 100, 'rank_position': 1 }),
      Object.assign({}, baseRow, { 'id': 1, 'ticket_id': 100, 'rank_position': 1 })
    ];
    await assertError(() => repo.listActiveRankingsByGroupId(10), 'corrupt_data');
  });

  await runTest('9. IDs escalares inválidos antes de query', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);

    await assertError(() => repo.findTicketById(-1), 'invalid_input');
    await assertError(() => repo.findTicketById(1.5), 'invalid_input');
    await assertError(() => repo.findGroupById(NaN), 'invalid_input');
    await assertError(() => repo.listActiveRankingsByGroupId(Infinity), 'invalid_input');
    assert.equal(tx.queryCalls, 0);
  });

  const upsertInput = {
    ticketId: 100, sectorName: 'S', glpiGroupId: 10, ownerUserId: 99, rankPosition: 1, actorUserId: 1, updatedAt: dt
  };

  await runTest('10. upsert SQL y seis parámetros exactos', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);
    await repo.upsertActiveRanking(upsertInput);

    assert.equal(tx.executeCalls, 1);
    const sql = requireLastSql(tx);
    assert.ok(sql.includes('[prioglpi].[ticket_ranking]'));
    assert.ok(!sql.includes('[prioglpi].[rankings]'));
    assert.ok(sql.includes('UPDATE [prioglpi].[ticket_ranking]'));
    assert.ok(sql.includes('INSERT INTO [prioglpi].[ticket_ranking]'));
    assert.ok(!sql.includes('MERGE'));

    const p = requireLastParams(tx);
    assert.equal(p.length, 7);

    const ticketIdP = requireIntParameter(p, 'ticketId');
    assert.equal(ticketIdP.nullable, false);
    assert.equal(ticketIdP.value, 100);

    const sectorNameP = requireNVarCharParameter(p, 'sectorName');
    assert.equal(sectorNameP.length, 255);
    assert.equal(sectorNameP.nullable, false);
    assert.equal(sectorNameP.value, 'S');

    const glpiGroupIdP = requireIntParameter(p, 'glpiGroupId');
    assert.equal(glpiGroupIdP.nullable, false);
    assert.equal(glpiGroupIdP.value, 10);

    const ownerUserIdP = requireIntParameter(p, 'ownerUserId');
    assert.equal(ownerUserIdP.nullable, false);
    assert.equal(ownerUserIdP.value, 99);

    const rankPositionP = requireIntParameter(p, 'rankPosition');
    assert.equal(rankPositionP.nullable, false);
    assert.equal(rankPositionP.value, 1);

    const actorUserIdP = requireIntParameter(p, 'actorUserId');
    assert.equal(actorUserIdP.nullable, false);
    assert.equal(actorUserIdP.value, 1);

    const updatedAtP = requireDateTime2Parameter(p, 'updatedAt');
    assert.equal(updatedAtP.scale, 3);
    assert.equal(updatedAtP.nullable, false);
    if (updatedAtP.value === null) assert.fail('Expected valid date');
    assert.equal(updatedAtP.value.getTime(), dt.getTime());
  });

  await runTest('11. upsert contempla UPDATE + IF @@ROWCOUNT + INSERT y no usa MERGE', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);
    await repo.upsertActiveRanking(upsertInput);

    const sql = requireLastSql(tx);
    assert.ok(sql.includes('UPDATE [prioglpi].[ticket_ranking]'));
    assert.ok(sql.includes('IF @@ROWCOUNT = 0'));
    assert.ok(sql.includes('INSERT INTO [prioglpi].[ticket_ranking]'));
    assert.ok(!sql.includes('MERGE'));
  });

  await runTest('12. upsert rechaza objetos, claves, strings y fechas inválidos pre-execute', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);

    await assertError(() => repo.upsertActiveRanking(Object.assign({}, upsertInput, { extra: 1 })), 'invalid_input');
    await assertError(() => repo.upsertActiveRanking(Object.assign({}, upsertInput, { ticketId: -1 })), 'invalid_input');
    await assertError(() => repo.upsertActiveRanking(Object.assign({}, upsertInput, { sectorName: '  ' })), 'invalid_input');
    await assertError(() => repo.upsertActiveRanking(Object.assign({}, upsertInput, { updatedAt: new Date('invalid') })), 'invalid_input');

    const sym = Symbol('extra');
    const inputWithSym = Object.assign({}, upsertInput);
    Reflect.set(inputWithSym, sym, 1);
    await assertError(() => repo.upsertActiveRanking(inputWithSym), 'invalid_input');

    assert.equal(tx.executeCalls, 0);
  });

  const updateInput = {
    rankingId: 1, ticketId: 100, glpiGroupId: 10, rankPosition: 2, actorUserId: 1, updatedAt: dt
  };

  await runTest('13. update position: updated y not_found', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);

    tx.rowsAffectedToReturn = 1;
    const r1 = await repo.updateActiveRankingPosition(updateInput);
    assert.equal(r1, 'updated');

    tx.rowsAffectedToReturn = 0;
    const r2 = await repo.updateActiveRankingPosition(updateInput);
    assert.equal(r2, 'not_found');
  });

  const deactivateInput = {
    rankingId: 1, ticketId: 100, glpiGroupId: 10, actorUserId: 1, updatedAt: dt
  };

  await runTest('14. deactivate: updated y not_found', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);

    tx.rowsAffectedToReturn = 1;
    const r1 = await repo.deactivateActiveRanking(deactivateInput);
    assert.equal(r1, 'updated');

    tx.rowsAffectedToReturn = 0;
    const r2 = await repo.deactivateActiveRanking(deactivateInput);
    assert.equal(r2, 'not_found');
  });

  await runTest('15. rowsAffected 2, negativo, NaN, Infinity y decimal', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);
    const tests = [2, -1, NaN, Infinity, 1.5];

    for (const val of tests) {
      tx.rowsAffectedToReturn = val;
      await assertError(() => repo.upsertActiveRanking(upsertInput), 'unexpected_result');
      await assertError(() => repo.updateActiveRankingPosition(updateInput), 'unexpected_result');
      await assertError(() => repo.deactivateActiveRanking(deactivateInput), 'unexpected_result');
    }
  });

  await runTest('16. propagación por identidad de SqlRuntimeError en lectura y escritura', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);
    const err = new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'DB FAIL');
    tx.errorToThrow = err;

    let caught: unknown = null;
    try { await repo.findTicketById(100); } catch (e) { caught = e; }
    assert.equal(caught, err);

    caught = null;
    try { await repo.upsertActiveRanking(upsertInput); } catch (e) { caught = e; }
    assert.equal(caught, err);
  });

  await runTest('17. higiene SQL y sentinelas exclusivamente en parámetros', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);

    const input = Object.assign({}, upsertInput, {
      sectorName: 'SECTORSENTINEL'
    });
    await repo.upsertActiveRanking(input);

    const sql = requireLastSql(tx);
    assert.ok(sql.includes('[prioglpi].[ticket_ranking]'));
    assert.ok(!sql.includes('[prioglpi].[rankings]'));
    assert.ok(!sql.includes('SELECT *'));
    assert.ok(!sql.includes('NOLOCK'));
    assert.ok(!sql.includes('prisma'));
    assert.ok(!sql.includes('sqlite'));
    assert.ok(!sql.includes('SECTORSENTINEL'));
  });

  await runTest('18. cero query/execute incorrectos, inmutabilidad de inputs y contrato transaccional', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalRankingWriteRepository(tx);

    const clonedInput = Object.assign({}, upsertInput);
    await repo.upsertActiveRanking(clonedInput);

    assert.equal(tx.queryCalls, 0);
    assert.equal(tx.executeCalls, 1);
    assert.ok(!Object.isFrozen(clonedInput));
  });
}

void main().then(() => {
  console.log(`\nTests Ranking Write Repo: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
