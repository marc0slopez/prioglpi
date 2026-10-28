import assert from 'node:assert/strict';
import { CANONICAL_ACTIONS, CANONICAL_ENTITY_TYPES } from '../lib/audit-types';
import { SqlServerOperationalAuditWriteRepository } from '../lib/db/operational/sqlserver-operational-audit-write-repository';
import { OperationalAuditWriteError } from '../lib/db/operational/operational-audit-write-repository';
import { SqlRuntimeError, type ISqlServerTransaction, type SqlParameter, type SqlRow } from '../lib/db/sqlserver-runtime-contract';

class FakeTransaction implements ISqlServerTransaction {
  public executeCalls = 0;
  public queryCalls = 0;
  public lastSql: string | null = null;
  public lastParams: readonly SqlParameter[] | null = null;

  public rowsAffectedToReturn = 1;
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
    return [];
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

async function assertInvalidInput(fn: () => Promise<void>): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  if (!(caught instanceof OperationalAuditWriteError)) {
    assert.fail('Expected OperationalAuditWriteError');
  }
  assert.equal(caught.code, 'invalid_input');
}

async function assertUnexpectedResult(fn: () => Promise<void>): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  if (!(caught instanceof OperationalAuditWriteError)) {
    assert.fail('Expected OperationalAuditWriteError');
  }
  assert.equal(caught.code, 'unexpected_result');
}

function requireLastParams(tx: FakeTransaction): readonly SqlParameter[] {
  if (tx.lastParams === null) {
    assert.fail('Expected tx.lastParams to not be null');
  }
  return tx.lastParams;
}

