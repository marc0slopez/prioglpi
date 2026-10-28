import assert from 'node:assert/strict';
import type { IOperationalTicketFilterOptionsRepository } from '../lib/db/operational/operational-ticket-filter-options-repository';
import { OperationalTicketFilterOptionsError } from '../lib/db/operational/operational-ticket-filter-options-repository';
import type { OperationalFilterOption, OperationalReferentOption } from '../lib/db/operational/operational-ticket-filter-options-types';
import {
  buildOperationalTicketFilterOptions,
  OperationalTicketFilterOptionsServiceError
} from '../lib/db/operational/operational-ticket-filter-options-service';
import { SqlRuntimeError } from '../lib/db/sqlserver-runtime-contract';

class FakeRepository implements IOperationalTicketFilterOptionsRepository {
  public calls = {
    listTechnicians: 0,
    listSistemasSectors: 0,
    listSistemasRequesters: 0,
    listActiveReferentOptions: 0,
    listScopedRequesters: 0
  };
  public groupIdsArg: readonly number[] | null = null;
  public resultTechs: OperationalFilterOption[] = [];
  public resultSectors: OperationalFilterOption[] = [];
  public resultRequesters: OperationalFilterOption[] = [];
  public resultReferents: OperationalReferentOption[] = [];
  public resultScopedRequesters: OperationalFilterOption[] = [];
  public errorToThrow: Error | null = null;

  async listTechnicians(): Promise<readonly OperationalFilterOption[]> {
    this.calls.listTechnicians++;
    if (this.errorToThrow) throw this.errorToThrow;
    return Object.freeze([...this.resultTechs]);
  }
  async listSistemasSectors(): Promise<readonly OperationalFilterOption[]> {
    this.calls.listSistemasSectors++;
    if (this.errorToThrow) throw this.errorToThrow;
    return Object.freeze([...this.resultSectors]);
  }
  async listSistemasRequesters(): Promise<readonly OperationalFilterOption[]> {
    this.calls.listSistemasRequesters++;
    if (this.errorToThrow) throw this.errorToThrow;
    return Object.freeze([...this.resultRequesters]);
  }
  async listActiveReferentOptions(): Promise<readonly OperationalReferentOption[]> {
    this.calls.listActiveReferentOptions++;
    if (this.errorToThrow) throw this.errorToThrow;
    return Object.freeze([...this.resultReferents]);
  }
  async listScopedRequesters(groupIds: readonly number[]): Promise<readonly OperationalFilterOption[]> {
    this.calls.listScopedRequesters++;
    this.groupIdsArg = groupIds;
    if (this.errorToThrow) throw this.errorToThrow;
    return Object.freeze([...this.resultScopedRequesters]);
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
    console.error(`[FAIL] ${name}`);
    throw err;
  }
}

async function assertInvalidInput(fn: () => Promise<unknown>): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof OperationalTicketFilterOptionsServiceError)) {
    assert.fail('Expected OperationalTicketFilterOptionsServiceError');
  }
  assert.equal(caught.code, 'invalid_input');
}

