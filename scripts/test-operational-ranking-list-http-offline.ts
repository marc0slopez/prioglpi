import assert from 'node:assert/strict';
import {
  OperationalRankingListQueryError,
  parseOperationalRankingListQuery
} from '../lib/db/operational/operational-ranking-list-query';

let passed = 0;
let failed = 0;
let total = 0;

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  total += 1;

  try {
    await fn();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`[FAIL] ${name}`);
    console.error(error);
  }
}

function expectInvalidActor(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof OperationalRankingListQueryError);
    assert.equal(error.code, 'invalid_actor');
    return;
  }

  assert.fail('Expected invalid_actor error');
}

async function main(): Promise<void> {
  await runTest('admin sin ownerUserId usa ranking global/null', () => {
    const parsed = parseOperationalRankingListQuery(
      new URLSearchParams(),
      { role: 'admin', userId: 1, sectorGroupIds: [] }
    );

    assert.deepEqual(parsed, { status: 'success', ownerUserId: null });
  });

  await runTest('admin con ownerUserId numerico filtra por priorizador', () => {
    const parsed = parseOperationalRankingListQuery(
      new URLSearchParams({ ownerUserId: '231' }),
      { role: 'admin', userId: 1, sectorGroupIds: [] }
    );

    assert.deepEqual(parsed, { status: 'success', ownerUserId: 231 });
  });

  await runTest('coordinador con todos usa ranking global/null', () => {
    const parsed = parseOperationalRankingListQuery(
      new URLSearchParams({ ownerUserId: 'todos' }),
      { role: 'coordinador_sistemas', userId: 13, sectorGroupIds: [] }
    );

    assert.deepEqual(parsed, { status: 'success', ownerUserId: null });
  });

  await runTest('priorizador siempre queda acotado a su propio userId', () => {
    const parsed = parseOperationalRankingListQuery(
      new URLSearchParams({ ownerUserId: '999' }),
      { role: 'priorizador', userId: 231, sectorGroupIds: [14, 15, 36, 55] }
    );

    assert.deepEqual(parsed, { status: 'success', ownerUserId: 231 });
  });

  await runTest('referente tambien queda acotado a su propio userId', () => {
    const parsed = parseOperationalRankingListQuery(
      new URLSearchParams(),
      { role: 'referente', userId: 232, sectorGroupIds: [15] }
    );

    assert.deepEqual(parsed, { status: 'success', ownerUserId: 232 });
  });

  await runTest('ownerUserId invalido devuelve 400', () => {
    for (const value of ['', '0', '-1', '1.5', '1e3', 'all', '2147483648']) {
      const parsed = parseOperationalRankingListQuery(
        new URLSearchParams({ ownerUserId: value }),
        { role: 'admin', userId: 1, sectorGroupIds: [] }
      );

      assert.equal(parsed.status, 'error');
      if (parsed.status === 'error') {
        assert.equal(parsed.httpStatus, 400);
      }
    }
  });

  await runTest('ownerUserId repetido devuelve 400', () => {
    const params = new URLSearchParams();
    params.append('ownerUserId', '231');
    params.append('ownerUserId', '232');

    const parsed = parseOperationalRankingListQuery(
      params,
      { role: 'admin', userId: 1, sectorGroupIds: [] }
    );

    assert.equal(parsed.status, 'error');
    if (parsed.status === 'error') {
      assert.equal(parsed.httpStatus, 400);
    }
  });

  await runTest('actor invalido lanza error estructural', () => {
    expectInvalidActor(() => parseOperationalRankingListQuery(new URLSearchParams(), null));
    expectInvalidActor(() => parseOperationalRankingListQuery(new URLSearchParams(), { role: 'admin', sectorGroupIds: [] }));
    expectInvalidActor(() => parseOperationalRankingListQuery(new URLSearchParams(), { role: 'system', userId: 1, sectorGroupIds: [] }));
    expectInvalidActor(() => parseOperationalRankingListQuery(new URLSearchParams(), { role: 'admin', userId: 0, sectorGroupIds: [] }));
    expectInvalidActor(() => parseOperationalRankingListQuery(new URLSearchParams(), { role: 'admin', userId: 1, sectorGroupIds: [10, 10] }));
  });
}

void main().then(() => {
  console.log(`Tests Operational Ranking List HTTP: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
  if (failed > 0) process.exitCode = 1;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