function requireLastSql(tx: FakeTransaction): string {
  if (tx.lastSql === null) {
    assert.fail('Expected tx.lastSql to not be null');
  }
  return tx.lastSql;
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

const baseInput = {
  userId: 1,
  action: CANONICAL_ACTIONS[0],
  entityType: CANONICAL_ENTITY_TYPES[0],
  entityId: '100',
  before: { a: 1 },
  after: { b: 2 },
  actorName: 'User',
  actorUsername: 'user1'
};

async function main() {
  await runTest('1. Actor conocido y los ocho parámetros exactos', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);
    await repo.writeAudit(baseInput);

    assert.equal(tx.executeCalls, 1);
    const p = requireLastParams(tx);
    assert.equal(p.length, 8);

    const userIdP = requireIntParameter(p, 'userId');
    assert.equal(userIdP.nullable, true);
    assert.equal(userIdP.value, 1);

    const actionP = requireNVarCharParameter(p, 'action');
    assert.equal(actionP.length, 255);
    assert.equal(actionP.nullable, false);
    assert.equal(actionP.value, CANONICAL_ACTIONS[0]);

    const entityTypeP = requireNVarCharParameter(p, 'entityType');
    assert.equal(entityTypeP.length, 255);
    assert.equal(entityTypeP.nullable, false);
    assert.equal(entityTypeP.value, CANONICAL_ENTITY_TYPES[0]);

    const entityIdP = requireNVarCharParameter(p, 'entityId');
    assert.equal(entityIdP.length, 255);
    assert.equal(entityIdP.nullable, false);
    assert.equal(entityIdP.value, '100');

    const beforeP = requireNVarCharParameter(p, 'beforeJson');
    assert.equal(beforeP.length, 'MAX');
    assert.equal(beforeP.nullable, true);
    assert.equal(beforeP.value, '{"a":1}');

    const afterP = requireNVarCharParameter(p, 'afterJson');
    assert.equal(afterP.length, 'MAX');
    assert.equal(afterP.nullable, true);
    assert.equal(afterP.value, '{"b":2}');

    const actorNameP = requireNVarCharParameter(p, 'actorName');
    assert.equal(actorNameP.length, 255);
    assert.equal(actorNameP.nullable, true);
    assert.equal(actorNameP.value, 'User');

    const actorUsernameP = requireNVarCharParameter(p, 'actorUsername');
    assert.equal(actorUsernameP.length, 255);
    assert.equal(actorUsernameP.nullable, true);
    assert.equal(actorUsernameP.value, 'user1');
  });

  await runTest('2. Actor anónimo con username null', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);
    const input = Object.assign({}, baseInput, { userId: null, actorName: null, actorUsername: null });
    await repo.writeAudit(input);

    assert.equal(tx.executeCalls, 1);
    const p = requireLastParams(tx);
    assert.equal(requireIntParameter(p, 'userId').value, null);
    assert.equal(requireNVarCharParameter(p, 'actorName').value, null);
    assert.equal(requireNVarCharParameter(p, 'actorUsername').value, null);
  });

  await runTest('3. Actor anónimo con username válido', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);
    const input = Object.assign({}, baseInput, { userId: null, actorName: null, actorUsername: 'system' });
    await repo.writeAudit(input);

    assert.equal(tx.executeCalls, 1);
    const p = requireLastParams(tx);
    assert.equal(requireIntParameter(p, 'userId').value, null);
    assert.equal(requireNVarCharParameter(p, 'actorName').value, null);
    assert.equal(requireNVarCharParameter(p, 'actorUsername').value, 'system');
  });

  await runTest('4. before/after ausentes o null → parámetros null', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);

    const input1 = Object.assign({}, baseInput, { before: null, after: undefined });
    await repo.writeAudit(input1);

    const p1 = requireLastParams(tx);
    assert.equal(requireNVarCharParameter(p1, 'beforeJson').value, null);
    assert.equal(requireNVarCharParameter(p1, 'afterJson').value, null);

    const input2 = Object.assign({}, baseInput);
    Reflect.deleteProperty(input2, 'before');
    Reflect.deleteProperty(input2, 'after');
    await repo.writeAudit(input2);

    const p2 = requireLastParams(tx);
    assert.equal(requireNVarCharParameter(p2, 'beforeJson').value, null);
    assert.equal(requireNVarCharParameter(p2, 'afterJson').value, null);
  });

  await runTest('5. Redacción profunda de claves sensibles', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);
    const input = Object.assign({}, baseInput, { before: { password: 'secret1', nested: { authorization: 'secret2' } } });
    await repo.writeAudit(input);

    const p = requireLastParams(tx);
    const beforeJson = requireNVarCharParameter(p, 'beforeJson').value;
    if (beforeJson === null) {
      assert.fail('Expected beforeJson to not be null');
    }
    assert.ok(beforeJson.includes('***REDACTED***'));
    assert.ok(!beforeJson.includes('secret1'));
    assert.ok(!beforeJson.includes('secret2'));
  });

  await runTest('6. Redacción de secretos embebidos en strings', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);
    const input = Object.assign({}, baseInput, { before: { text: "password=pass123 token=abc123" } });
    await repo.writeAudit(input);

    const p = requireLastParams(tx);
    const beforeJson = requireNVarCharParameter(p, 'beforeJson').value;
    if (beforeJson === null) {
      assert.fail('Expected beforeJson to not be null');
    }
    assert.ok(beforeJson.includes('***REDACTED***'));
    assert.ok(!beforeJson.includes('pass123'));
    assert.ok(!beforeJson.includes('abc123'));
  });

  await runTest('7. before/after serializados sin mutar inputs', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);
    const data = { token: '123' };
    const input = Object.assign({}, baseInput, { before: data });
    await repo.writeAudit(input);

    const p = requireLastParams(tx);
    const beforeJson = requireNVarCharParameter(p, 'beforeJson').value;
    if (beforeJson === null) {
      assert.fail('Expected beforeJson to not be null');
    }
    assert.ok(beforeJson.includes('***REDACTED***'));
    assert.equal(data.token, '123');
    assert.ok(!Object.isFrozen(data));
  });

  await runTest('8. Todas las CANONICAL_ACTIONS aceptadas', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);
    for (const action of CANONICAL_ACTIONS) {
      await repo.writeAudit(Object.assign({}, baseInput, { action }));
    }
    assert.equal(tx.executeCalls, CANONICAL_ACTIONS.length);
  });

  await runTest('9. Todos los CANONICAL_ENTITY_TYPES aceptados', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);
    for (const entityType of CANONICAL_ENTITY_TYPES) {
      await repo.writeAudit(Object.assign({}, baseInput, { entityType }));
    }
    assert.equal(tx.executeCalls, CANONICAL_ENTITY_TYPES.length);
  });

  await runTest('10. Action/entity inválidos rechazados pre-execute', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { action: 'INVALID_ACTION' })));
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { entityType: 'INVALID_ENTITY' })));
    assert.equal(tx.executeCalls, 0);
  });

  await runTest('11. userId inválido: NaN, Infinity, decimal, cero, negativo, unsafe y overflow', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);
    const tests = [NaN, Infinity, 1.5, 0, -1, Number.MAX_SAFE_INTEGER, 2147483648];
    for (const userId of tests) {
      await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { userId })));
    }
    assert.equal(tx.executeCalls, 0);
  });

  await runTest('12. entityId/actor strings vacíos, largos o con controles', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);

    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { entityId: '   ' })));
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { actorName: '' })));
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { actorUsername: '   ' })));

    const longString256 = 'a'.repeat(256);
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { entityId: longString256 })));
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { actorName: longString256 })));
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { actorUsername: longString256 })));

    const edgeTrim = 'a'.repeat(255) + ' ';
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { actorName: edgeTrim })));

    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { entityId: 'a\x00b' })));
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { actorName: 'a\x1Fb' })));
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { actorUsername: 'a\x7Fb' })));

    assert.equal(tx.executeCalls, 0);
  });

  await runTest('13. Inconsistencias actor conocido/anónimo y claves faltantes/adicionales', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);

    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { actorName: null })));
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { actorUsername: null })));
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { userId: null, actorName: 'User' })));

    const missingKey = Object.assign({}, baseInput);
    Reflect.deleteProperty(missingKey, 'userId');
    await assertInvalidInput(() => repo.writeAudit(missingKey));

    const extraKey = Object.assign({}, baseInput, { extra: 1 });
    await assertInvalidInput(() => repo.writeAudit(extraKey));

    const extraSymbol = Object.assign({}, baseInput);
    const sym = Symbol('extra');
    Reflect.set(extraSymbol, sym, 1);
    await assertInvalidInput(() => repo.writeAudit(extraSymbol));

    const nonEnum = Object.assign({}, baseInput);
    Object.defineProperty(nonEnum, 'extra', { value: 1, enumerable: false });
    await assertInvalidInput(() => repo.writeAudit(nonEnum));

    assert.equal(tx.executeCalls, 0);
  });

  await runTest('14. Payload cíclico, bigint, function y symbol rechazados pre-execute', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);

    interface CycleNode {
      self?: CycleNode;
    }
    const cyclic: CycleNode = {};
    cyclic.self = cyclic;
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { before: cyclic })));

    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { before: { a: 1n } })));
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { before: { a: function() { return 1; } } })));
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { before: { a: Symbol('s') } })));

    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { before: { value: NaN } })));
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { before: { value: Infinity } })));
    await assertInvalidInput(() => repo.writeAudit(Object.assign({}, baseInput, { after: { value: -Infinity } })));

    assert.equal(tx.executeCalls, 0);
    assert.equal(tx.queryCalls, 0);
  });

  await runTest('15. rowsAffected 0, 2, negativo, NaN, Infinity y decimal → unexpected_result', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);
    const tests = [0, 2, -1, NaN, Infinity, 1.5];
    for (const val of tests) {
      tx.rowsAffectedToReturn = val;
      await assertUnexpectedResult(() => repo.writeAudit(baseInput));
    }
  });

  await runTest('16. Propagación por identidad de SqlRuntimeError, higiene SQL, cero query y sentinelas solo en params', async () => {
    const tx = new FakeTransaction();
    const repo = new SqlServerOperationalAuditWriteRepository(tx);

    const error = new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'DB Failed');
    tx.errorToThrow = error;

    const entityIdSentinel = '987654321';
    const actorNameSentinel = 'ACTORNAMESENTINEL741852963';
    const actorUsernameSentinel = 'LOGINSENTINEL963852741';
    const beforeSentinel = 'BEFORESENTINEL159753486';
    const afterSentinel = 'AFTERSENTINEL357951486';

    const input = Object.assign({}, baseInput, {
      entityId: entityIdSentinel,
      actorName: actorNameSentinel,
      actorUsername: actorUsernameSentinel,
      before: { note: beforeSentinel },
      after: { note: afterSentinel }
    });

    let caught: unknown = null;
    try {
      await repo.writeAudit(input);
    } catch (e) {
      caught = e;
    }

    assert.equal(caught, error);
    assert.equal(tx.queryCalls, 0);
    assert.equal(tx.executeCalls, 1);

    const sql = requireLastSql(tx);
    assert.ok(sql.includes('INSERT INTO [prioglpi].[audit_log]'));
    assert.ok(sql.includes('VALUES ('));
    assert.ok(sql.includes('@userId'));
    assert.ok(sql.includes('@beforeJson'));
    assert.ok(!sql.includes('SELECT *'));
    assert.ok(!sql.includes('prisma'));
    assert.ok(!sql.includes('sqlite'));

    // Check sentinels absent from SQL
    assert.ok(!sql.includes(entityIdSentinel));
    assert.ok(!sql.includes(actorNameSentinel));
    assert.ok(!sql.includes(actorUsernameSentinel));
    assert.ok(!sql.includes(beforeSentinel));
    assert.ok(!sql.includes(afterSentinel));
    assert.ok(!sql.includes(CANONICAL_ACTIONS[0]));
    assert.ok(!sql.includes(CANONICAL_ENTITY_TYPES[0]));

    // Check sentinels present in parameters
    const p = requireLastParams(tx);

    const actionP = requireNVarCharParameter(p, 'action');
    assert.equal(actionP.value, CANONICAL_ACTIONS[0]);

    const entityTypeP = requireNVarCharParameter(p, 'entityType');
    assert.equal(entityTypeP.value, CANONICAL_ENTITY_TYPES[0]);

    const entityIdP = requireNVarCharParameter(p, 'entityId');
    assert.equal(entityIdP.value, entityIdSentinel);

    const actorNameP = requireNVarCharParameter(p, 'actorName');
    assert.equal(actorNameP.value, actorNameSentinel);

    const actorUsernameP = requireNVarCharParameter(p, 'actorUsername');
    assert.equal(actorUsernameP.value, actorUsernameSentinel);

    const beforeJsonP = requireNVarCharParameter(p, 'beforeJson');
    if (beforeJsonP.value === null) assert.fail('Expected beforeJson to not be null');
    assert.ok(beforeJsonP.value.includes(beforeSentinel));

    const afterJsonP = requireNVarCharParameter(p, 'afterJson');
    if (afterJsonP.value === null) assert.fail('Expected afterJson to not be null');
    assert.ok(afterJsonP.value.includes(afterSentinel));
  });
}

void main().then(() => {
  console.log(`\nTests Audit Write Repo: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