async function main() {
  await runTest('1. Admin llama a todos los métodos globales', async () => {
    const repo = new FakeRepository();
    repo.resultTechs = [{ id: 1, name: 'Tech 1' }];
    repo.resultSectors = [{ id: 1, name: 'Sec 1' }];
    repo.resultRequesters = [{ id: 1, name: 'Req 1' }];
    repo.resultReferents = [{ id: 1, displayName: 'Ref 1', glpiUserId: null, isActive: true, groups: [] }];

    const actor = { role: 'admin', sectorScopes: [] };
    const res = await buildOperationalTicketFilterOptions(repo, actor);

    assert.equal(repo.calls.listTechnicians, 1);
    assert.equal(repo.calls.listSistemasSectors, 1);
    assert.equal(repo.calls.listSistemasRequesters, 1);
    assert.equal(repo.calls.listActiveReferentOptions, 1);
    assert.equal(repo.calls.listScopedRequesters, 0);

    assert.equal(res.technicians.length, 1);
    assert.equal(res.sectors.length, 1);
    assert.equal(res.requesters.length, 1);
    assert.equal(res.referentOptions.length, 1);
  });

  await runTest('2. Coordinador llama a todos los métodos globales', async () => {
    const repo = new FakeRepository();
    const actor = { role: 'coordinador_sistemas', sectorScopes: [] };
    await buildOperationalTicketFilterOptions(repo, actor);

    assert.equal(repo.calls.listTechnicians, 1);
    assert.equal(repo.calls.listSistemasSectors, 1);
    assert.equal(repo.calls.listSistemasRequesters, 1);
    assert.equal(repo.calls.listActiveReferentOptions, 1);
    assert.equal(repo.calls.listScopedRequesters, 0);
  });

  await runTest('3. Referente usa scopes y rama acotada', async () => {
    const repo = new FakeRepository();
    repo.resultTechs = [{ id: 1, name: 'Tech 1' }];
    repo.resultScopedRequesters = [{ id: 1, name: 'Req 1' }];
    const actor = { role: 'referente', sectorScopes: [{ sectorName: 'A', glpiGroupId: 10 }] };

    const res = await buildOperationalTicketFilterOptions(repo, actor);

    assert.equal(repo.calls.listTechnicians, 1);
    assert.equal(repo.calls.listScopedRequesters, 1);
    assert.equal(repo.calls.listSistemasSectors, 0);
    assert.equal(repo.calls.listSistemasRequesters, 0);
    assert.equal(repo.calls.listActiveReferentOptions, 0);

    assert.equal(res.technicians.length, 1);
    assert.equal(res.requesters.length, 1);
    assert.equal(res.sectors.length, 1);
    assert.equal(res.sectors[0].id, 10);
    assert.equal(res.sectors[0].name, 'A');
    assert.equal(res.referentOptions.length, 0);

    assert.ok(repo.groupIdsArg);
    assert.equal(repo.groupIdsArg.length, 1);
    assert.equal(repo.groupIdsArg[0], 10);
  });

  await runTest('4. Supervisor usa scopes y rama acotada', async () => {
    const repo = new FakeRepository();
    const actor = { role: 'priorizador', sectorScopes: [{ sectorName: 'B', glpiGroupId: 20 }] };
    const res = await buildOperationalTicketFilterOptions(repo, actor);

    assert.equal(repo.calls.listTechnicians, 1);
    assert.equal(repo.calls.listScopedRequesters, 1);
    assert.equal(res.sectors[0].id, 20);
    assert.equal(res.sectors[0].name, 'B');
  });

  await runTest('5. Referente sin scopes pasa groupIds vacío', async () => {
    const repo = new FakeRepository();
    const actor = { role: 'referente', sectorScopes: [] };
    const res = await buildOperationalTicketFilterOptions(repo, actor);

    assert.equal(repo.calls.listScopedRequesters, 1);
    assert.ok(repo.groupIdsArg);
    assert.equal(repo.groupIdsArg.length, 0);
    assert.equal(res.sectors.length, 0);
  });

  await runTest('6. Roles inválidos rechazados', async () => {
    const repo = new FakeRepository();
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { role: 'system', sectorScopes: [] }));
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { role: 'otro', sectorScopes: [] }));
    assert.equal(repo.calls.listTechnicians, 0);
  });

  await runTest('7. Actor null, array o primitivo', async () => {
    const repo = new FakeRepository();
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, null));
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, []));
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, 'admin'));
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, 123));
  });

  await runTest('8. Actor sin role o sectorScopes', async () => {
    const repo = new FakeRepository();
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { role: 'admin' }));
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { sectorScopes: [] }));
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { role: 'admin', sectorScopes: [], extra: 1 }));
  });

  await runTest('9. Scopes no-array o mayor a 200 elementos', async () => {
    const repo = new FakeRepository();
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { role: 'admin', sectorScopes: {} }));
    const bigArray = Array.from({ length: 201 }, (_, i) => ({ sectorName: `S${i}`, glpiGroupId: i + 1 }));
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { role: 'admin', sectorScopes: bigArray }));
  });

  await runTest('10. Scopes IDs: NaN, Infinity, decimal, <=0, unsafe, > SQL INT', async () => {
    const repo = new FakeRepository();
    const tests = [
      NaN, Infinity, -Infinity, 1.5, 0, -1, Number.MAX_SAFE_INTEGER, 2147483648
    ];
    for (const id of tests) {
      await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { role: 'admin', sectorScopes: [{ sectorName: 'A', glpiGroupId: id }] }));
    }
    // 2147483647 is valid
    await buildOperationalTicketFilterOptions(repo, { role: 'admin', sectorScopes: [{ sectorName: 'A', glpiGroupId: 2147483647 }] });
  });

  await runTest('11. Scopes names: empty, whitespace, too long, controls', async () => {
    const repo = new FakeRepository();
    const longName = 'A'.repeat(256);
    const tests = [
      '', '   ', longName, 'A\x00B', 'A\nB'
    ];
    for (const name of tests) {
      await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { role: 'admin', sectorScopes: [{ sectorName: name, glpiGroupId: 1 }] }));
    }
  });

  await runTest('12. Scope con claves faltantes o adicionales', async () => {
    const repo = new FakeRepository();
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { role: 'admin', sectorScopes: [{ sectorName: 'A' }] }));
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { role: 'admin', sectorScopes: [{ glpiGroupId: 1 }] }));
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { role: 'admin', sectorScopes: [{ sectorName: 'A', glpiGroupId: 1, extra: 1 }] }));
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { role: 'admin', sectorScopes: [null] }));
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, { role: 'admin', sectorScopes: ['string'] }));
  });

  await runTest('13. Duplicados por groupId o nombre', async () => {
    const repo = new FakeRepository();
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, {
      role: 'admin',
      sectorScopes: [
        { sectorName: 'A', glpiGroupId: 1 },
        { sectorName: 'B', glpiGroupId: 1 }
      ]
    }));
    await assertInvalidInput(() => buildOperationalTicketFilterOptions(repo, {
      role: 'admin',
      sectorScopes: [
        { sectorName: 'a ', glpiGroupId: 1 },
        { sectorName: ' A', glpiGroupId: 2 }
      ]
    }));
  });

  await runTest('14. Propagación por identidad de error de repositorio y SqlRuntimeError', async () => {
    const repoSql = new FakeRepository();
    const errSql = new SqlRuntimeError('SQL_QUERY_EXECUTION_ERROR', 'DB ERR');
    repoSql.errorToThrow = errSql;
    let caughtSql: unknown = null;
    try {
      await buildOperationalTicketFilterOptions(repoSql, { role: 'admin', sectorScopes: [] });
    } catch (e) {
      caughtSql = e;
    }
    if (caughtSql !== errSql) assert.fail('Expected exact SqlRuntimeError identity');
    assert.equal(caughtSql, errSql);

    const repoRepo = new FakeRepository();
    const errRepo = new OperationalTicketFilterOptionsError('corrupt_data', 'Repository error');
    repoRepo.errorToThrow = errRepo;
    let caughtRepo: unknown = null;
    try {
      await buildOperationalTicketFilterOptions(repoRepo, { role: 'admin', sectorScopes: [] });
    } catch (e) {
      caughtRepo = e;
    }
    if (caughtRepo !== errRepo) assert.fail('Expected exact OperationalTicketFilterOptionsError identity');
    assert.equal(caughtRepo, errRepo);
  });

  await runTest('15. Preservación de orden y no mutación de entradas', async () => {
    const repo = new FakeRepository();
    const actor = { role: 'referente', sectorScopes: [{ sectorName: 'B', glpiGroupId: 2 }, { sectorName: 'A', glpiGroupId: 1 }] };
    Object.freeze(actor.sectorScopes);
    Object.freeze(actor.sectorScopes[0]);
    Object.freeze(actor.sectorScopes[1]);
    Object.freeze(actor);

    const res = await buildOperationalTicketFilterOptions(repo, actor);

    assert.equal(res.sectors.length, 2);
    assert.equal(res.sectors[0].name, 'B');
    assert.equal(res.sectors[1].name, 'A');

    assert.ok(repo.groupIdsArg);
    assert.equal(repo.groupIdsArg.length, 2);
    assert.equal(repo.groupIdsArg[0], 2);
    assert.equal(repo.groupIdsArg[1], 1);
  });

  await runTest('16. Inmutabilidad profunda total de respuesta', async () => {
    const repo = new FakeRepository();
    const origTech = { id: 1, name: 'Tech 1' };
    const origSector = { id: 2, name: 'Sec 2' };
    const origReq = { id: 3, name: 'Req 3' };
    const origGroup = { glpiGroupId: 1, sectorName: 'S' };
    const origRef = { id: 1, displayName: 'Ref', glpiUserId: 10, isActive: true, groups: [origGroup] };

    repo.resultTechs = [origTech];
    repo.resultSectors = [origSector];
    repo.resultRequesters = [origReq];
    repo.resultReferents = [origRef];

    const actor = { role: 'admin', sectorScopes: [] };
    const res = await buildOperationalTicketFilterOptions(repo, actor);

    assert.ok(Object.isFrozen(res));
    assert.ok(Object.isFrozen(res.technicians));
    assert.ok(Object.isFrozen(res.sectors));
    assert.ok(Object.isFrozen(res.requesters));
    assert.ok(Object.isFrozen(res.referentOptions));

    const tech = res.technicians[0];
    assert.ok(tech !== undefined);
    assert.ok(Object.isFrozen(tech));
    assert.ok(tech !== origTech);

    const sec = res.sectors[0];
    assert.ok(sec !== undefined);
    assert.ok(Object.isFrozen(sec));
    assert.ok(sec !== origSector);

    const req = res.requesters[0];
    assert.ok(req !== undefined);
    assert.ok(Object.isFrozen(req));
    assert.ok(req !== origReq);

    const ref = res.referentOptions[0];
    assert.ok(ref !== undefined);
    assert.ok(Object.isFrozen(ref));
    assert.ok(ref !== origRef);

    assert.ok(Object.isFrozen(ref.groups));
    const grp = ref.groups[0];
    assert.ok(grp !== undefined);
    assert.ok(Object.isFrozen(grp));
    assert.ok(grp !== origGroup);

    assert.ok(!Object.isFrozen(origTech));
    assert.ok(!Object.isFrozen(origSector));
    assert.ok(!Object.isFrozen(origReq));
    assert.ok(!Object.isFrozen(origRef));
    assert.ok(!Object.isFrozen(origGroup));
  });
}

void main().then(() => {
  console.log(`\nTests Service: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
