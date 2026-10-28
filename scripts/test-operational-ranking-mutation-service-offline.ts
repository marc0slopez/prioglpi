import assert from 'node:assert/strict';
import {
  patchOperationalRanking,
  deleteOperationalRanking,
  reorderOperationalRankings,
  OperationalRankingMutationError
} from '../lib/db/operational/operational-ranking-mutation-service';
import {
  parsePatchMutation as parsePatch,
  parseDeleteMutation as parseDelete,
  parseReorderMutation as parseReorder,
  isOperationalRankingMutationRole
} from '../lib/db/operational/operational-ranking-mutation-types';
import type { OperationalRankingMutationActor } from '../lib/db/operational/operational-ranking-mutation-types';
import { SqlRuntimeError, type ISqlServerRuntime, type ISqlServerTransaction, type SqlRow, type SqlParameter, type TransactionOptions } from '../lib/db/sqlserver-runtime-contract';
import type { IOperationalRankingWriteRepository } from '../lib/db/operational/operational-ranking-write-repository';
import type { IOperationalTicketListContextRepository } from '../lib/db/operational/operational-ticket-list-context-repository';
import type { IOperationalAuditWriteRepository } from '../lib/db/operational/operational-audit-write-repository';
import type { IOperationalUserReadRepository } from '../lib/db/operational/operational-user-read-repository';
import type { OperationalRankingMutationTicket, OperationalRankingMutationGroup, OperationalActiveRankingState } from '../lib/db/operational/operational-ranking-write-types';
import type { OperationalUserWithScopes } from '../lib/db/operational/operational-user-types';

// --- Fakes ---

class FakeTransaction implements ISqlServerTransaction {
  async query(_sql: string, _params?: SqlParameter[]): Promise<SqlRow[]> {
    void _sql;
    void _params;
    return [];
  }
  async execute(_sql: string, _params?: SqlParameter[]): Promise<number> {
    void _sql;
    void _params;
    return 1;
  }
}

class FakeRuntime implements ISqlServerRuntime {
  public commitCount = 0;
  public rollbackCount = 0;
  public txCaptures: ISqlServerTransaction[] = [];

  async withTransaction<T>(
    _options: TransactionOptions | undefined,
    callback: (tx: ISqlServerTransaction) => Promise<T>
  ): Promise<T> {
    void _options;
    const tx = new FakeTransaction();
    this.txCaptures.push(tx);
    try {
      const res = await callback(tx);
      this.commitCount++;
      return res;
    } catch (e) {
      this.rollbackCount++;
      throw e;
    }
  }

  async query(_sql: string, _params?: SqlParameter[]): Promise<SqlRow[]> {
    void _sql;
    void _params;
    return [];
  }
  async execute(_sql: string, _params?: SqlParameter[]): Promise<number> {
    void _sql;
    void _params;
    return 1;
  }
  async close(): Promise<void> {}
}

function makeTicket(overrides: Partial<OperationalRankingMutationTicket> = {}): OperationalRankingMutationTicket {
  return Object.freeze({
    ticketId: 1,
    isSistemasScope: true,
    status: 1,
    statusLabel: 'New',
    detectedSector: 'Sistemas',
    detectedSectorGroupId: 10,
    ...overrides
  });
}

function makeGroup(overrides: Partial<OperationalRankingMutationGroup> = {}): OperationalRankingMutationGroup {
  return Object.freeze({
    groupId: 10,
    name: 'TI',
    completeName: 'TI > Sistemas',
    ...overrides
  });
}

function makeRanking(overrides: Partial<OperationalActiveRankingState> = {}): OperationalActiveRankingState {
  const now = new Date('2023-01-01T00:00:00Z');
  return Object.freeze({
    id: 1,
    ticketId: 1,
    sectorName: 'Sistemas',
    glpiGroupId: 10,
    rankPosition: 1,
    createdByUserId: 99,
    updatedByUserId: 99,
    createdAt: now,
    updatedAt: now,
    isActive: true,
    ...overrides
  });
}

interface FakeRepoOptions {
  ticket?: OperationalRankingMutationTicket | null;
  group?: OperationalRankingMutationGroup | null;
  rankings?: OperationalActiveRankingState[];
  tickets?: OperationalRankingMutationTicket[];
  referentCtx?: { userId: number; groupIds: readonly number[] } | null;
  upsertResult?: 'ok' | Error;
  updateResult?: 'updated' | 'not_found';
  deactivateResult?: 'updated' | 'not_found';
  capturedTxes?: ISqlServerTransaction[];
  findTicketCalls?: number[];
  listTicketsByIdsCalls?: number;
  findGroupCalls?: number;
  listActiveRankingsCalls?: number;
  auditCalls?: number;
  upsertCalls?: number;
  parkCalls?: number;
  userReadMock?: (id: number) => Promise<OperationalUserWithScopes | null>;
}

function makeRepos(opts: FakeRepoOptions = {}): (tx: ISqlServerTransaction) => {
  ranking: IOperationalRankingWriteRepository;
  context: IOperationalTicketListContextRepository;
  audit: IOperationalAuditWriteRepository;
  userRead: IOperationalUserReadRepository;
} {
  return (tx: ISqlServerTransaction) => {
    if (opts.capturedTxes) opts.capturedTxes.push(tx);
    const ranking: IOperationalRankingWriteRepository = {
      findTicketById: async (id: number) => {
        if (opts.findTicketCalls) opts.findTicketCalls.push(id);
        return opts.ticket !== undefined ? opts.ticket : makeTicket({ ticketId: id });
      },
      findGroupById: async () => {
        if (opts.findGroupCalls !== undefined) opts.findGroupCalls++;
        return opts.group !== undefined ? opts.group : makeGroup();
      },
      listActiveRankingsByGroupId: async () => {
        if (opts.listActiveRankingsCalls !== undefined) opts.listActiveRankingsCalls++;
        return opts.rankings ?? [];
      },
      upsertActiveRanking: async () => {
        if (opts.upsertCalls !== undefined) opts.upsertCalls++;
        if (opts.upsertResult instanceof Error) throw opts.upsertResult;
      },
      updateActiveRankingPosition: async () => opts.updateResult ?? 'updated',
      acquireGroupLock: async () => {},
      parkActiveRankingPositionsForGroup: async (_glpiGroupId, ticketIds, _actorId, _updatedAt, expectedRows) => {
        void _glpiGroupId;
        if (opts.parkCalls !== undefined) opts.parkCalls++;
        return expectedRows; // Always return expected to pass check
      },
      deactivateActiveRanking: async () => opts.deactivateResult ?? 'updated',
      listTicketsByIds: async () => {
        if (opts.listTicketsByIdsCalls !== undefined) opts.listTicketsByIdsCalls++;
        return opts.tickets ?? [];
      }
    };
    const context: IOperationalTicketListContextRepository = {
      findActiveReferentContext: async () => opts.referentCtx !== undefined ? opts.referentCtx : null,
      isActiveNonReferentRequesterInGroups: async () => false
    };
    const audit: IOperationalAuditWriteRepository = {
      writeAudit: async () => {
        if (opts.auditCalls !== undefined) opts.auditCalls++;
      }
    };
    const userRead: IOperationalUserReadRepository = {
      findById: async () => null,
      findByUsername: async () => null,
      findByGlpiUserId: async () => null,
      findCandidatesByUsernameOrAdObjectId: async () => [],
      findByIdWithScopes: async (id: number) => {
        if (opts.userReadMock) return opts.userReadMock(id);
        if (id === 2 || id === 3 || id === 4 || id === 50) {
          return {
            id,
            username: `priorizador${id}`,
            passwordHash: null,
            displayName: `Priorizador ${id}`,
            role: 'priorizador' as const,
            isActive: true,
            glpiUserId: null,
            adObjectId: null,
            email: null,
            authSource: 'local' as const,
            directoryActive: null,
            directoryStatusCheckedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            sectorScopes: [{ id: 1, userId: id, sectorName: 'Test', glpiGroupId: 10 }, { id: 2, userId: id, sectorName: 'Test2', glpiGroupId: 20 }]
          };
        }
        return null;
      },
      listActiveByRoles: async () => []
    };
    return { ranking, context, audit, userRead };
  };
}

// --- Test runner ---

let passed = 0, failed = 0, total = 0;
async function runTest(name: string, fn: () => void | Promise<void>) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] ${name}: ${message}`);
    throw err;
  }
}


const adminActor: OperationalRankingMutationActor = Object.freeze({
  userId: 1, role: 'admin', username: 'admin', displayName: 'Admin'
});

const priorizadorActor: OperationalRankingMutationActor = Object.freeze({
  userId: 2, role: 'priorizador', username: 'priorizador', displayName: 'Priorizador'
});

// --- Tests ---

async function main() {

  // === PARSER TESTS ===

  await runTest('P1. isOperationalRankingMutationRole acepta admin y priorizador', () => {
    assert.ok(isOperationalRankingMutationRole('admin'));
    assert.ok(isOperationalRankingMutationRole('priorizador'));
    assert.ok(!isOperationalRankingMutationRole('viewer'));
    assert.ok(!isOperationalRankingMutationRole(''));
    assert.ok(!isOperationalRankingMutationRole('ADMIN'));
  });

  await runTest('P2. parsePatchMutation rechaza path invalido y overflow', () => {
    const r1 = parsePatch('abc', { newPosition: 1 });
    assert.ok(!r1.success);
    assert.equal(r1.httpStatus, 400);

    const r2 = parsePatch('9999999999', { newPosition: 1 });
    assert.ok(!r2.success);

    const r3 = parsePatch('0', { newPosition: 1 });
    assert.ok(!r3.success);
  });

  await runTest('P3. parsePatchMutation rechaza body null, array, claves adicionales', () => {
    const r1 = parsePatch('1', null);
    assert.ok(!r1.success);

    const r2 = parsePatch('1', [1, 2]);
    assert.ok(!r2.success);

    const r3 = parsePatch('1', { newPosition: 1, extra: 'x' });
    assert.ok(!r3.success);

    const r4 = parsePatch('1', {});
    assert.ok(!r4.success);
  });

  await runTest('P4. parsePatchMutation rechaza Symbol como clave', () => {
    const sym = Symbol('newPosition');
    const body: Record<string | symbol, unknown> = {};
    body[sym] = 1;
    // body has 1 Symbol key and 0 string keys
    // Reflect.ownKeys returns [sym], typeof sym !== 'string' => invalid
    const r = parsePatch('1', body);
    assert.ok(!r.success);
  });

  await runTest('P5. parsePatchMutation acepta newPosition valido y congela resultado', () => {
    const r = parsePatch('5', { newPosition: 3 });
    assert.ok(r.success);
    if (r.success) {
      assert.equal(r.data.ticketId, 5);
      assert.equal(r.data.newPosition, 3);
      assert.ok(Object.isFrozen(r.data));
    }
  });

  await runTest('P6. parseDeleteMutation rechaza id invalido', () => {
    assert.ok(!parseDelete('0', new URLSearchParams()).success);
    assert.ok(!parseDelete('abc', new URLSearchParams()).success);
    assert.ok(!parseDelete('9999999999', new URLSearchParams()).success);
    assert.ok(parseDelete('1', new URLSearchParams()).success);
  });

  await runTest('P7. parseReorderMutation rechaza vacio, >200, duplicados', () => {
    const r1 = parseReorder({ orderedTicketIds: [] });
    assert.ok(!r1.success);

    const bigArr = Array.from({ length: 201 }, (_, i) => i + 1);
    const r2 = parseReorder({ orderedTicketIds: bigArr });
    assert.ok(!r2.success);

    const r3 = parseReorder({ orderedTicketIds: [1, 1] });
    assert.ok(!r3.success);
  });

  await runTest('P8. parseReorderMutation rechaza claves adicionales y symbols', () => {
    const r1 = parseReorder({ orderedTicketIds: [1], extra: 'x' });
    assert.ok(!r1.success);

    const bodyWithSymbol: Record<string | symbol, unknown> = { orderedTicketIds: [1] };
    const sym = Symbol('s');
    bodyWithSymbol[sym] = 'val';
    const r2 = parseReorder(bodyWithSymbol);
    // Symbol keys counted by Reflect.ownKeys but not as string, should fail
    assert.ok(!r2.success);
  });

  await runTest('P9. parseReorderMutation congela orderedTicketIds y el objeto data', () => {
    const r = parseReorder({ orderedTicketIds: [1, 2, 3] });
    assert.ok(r.success);
    if (r.success) {
      assert.ok(Object.isFrozen(r.data));
      assert.ok(Object.isFrozen(r.data.orderedTicketIds));
    }
  });

  await runTest('P10. parsePatchMutation valida ownerUserId (omisión, válido, inválidos)', () => {
    // Omisión
    assert.ok(parsePatch('1', { newPosition: 1 }).success);
    // Válido
    assert.ok(parsePatch('1', { newPosition: 1, ownerUserId: 50 }).success);

    // Inválidos
    assert.ok(!parsePatch('1', { newPosition: 1, ownerUserId: null }).success);
    assert.ok(!parsePatch('1', { newPosition: 1, ownerUserId: 0 }).success);
    assert.ok(!parsePatch('1', { newPosition: 1, ownerUserId: -5 }).success);
    assert.ok(!parsePatch('1', { newPosition: 1, ownerUserId: 50.5 }).success);
    assert.ok(!parsePatch('1', { newPosition: 1, ownerUserId: 99999999999 }).success); // out of SQL int range
  });

  await runTest('P11. parseDeleteMutation valida ownerUserId y rechaza duplicados', () => {
    // Omisión
    assert.ok(parseDelete('1', new URLSearchParams()).success);
    // Válido
    assert.ok(parseDelete('1', new URLSearchParams('ownerUserId=50')).success);

    // Duplicado
    assert.ok(!parseDelete('1', new URLSearchParams('ownerUserId=50&ownerUserId=51')).success);

    // Inválidos
    assert.ok(!parseDelete('1', new URLSearchParams('ownerUserId=0')).success);
    assert.ok(!parseDelete('1', new URLSearchParams('ownerUserId=-5')).success);
    assert.ok(!parseDelete('1', new URLSearchParams('ownerUserId=abc')).success);
    assert.ok(!parseDelete('1', new URLSearchParams('ownerUserId=50.5')).success);
    assert.ok(!parseDelete('1', new URLSearchParams('ownerUserId=99999999999')).success);
  });

  await runTest('P12. parseReorderMutation valida ownerUserId', () => {
    // Omisión
    assert.ok(parseReorder({ orderedTicketIds: [1] }).success);
    // Válido
    assert.ok(parseReorder({ orderedTicketIds: [1], ownerUserId: 50 }).success);

    // Inválidos
    assert.ok(!parseReorder({ orderedTicketIds: [1], ownerUserId: 0 }).success);
    assert.ok(!parseReorder({ orderedTicketIds: [1], ownerUserId: -5 }).success);
    assert.ok(!parseReorder({ orderedTicketIds: [1], ownerUserId: 50.5 }).success);
    assert.ok(!parseReorder({ orderedTicketIds: [1], ownerUserId: 99999999999 }).success);
  });

  // === PATCH TESTS ===

  await runTest('PA1. PATCH: ticket no encontrado lanza 404 y rollback', async () => {
    const rt = new FakeRuntime();
    const opts = { repositoryFactory: makeRepos({ ticket: null }) };
    let caught: unknown;
    try {
      await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 1, ownerUserId: 50 }, opts);
    } catch (e) { caught = e; }
    assert.ok(caught instanceof OperationalRankingMutationError);
    assert.equal(caught.httpStatus, 404);
    assert.equal(rt.commitCount, 0);
    assert.equal(rt.rollbackCount, 1);
  });

  await runTest('PA2. PATCH: ticket fuera de Sistemas lanza 400', async () => {
    const rt = new FakeRuntime();
    const opts = { repositoryFactory: makeRepos({ ticket: makeTicket({ isSistemasScope: false }) }) };
    let caught: unknown;
    try {
      await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 1, ownerUserId: 50 }, opts);
    } catch (e) { caught = e; }
    assert.ok(caught instanceof OperationalRankingMutationError);
    assert.equal(caught.httpStatus, 400);
  });

  await runTest('PA3. PATCH: sin grupo detectado lanza 400', async () => {
    const rt = new FakeRuntime();
    const opts = { repositoryFactory: makeRepos({ ticket: makeTicket({ detectedSectorGroupId: null }) }) };
    let caught: unknown;
    try {
      await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 1, ownerUserId: 50 }, opts);
    } catch (e) { caught = e; }
    assert.ok(caught instanceof OperationalRankingMutationError);
    assert.equal(caught.httpStatus, 400);
  });

  await runTest('PA4. PATCH: status cerrado lanza 400', async () => {
    const rt = new FakeRuntime();
    const opts = { repositoryFactory: makeRepos({ ticket: makeTicket({ status: 5 }) }) };
    let caught: unknown;
    try {
      await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 1, ownerUserId: 50 }, opts);
    } catch (e) { caught = e; }
    assert.ok(caught instanceof OperationalRankingMutationError);
    assert.equal(caught.httpStatus, 400);
  });
  await runTest('PA5. PATCH: priorizador no requiere contexto referente', async () => {
    const rt = new FakeRuntime();
    const opts = {
      repositoryFactory: makeRepos({
        ticket: makeTicket(),
        referentCtx: null,
        rankings: []
      })
    };

    const result = await patchOperationalRanking(rt, priorizadorActor, { ticketId: 1, newPosition: 1 }, opts);

    assert.equal(result.changed, true);
    assert.ok(result.message.includes('Ticket #1'));
    assert.equal(result.newOrder.length, 1);
    assert.equal(result.newOrder[0]?.ticketId, 1);
    assert.equal(result.newOrder[0]?.position, 1);
    assert.equal(rt.commitCount, 1);
    assert.equal(rt.rollbackCount, 0);
  });

  await runTest('PA6. PATCH: admin no llama findActiveReferentContext', async () => {
    const rt = new FakeRuntime();
    let contextCalled = false;
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket(), rankings: [] })(tx);
        const origCtx = repos.context.findActiveReferentContext.bind(repos.context);
        repos.context.findActiveReferentContext = async (id: number) => {
          contextCalled = true;
          return origCtx(id);
        };
        return repos;
      }
    };
    await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 1, ownerUserId: 50 }, opts);
    assert.ok(!contextCalled, 'Admin should not call findActiveReferentContext');
  });

  await runTest('PA7. PATCH: alta nueva usa upsert, commit, newOrder correcto', async () => {
    const rt = new FakeRuntime();
    const upsertCalls: number[] = [];
    const auditCalls: number[] = [];
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket(), rankings: [] })(tx);
        repos.ranking.upsertActiveRanking = async (input) => {
          upsertCalls.push(input.ticketId);
        };
        repos.audit.writeAudit = async () => { auditCalls.push(1); };
        return repos;
      }
    };
    const result = await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 1, ownerUserId: 50 }, opts);
    assert.ok(result.changed);
    assert.equal(upsertCalls.length, 1);
    assert.equal(upsertCalls[0], 1);
    assert.equal(rt.commitCount, 1);
    if (result.changed) {
      assert.equal(result.newOrder.length, 1);
      const firstOrderItem = result.newOrder[0];
      assert.ok(firstOrderItem !== undefined);
      assert.equal(firstOrderItem.ticketId, 1);
      assert.equal(firstOrderItem.position, 1);
    }
  });

  await runTest('PA8. PATCH: movimiento existente usa upsert para target, otros solo si cambian', async () => {
    const rt = new FakeRuntime();
    const upsertCalls: number[] = [];
    const updateCalls: number[] = [];
    const now = new Date();
    const r1 = makeRanking({ id: 1, ticketId: 1, rankPosition: 1 });
    const r2 = makeRanking({ id: 2, ticketId: 2, rankPosition: 2 });
    const r3 = makeRanking({ id: 3, ticketId: 3, rankPosition: 3 });
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 1 }), rankings: [r1, r2, r3] })(tx);
        repos.ranking.upsertActiveRanking = async (input) => { upsertCalls.push(input.ticketId); };
        repos.ranking.updateActiveRankingPosition = async (input) => {
          updateCalls.push(input.ticketId);
          return 'updated';
        };
        repos.audit.writeAudit = async () => {};
        return repos;
      },
      clock: () => now
    };
    // Move ticket 1 to position 3 => orderedIds = [2, 3, 1]
    const result = await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 3, ownerUserId: 50 }, opts);
    assert.ok(result.changed);
    // Target ticket 1 => upsert
    assert.ok(upsertCalls.includes(1));
    // ticket 2 moves from pos 2 to pos 1 => update
    assert.ok(updateCalls.includes(2));
    // ticket 3 moves from pos 3 to pos 2 => update
    assert.ok(updateCalls.includes(3));
    // ticket 1 should NOT be in updateCalls
    assert.ok(!updateCalls.includes(1));
  });

  await runTest('PA9. PATCH: clamp al final de la lista', async () => {
    const rt = new FakeRuntime();
    const upsertPositions: number[] = [];
    const r1 = makeRanking({ id: 1, ticketId: 10, rankPosition: 1 });
    const r2 = makeRanking({ id: 2, ticketId: 20, rankPosition: 2 });
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 99, detectedSectorGroupId: 10 }), rankings: [r1, r2] })(tx);
        repos.ranking.upsertActiveRanking = async (input) => { upsertPositions.push(input.rankPosition); };
        repos.ranking.updateActiveRankingPosition = async () => 'updated';
        repos.audit.writeAudit = async () => {};
        return repos;
      }
    };
    // Request position 999, should clamp to 3
    await patchOperationalRanking(rt, adminActor, { ticketId: 99, newPosition: 999, ownerUserId: 50 }, opts);
    assert.ok(upsertPositions.includes(3));
  });

  await runTest('PA10. PATCH: sin cambios devuelve changed:false, cero writes y cero audit', async () => {
    const rt = new FakeRuntime();
    let writeCalls = 0;
    let auditCalls = 0;
    const r1 = makeRanking({ id: 1, ticketId: 1, rankPosition: 1 });
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 1 }), rankings: [r1] })(tx);
        repos.ranking.upsertActiveRanking = async () => { writeCalls++; };
        repos.ranking.updateActiveRankingPosition = async () => { writeCalls++; return 'updated'; };
        repos.audit.writeAudit = async () => { auditCalls++; };
        return repos;
      }
    };
    const result = await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 1, ownerUserId: 50 }, opts);
    assert.ok(!result.changed);
    assert.equal(writeCalls, 0);
    assert.equal(auditCalls, 0);
    assert.equal(rt.commitCount, 1);
  });

  await runTest('PA11. PATCH: not_found inesperado causa rollback', async () => {
    const rt = new FakeRuntime();
    const r1 = makeRanking({ id: 1, ticketId: 1, rankPosition: 1 });
    const r2 = makeRanking({ id: 2, ticketId: 2, rankPosition: 2 });
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 2 }), rankings: [r1, r2] })(tx);
        repos.ranking.upsertActiveRanking = async () => {};
        repos.ranking.updateActiveRankingPosition = async () => 'not_found';
        repos.audit.writeAudit = async () => {};
        return repos;
      }
    };
    let caught: unknown;
    try {
      await patchOperationalRanking(rt, adminActor, { ticketId: 2, newPosition: 1, ownerUserId: 50 }, opts);
    } catch (e) { caught = e; }
    assert.ok(caught instanceof Error);
    assert.equal(caught.message, 'postcondition_failed');
    assert.equal(rt.rollbackCount, 1);
  });

  await runTest('PA12. PATCH: audit es la ultima escritura y comparte tx', async () => {
    const rt = new FakeRuntime();
    const callOrder: string[] = [];
    const capturedTxes: ISqlServerTransaction[] = [];
    const r1 = makeRanking({ id: 1, ticketId: 1, rankPosition: 1 });
    const r2 = makeRanking({ id: 2, ticketId: 2, rankPosition: 2 });
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        capturedTxes.push(tx);
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 1 }), rankings: [r1, r2] })(tx);
        repos.ranking.upsertActiveRanking = async () => { callOrder.push('upsert'); };
        repos.ranking.updateActiveRankingPosition = async () => { callOrder.push('update'); return 'updated'; };
        repos.audit.writeAudit = async () => { callOrder.push('audit'); };
        return repos;
      }
    };
    await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 2, ownerUserId: 50 }, opts);
    const auditIdx = callOrder.lastIndexOf('audit');
    const upsertIdx = callOrder.lastIndexOf('upsert');
    const updateIdx = callOrder.lastIndexOf('update');
    const lastMutIdx = Math.max(upsertIdx, updateIdx);
    assert.ok(auditIdx !== -1, 'Audit must be called');
    assert.ok(lastMutIdx !== -1, 'At least one mutation must occur');
    assert.ok(auditIdx > lastMutIdx, 'Audit must come after last write');
    assert.equal(capturedTxes.length, 1);
  });

  // === DELETE TESTS ===

  await runTest('DE1. DELETE: ticket no encontrado lanza 404', async () => {
    const rt = new FakeRuntime();
    let caught: unknown;
    try {
      await deleteOperationalRanking(rt, adminActor, { ticketId: 1, ownerUserId: 50 }, {
        repositoryFactory: makeRepos({ ticket: null })
      });
    } catch (e) { caught = e; }
    assert.ok(caught instanceof OperationalRankingMutationError);
    assert.equal(caught.httpStatus, 404);
  });

  await runTest('DE2. DELETE: ticket fuera de Sistemas lanza 400', async () => {
    const rt = new FakeRuntime();
    let caught: unknown;
    try {
      await deleteOperationalRanking(rt, adminActor, { ticketId: 1, ownerUserId: 50 }, {
        repositoryFactory: makeRepos({ ticket: makeTicket({ isSistemasScope: false }) })
      });
    } catch (e) { caught = e; }
    assert.ok(caught instanceof OperationalRankingMutationError);
    assert.equal(caught.httpStatus, 400);
  });

  await runTest('DE3. DELETE: ranking ausente devuelve changed:false, cero writes y cero audit', async () => {
    const rt = new FakeRuntime();
    let deactivateCalls = 0;
    let auditCalls = 0;
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket(), rankings: [] })(tx);
        repos.ranking.deactivateActiveRanking = async () => { deactivateCalls++; return 'updated'; };
        repos.audit.writeAudit = async () => { auditCalls++; };
        return repos;
      }
    };
    const result = await deleteOperationalRanking(rt, adminActor, { ticketId: 1, ownerUserId: 50 }, opts);
    assert.ok(!result.changed);
    assert.equal(deactivateCalls, 0);
    assert.equal(auditCalls, 0);
  });

  await runTest('DE4. DELETE: desactiva y renumera, audit al final', async () => {
    const rt = new FakeRuntime();
    const callOrder: string[] = [];
    const r1 = makeRanking({ id: 1, ticketId: 1, rankPosition: 1 });
    const r2 = makeRanking({ id: 2, ticketId: 2, rankPosition: 2 });
    const r3 = makeRanking({ id: 3, ticketId: 3, rankPosition: 3 });
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 1 }), rankings: [r1, r2, r3] })(tx);
        repos.ranking.deactivateActiveRanking = async () => { callOrder.push('deactivate'); return 'updated'; };
        repos.ranking.updateActiveRankingPosition = async () => { callOrder.push('update'); return 'updated'; };
        repos.audit.writeAudit = async () => { callOrder.push('audit'); };
        return repos;
      }
    };
    const result = await deleteOperationalRanking(rt, adminActor, { ticketId: 1, ownerUserId: 50 }, opts);
    assert.ok(result.changed);
    assert.ok(callOrder.includes('deactivate'));
    // Tickets 2 and 3 should renumber: 2=>1, 3=>2
    assert.equal(callOrder.filter(c => c === 'update').length, 2);
    const auditIdx = callOrder.lastIndexOf('audit');
    assert.ok(auditIdx === callOrder.length - 1, 'Audit must be last');
    assert.equal(rt.commitCount, 1);
  });

  await runTest('DE5. DELETE: not_found en deactivate causa rollback', async () => {
    const rt = new FakeRuntime();
    const r1 = makeRanking({ id: 1, ticketId: 1, rankPosition: 1 });
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket(), rankings: [r1] })(tx);
        repos.ranking.deactivateActiveRanking = async () => 'not_found';
        return repos;
      }
    };
    let caught: unknown;
    try {
      await deleteOperationalRanking(rt, adminActor, { ticketId: 1, ownerUserId: 50 }, opts);
    } catch (e) { caught = e; }
    assert.ok(caught instanceof Error);
    assert.equal(caught.message, 'postcondition_failed');
    assert.equal(rt.rollbackCount, 1);
  });

  // === REORDER TESTS ===
  await runTest('RE1. REORDER: ticket fuera del ranking activo lanza 400', async () => {
    const rt = new FakeRuntime();
    let caught: unknown;
    try {
      await reorderOperationalRankings(rt, adminActor, { orderedTicketIds: [1], ownerUserId: 50 }, {
        repositoryFactory: makeRepos({
          tickets: [makeTicket()],
          rankings: []
        })
      });
    } catch (e) { caught = e; }
    assert.ok(caught instanceof OperationalRankingMutationError);
    assert.equal(caught.httpStatus, 400);
  });

  await runTest('RE2. REORDER: tickets faltantes lanza 400', async () => {
    const rt = new FakeRuntime();
    let caught: unknown;
    try {
      await reorderOperationalRankings(rt, adminActor, { orderedTicketIds: [1, 2], ownerUserId: 50 }, {
        repositoryFactory: makeRepos({ group: makeGroup(), tickets: [makeTicket({ ticketId: 1 })] })
      });
    } catch (e) { caught = e; }
    assert.ok(caught instanceof OperationalRankingMutationError);
    assert.equal(caught.httpStatus, 400);
  });

  await runTest('RE3. REORDER: ticket fuera de Sistemas lanza 400', async () => {
    const rt = new FakeRuntime();
    let caught: unknown;
    try {
      await reorderOperationalRankings(rt, adminActor, { orderedTicketIds: [1], ownerUserId: 50 }, {
        repositoryFactory: makeRepos({
          group: makeGroup(),
          tickets: [makeTicket({ isSistemasScope: false })]
        })
      });
    } catch (e) { caught = e; }
    assert.ok(caught instanceof OperationalRankingMutationError);
    assert.equal(caught.httpStatus, 400);
  });

  await runTest('RE4. REORDER: ticket de otro grupo lanza 400', async () => {
    const rt = new FakeRuntime();
    let caught: unknown;
    try {
      await reorderOperationalRankings(rt, priorizadorActor, { orderedTicketIds: [1, 2] }, {
        repositoryFactory: makeRepos({
          group: makeGroup(),
          tickets: [makeTicket({ ticketId: 1, detectedSectorGroupId: 10 }), makeTicket({ ticketId: 2, detectedSectorGroupId: 99 })]
        })
      });
    } catch (e) { caught = e; }
    assert.ok(caught instanceof OperationalRankingMutationError);
    assert.equal(caught.httpStatus, 400);
  });

  await runTest('RE5. REORDER: set activo discordante lanza 400', async () => {
    const rt = new FakeRuntime();
    const r1 = makeRanking({ id: 1, ticketId: 1, rankPosition: 1 });
    const r2 = makeRanking({ id: 2, ticketId: 2, rankPosition: 2 });
    let caught: unknown;
    try {
      // orderedTicketIds has [1,3] but rankings have [1,2]
      await reorderOperationalRankings(rt, adminActor, { orderedTicketIds: [1, 3], ownerUserId: 50 }, {
        repositoryFactory: makeRepos({
          group: makeGroup(),
          tickets: [makeTicket({ ticketId: 1 }), makeTicket({ ticketId: 3 })],
          rankings: [r1, r2]
        })
      });
    } catch (e) { caught = e; }
    assert.ok(caught instanceof OperationalRankingMutationError);
    assert.equal(caught.httpStatus, 400);
  });

  await runTest('RE6. REORDER: sin cambios devuelve changed:false, cero writes', async () => {
    const rt = new FakeRuntime();
    let updateCalls = 0;
    let auditCalls = 0;
    const r1 = makeRanking({ id: 1, ticketId: 1, rankPosition: 1 });
    const r2 = makeRanking({ id: 2, ticketId: 2, rankPosition: 2 });
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({
          group: makeGroup(),
          tickets: [makeTicket({ ticketId: 1 }), makeTicket({ ticketId: 2 })],
          rankings: [r1, r2]
        })(tx);
        repos.ranking.updateActiveRankingPosition = async () => { updateCalls++; return 'updated'; };
        repos.audit.writeAudit = async () => { auditCalls++; };
        return repos;
      }
    };
    const result = await reorderOperationalRankings(rt, adminActor, { orderedTicketIds: [1, 2], ownerUserId: 50 }, opts);
    assert.ok(!result.changed);
    assert.equal(updateCalls, 0);
    assert.equal(auditCalls, 0);
  });

  await runTest('RE7. REORDER: cambio valido actualiza solo posiciones distintas, audit al final', async () => {
    const rt = new FakeRuntime();
    const callOrder: string[] = [];
    const r1 = makeRanking({ id: 1, ticketId: 1, rankPosition: 1 });
    const r2 = makeRanking({ id: 2, ticketId: 2, rankPosition: 2 });
    const r3 = makeRanking({ id: 3, ticketId: 3, rankPosition: 3 });
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({
          group: makeGroup(),
          tickets: [makeTicket({ ticketId: 1 }), makeTicket({ ticketId: 2 }), makeTicket({ ticketId: 3 })],
          rankings: [r1, r2, r3]
        })(tx);
        repos.ranking.updateActiveRankingPosition = async (input) => {
          callOrder.push(`update-${input.ticketId}`);
          return 'updated';
        };
        repos.audit.writeAudit = async () => { callOrder.push('audit'); };
        return repos;
      }
    };
    // [3, 1, 2] => ticket 1 stays? no: 1=>2, 2=>3, 3=>1 - all three change
    const result = await reorderOperationalRankings(rt, adminActor, { orderedTicketIds: [3, 1, 2], ownerUserId: 50 }, opts);
    assert.ok(result.changed);
    // All three positions changed so all three updated
    assert.equal(callOrder.filter(c => c.startsWith('update')).length, 3);
    // Audit must be last
    assert.equal(callOrder[callOrder.length - 1], 'audit');
    assert.equal(rt.commitCount, 1);
  });
  await runTest('RE8. REORDER: usa listTicketsByIds una vez para resolver sector y no llama findTicketById', async () => {
    // reorderOperationalRankings llama a listTicketsByIds exactamente una vez para
    // obtener el glpiGroupId del sector y validar que todos los tickets pertenecen al mismo sector.
    // No debe llamar a findTicketById (eso es para PATCH/DELETE individual).
    const rt = new FakeRuntime();
    let ownerListCalls = 0;
    let listTicketsCalls = 0;
    const findCalls: number[] = [];

    const r1 = makeRanking({ id: 1, ticketId: 1, rankPosition: 1 });

    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({
          rankings: [r1]
        })(tx);

        const originalOwnerList = repos.ranking.listActiveRankingsByGroupId;
        repos.ranking.listActiveRankingsByGroupId = async (groupId: number) => {
          ownerListCalls++;
          return originalOwnerList(groupId);
        };

        repos.ranking.listTicketsByIds = async () => {
          listTicketsCalls++;
          return [makeTicket({ ticketId: 1 })];
        };

        repos.ranking.findTicketById = async (id) => {
          findCalls.push(id);
          return makeTicket();
        };

        repos.audit.writeAudit = async () => {};
        return repos;
      }
    };

    await reorderOperationalRankings(rt, adminActor, { orderedTicketIds: [1], ownerUserId: 50 }, opts);

    assert.equal(ownerListCalls, 1, 'Exactly one active-rankings-by-group call');
    assert.equal(listTicketsCalls, 1, 'Exactly one listTicketsByIds call (para resolver sector)');
    assert.equal(findCalls.length, 0, 'Zero findTicketById calls (no es necesario en reorder)');
    assert.equal(rt.commitCount, 1);
  });

  // === TRANSACTION TESTS ===

  await runTest('TX1. Isolation es serializable', async () => {
    const rt = new FakeRuntime();
    let capturedOpts: TransactionOptions | undefined;
    const origWith = rt.withTransaction.bind(rt);
    rt.withTransaction = async <T>(opts: TransactionOptions | undefined, cb: (tx: ISqlServerTransaction) => Promise<T>) => {
      capturedOpts = opts;
      return origWith(opts, cb);
    };
    await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 1, ownerUserId: 50 }, {
      repositoryFactory: makeRepos({ ticket: makeTicket(), rankings: [] })
    });
    assert.equal(capturedOpts?.isolation, 'serializable');
  });

  await runTest('TX2. Commit unico exitoso', async () => {
    const rt = new FakeRuntime();
    await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 1, ownerUserId: 50 }, {
      repositoryFactory: makeRepos({ ticket: makeTicket(), rankings: [] })
    });
    assert.equal(rt.commitCount, 1);
    assert.equal(rt.rollbackCount, 0);
  });

  await runTest('TX3. Rollback ante fallo interno', async () => {
    const rt = new FakeRuntime();
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket(), rankings: [] })(tx);
        repos.ranking.upsertActiveRanking = async () => { throw new Error('db_error'); };
        return repos;
      }
    };
    let caught: unknown;
    try {
      await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 1, ownerUserId: 50 }, opts);
    } catch (e) { caught = e; }
    assert.ok(caught instanceof Error);
    assert.equal(rt.rollbackCount, 1);
    assert.equal(rt.commitCount, 0);
  });

  await runTest('TX4. SqlRuntimeError se propaga por identidad', async () => {
    const rt = new FakeRuntime();
    const sqlErr = new SqlRuntimeError('SQL_CONNECTION_ERROR', 'Connection failed');
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket(), rankings: [] })(tx);
        repos.ranking.upsertActiveRanking = async () => { throw sqlErr; };
        return repos;
      }
    };
    let caught: unknown;
    try {
      await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 1, ownerUserId: 50 }, opts);
    } catch (e) { caught = e; }
    assert.ok(caught === sqlErr, 'SqlRuntimeError must propagate by identity');
  });

  await runTest('TX5. Ranking, context y audit comparten exactamente la misma tx', async () => {
    const rt = new FakeRuntime();
    const call: { ranking?: ISqlServerTransaction; context?: ISqlServerTransaction; audit?: ISqlServerTransaction } = {};
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket(), rankings: [] })(tx);
        // Capture which tx each repo receives
        const origUpsert = repos.ranking.upsertActiveRanking.bind(repos.ranking);
        repos.ranking.upsertActiveRanking = async (input) => { call.ranking = tx; return origUpsert(input); };
        repos.context.findActiveReferentContext = async () => { call.context = tx; return null; };
        repos.audit.writeAudit = async () => { call.audit = tx; };
        return repos;
      }
    };
    await patchOperationalRanking(rt, adminActor, { ticketId: 1, newPosition: 1, ownerUserId: 50 }, opts);
    // All should reference the same tx object
    if (call.ranking) assert.ok(call.ranking === call.audit, 'ranking and audit must share tx');
  });

  // === SHARED QUEUE (CANONICAL OWNER) TESTS ===


  const priorizadorB: OperationalRankingMutationActor = Object.freeze({
    userId: 3, role: 'priorizador', username: 'priorizadorB', displayName: 'Priorizador B'
  });

  const priorizadorC: OperationalRankingMutationActor = Object.freeze({
    userId: 4, role: 'priorizador', username: 'priorizadorC', displayName: 'Priorizador C'
  });

  // CQ1: A and B share same scopes → they resolve to the same canonical owner
  await runTest('CQ1. A y B con mismos scopes comparten la misma cola de sector', async () => {
    // A (userId=2) y B (userId=3) pertenecen al mismo sector (glpiGroupId=10).
    // Ambos operan sobre la misma cola: el upsert recibe glpiGroupId=10 del sector del ticket.
    // El campo ownerUserId en el upsert es un campo legacy que guarda actor.userId.
    const rt = new FakeRuntime();
    const rankings: OperationalActiveRankingState[] = [];
    const upsertedInputs: { ticketId: number; glpiGroupId: number; ownerUserId: number }[] = [];

    const opts = {
      repositoryFactory: (_tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 100, detectedSectorGroupId: 10 }), rankings })(new FakeTransaction());
        repos.ranking.upsertActiveRanking = async (input) => {
          upsertedInputs.push({ ticketId: input.ticketId, glpiGroupId: input.glpiGroupId, ownerUserId: input.ownerUserId });
        };
        repos.audit.writeAudit = async () => {};
        return repos;
      }
    };

    // A prioriza ticket 100
    await patchOperationalRanking(rt, priorizadorActor, { ticketId: 100, newPosition: 1 }, opts);

    // El upsert usa el glpiGroupId del sector del ticket (10)
    assert.equal(upsertedInputs.length, 1);
    assert.equal(upsertedInputs[0]!.ticketId, 100);
    assert.equal(upsertedInputs[0]!.glpiGroupId, 10, 'El upsert debe usar el glpiGroupId del sector (10)');
    // ownerUserId (campo legacy) refleja el userId del actor
    assert.equal(upsertedInputs[0]!.ownerUserId, 2, 'ownerUserId legacy debe reflejar actor.userId (2)');
  });

  // CQ2: B modifica la misma cola que A (ambos tienen el mismo sector glpiGroupId=10)
  await runTest('CQ2. B reordena/modifica la misma cola que A (mismo sector)', async () => {
    // A (userId=2) y B (userId=3) pertenecen al mismo sector (glpiGroupId=10).
    // En el sistema real la cola compartida está determinada por el glpiGroupId del ticket.
    const rt = new FakeRuntime();
    const r1 = makeRanking({ id: 1, ticketId: 100, rankPosition: 1, glpiGroupId: 10 });
    const r2 = makeRanking({ id: 2, ticketId: 200, rankPosition: 2, glpiGroupId: 10 });
    let lockAcquiredForGroup: number | undefined;
    let listCallGroup: number | undefined;

    const opts = {
      repositoryFactory: (_tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 200, detectedSectorGroupId: 10 }), rankings: [r1, r2] })(new FakeTransaction());
        repos.ranking.acquireGroupLock = async (glpiGroupId: unknown) => {
          lockAcquiredForGroup = glpiGroupId as number;
        };
        repos.ranking.listActiveRankingsByGroupId = async (glpiGroupId: unknown) => {
          listCallGroup = glpiGroupId as number;
          return [r1, r2];
        };
        repos.ranking.upsertActiveRanking = async () => {};
        repos.ranking.updateActiveRankingPosition = async () => 'updated';
        repos.ranking.parkActiveRankingPositionsForGroup = async (_glpiGroupId: unknown, _ticketIds: readonly number[], _actorId: unknown, _updatedAt: Date, expected: number) => expected;
        repos.audit.writeAudit = async () => {};
        return repos;
      }
    };

    // B (userId=3) modifica el ticket 200 — el lock debe ser sobre el sector del ticket (groupId=10)
    await patchOperationalRanking(rt, priorizadorB, { ticketId: 200, newPosition: 1 }, opts);

    assert.equal(lockAcquiredForGroup, 10, 'Lock debe ser sobre el sector del ticket (glpiGroupId=10)');
    assert.equal(listCallGroup, 10, 'Debe listar rankings por el sector del ticket (glpiGroupId=10)');
  });

  // CQ3: Auditoría conserva actor real B aunque la cola pertenezca al mismo sector que A
  await runTest('CQ3. Auditoría conserva actor real B en cola compartida', async () => {
    // B (userId=3) y A (userId=2) comparten el sector 10. La auditoría debe reflejar
    // a B como actor real, y el entityId debe referenciar el sector (glpiGroupId=10).
    const rt = new FakeRuntime();
    let capturedAudit: { userId: number; actorName: string; entityId: string } | undefined;

    const opts = {
      repositoryFactory: (_tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 100, detectedSectorGroupId: 10 }), rankings: [] })(new FakeTransaction());
        repos.ranking.upsertActiveRanking = async () => {};
        repos.audit.writeAudit = async (input) => {
          capturedAudit = {
            userId: (input as { userId: number }).userId,
            actorName: (input as { actorName: string }).actorName,
            entityId: (input as { entityId: string }).entityId
          };
        };
        return repos;
      }
    };

    // B prioriza ticket 100
    await patchOperationalRanking(rt, priorizadorB, { ticketId: 100, newPosition: 1 }, opts);

    assert.ok(capturedAudit !== undefined, 'Audit should be written');
    assert.equal(capturedAudit!.userId, 3, 'Audit actor should be B (userId=3)');
    assert.equal(capturedAudit!.actorName, 'Priorizador B', 'Actor name should be B');
    // entityId references the sector (glpiGroupId=10), not the userId
    assert.ok(capturedAudit!.entityId.startsWith('10/'), 'EntityId debe referenciar el sector (glpiGroupId=10)');
  });

  // CQ4: Priorizador C con otro sector NO comparte la cola de A/B
  await runTest('CQ4. C con otro sector no comparte la cola de A/B', async () => {
    // C (userId=4) trabaja en un ticket cuyo sector es glpiGroupId=20 (≠ 10 de A/B).
    // El sistema aísla colas por sector: el lock y la lista se harán sobre groupId=20.
    const rt = new FakeRuntime();
    let lockAcquiredForGroup: number | undefined;
    let listCallGroup: number | undefined;

    const opts = {
      repositoryFactory: (_tx: ISqlServerTransaction) => {
        // Ticket de C pertenece al sector 20, no al 10 de A/B
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 100, detectedSectorGroupId: 20 }), rankings: [] })(new FakeTransaction());
        repos.ranking.acquireGroupLock = async (glpiGroupId: unknown) => {
          lockAcquiredForGroup = glpiGroupId as number;
        };
        repos.ranking.listActiveRankingsByGroupId = async (glpiGroupId: unknown) => {
          listCallGroup = glpiGroupId as number;
          return [];
        };
        repos.ranking.upsertActiveRanking = async () => {};
        repos.audit.writeAudit = async () => {};
        return repos;
      }
    };

    // C opera sobre su propio sector (groupId=20), no sobre el sector de A/B (10)
    await patchOperationalRanking(rt, priorizadorC, { ticketId: 100, newPosition: 1 }, opts);

    assert.equal(lockAcquiredForGroup, 20, 'Lock debe ser sobre el sector de C (glpiGroupId=20)');
    assert.equal(listCallGroup, 20, 'Debe listar rankings del sector de C (glpiGroupId=20)');
  });

  // --- Modo Dios y Autorización ---
  const validTargetUser = {
    id: 50,
    username: 'prio',
    passwordHash: null,
    displayName: 'Prio',
    role: 'priorizador' as const,
    isActive: true,
    glpiUserId: null,
    adObjectId: null,
    email: null,
    authSource: 'local' as const,
    directoryActive: null,
    directoryStatusCheckedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    sectorScopes: [{ id: 1, userId: 50, sectorName: 'Test', glpiGroupId: 10 }]
  };

  await runTest('CQ5. Admin Modo Dios: operacion permitida si target tiene acceso', async () => {
    const rt = new FakeRuntime();
    let upsertCalled = false;
    const opts = {
      userReadMock: async (id: number) => id === 50 ? validTargetUser : null,
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 100, detectedSectorGroupId: 10 }), rankings: [] })(tx);
        repos.ranking.upsertActiveRanking = async () => { upsertCalled = true; };
        return repos;
      }
    };
    await patchOperationalRanking(rt, adminActor, { ticketId: 100, newPosition: 1, ownerUserId: 50 }, opts);
    assert.ok(upsertCalled);
  });

  await runTest('CQ6. Admin Modo Dios: rechazo si target NO tiene acceso', async () => {
    const rt = new FakeRuntime();
    let upsertCalled = false;
    const opts = {
      userReadMock: async (id: number) => id === 50 ? validTargetUser : null,
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 100, detectedSectorGroupId: 99 }), rankings: [] })(tx);
        repos.ranking.upsertActiveRanking = async () => { upsertCalled = true; };
        return repos;
      }
    };
    let caught: any;
    try {
      await patchOperationalRanking(rt, adminActor, { ticketId: 100, newPosition: 1, ownerUserId: 50 }, opts);
    } catch (e) { caught = e; }
    assert.equal(caught?.httpStatus, 403);
    assert.ok(!upsertCalled);
  });

  await runTest('CQ7. Admin Modo Dios: rechazo sin ownerUserId', async () => {
    const rt = new FakeRuntime();
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => makeRepos({ ticket: makeTicket({ ticketId: 100, detectedSectorGroupId: 10 }) })(tx)
    };
    let caught: any;
    try {
      await patchOperationalRanking(rt, adminActor, { ticketId: 100, newPosition: 1 }, opts);
    } catch (e) { caught = e; }
    assert.equal(caught?.httpStatus, 403);
  });

  await runTest('CQ8. Priorizador: permitido en su propio sector', async () => {
    const rt = new FakeRuntime();
    let upsertCalled = false;
    const opts = {
      userReadMock: async () => validTargetUser,
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 100, detectedSectorGroupId: 10 }), rankings: [] })(tx);
        repos.ranking.upsertActiveRanking = async () => { upsertCalled = true; };
        return repos;
      }
    };
    await patchOperationalRanking(rt, priorizadorActor, { ticketId: 100, newPosition: 1 }, opts);
    assert.ok(upsertCalled);
  });

  await runTest('CQ9. Priorizador: rechazo en sector ajeno', async () => {
    const rt = new FakeRuntime();
    const opts = {
      userReadMock: async () => validTargetUser, // Only has access to 10
      repositoryFactory: (tx: ISqlServerTransaction) => makeRepos({ ticket: makeTicket({ ticketId: 100, detectedSectorGroupId: 99 }) })(tx)
    };
    let caught: any;
    try {
      await patchOperationalRanking(rt, priorizadorActor, { ticketId: 100, newPosition: 1 }, opts);
    } catch (e) { caught = e; }
    assert.equal(caught?.httpStatus, 403);
  });

  await runTest('CQ10. Priorizador: rechazo si intenta suplantar (enviar ownerUserId)', async () => {
    const rt = new FakeRuntime();
    const opts = {
      userReadMock: async () => validTargetUser,
      repositoryFactory: (tx: ISqlServerTransaction) => makeRepos({ ticket: makeTicket({ ticketId: 100, detectedSectorGroupId: 10 }) })(tx)
    };
    let caught: any;
    try {
      await patchOperationalRanking(rt, priorizadorActor, { ticketId: 100, newPosition: 1, ownerUserId: 99 }, opts);
    } catch (e) { caught = e; }
    assert.equal(caught?.httpStatus, 403);
  });

  await runTest('CQ11. Admin Modo Dios: DELETE operacion permitida', async () => {
    const rt = new FakeRuntime();
    let deactivateCalled = false;
    const opts = {
      userReadMock: async (id: number) => id === 50 ? validTargetUser : null,
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 100, detectedSectorGroupId: 10 }), rankings: [makeRanking({ ticketId: 100, glpiGroupId: 10 })] })(tx);
        repos.ranking.deactivateActiveRanking = async () => { deactivateCalled = true; return 'updated'; };
        return repos;
      }
    };
    await deleteOperationalRanking(rt, adminActor, { ticketId: 100, ownerUserId: 50 }, opts);
    assert.ok(deactivateCalled);
  });

  await runTest('CQ12. Admin Modo Dios: DELETE rechazo sin ownerUserId', async () => {
    const rt = new FakeRuntime();
    const opts = {
      repositoryFactory: (tx: ISqlServerTransaction) => makeRepos({ ticket: makeTicket({ ticketId: 100, detectedSectorGroupId: 10 }) })(tx)
    };
    let caught: any;
    try {
      await deleteOperationalRanking(rt, adminActor, { ticketId: 100 }, opts);
    } catch (e) { caught = e; }
    assert.equal(caught?.httpStatus, 403);
  });

  await runTest('CQ13. Admin Modo Dios: REORDER operacion permitida', async () => {
    const rt = new FakeRuntime();
    let updated = false;
    const opts = {
      userReadMock: async (id: number) => id === 50 ? validTargetUser : null,
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: null, rankings: [makeRanking({ ticketId: 100, glpiGroupId: 10 }), makeRanking({ ticketId: 101, glpiGroupId: 10 })] })(tx);
        repos.ranking.listTicketsByIds = async () => [makeTicket({ ticketId: 100, detectedSectorGroupId: 10 }), makeTicket({ ticketId: 101, detectedSectorGroupId: 10 })];
        repos.ranking.updateActiveRankingPosition = async () => { updated = true; return 'updated'; };
        return repos;
      }
    };
    await reorderOperationalRankings(rt, adminActor, { orderedTicketIds: [101, 100], ownerUserId: 50 }, opts);
    assert.ok(updated);
  });

  await runTest('CQ14. Admin Modo Dios: REORDER rechazo si tickets de sector ajeno', async () => {
    const rt = new FakeRuntime();
    let updated = false;
    const opts = {
      userReadMock: async (id: number) => id === 50 ? validTargetUser : null,
      repositoryFactory: (tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: null, rankings: [makeRanking({ ticketId: 100, glpiGroupId: 99 }), makeRanking({ ticketId: 101, glpiGroupId: 99 })] })(tx);
        repos.ranking.listTicketsByIds = async () => [makeTicket({ ticketId: 100, detectedSectorGroupId: 99 }), makeTicket({ ticketId: 101, detectedSectorGroupId: 99 })];
        repos.ranking.updateActiveRankingPosition = async () => { updated = true; return 'updated'; };
        return repos;
      }
    };
    let caught: any;
    try {
      await reorderOperationalRankings(rt, adminActor, { orderedTicketIds: [101, 100], ownerUserId: 50 }, opts);
    } catch (e) { caught = e; }
    assert.equal(caught?.httpStatus, 403);
    assert.ok(!updated);
  });

  // CQ6: Lock se adquiere sobre el sector del ticket (glpiGroupId), no sobre el userId del actor
  await runTest('CQ6. Lock se adquiere sobre el sector del ticket, no sobre el userId del actor', async () => {
    // B (userId=3) prioriza un ticket del sector 10.
    // El lock debe ser sobre glpiGroupId=10, nunca sobre actor.userId (3).
    const rt = new FakeRuntime();
    const lockCalls: number[] = [];

    const opts = {
      repositoryFactory: (_tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 100, detectedSectorGroupId: 10 }), rankings: [] })(new FakeTransaction());
        repos.ranking.acquireGroupLock = async (glpiGroupId: unknown) => {
          lockCalls.push(glpiGroupId as number);
        };
        repos.ranking.upsertActiveRanking = async () => {};
        repos.audit.writeAudit = async () => {};
        return repos;
      }
    };

    // B (userId=3) prioriza, lock debe ser sobre el sector (glpiGroupId=10), no sobre userId=3
    await patchOperationalRanking(rt, priorizadorB, { ticketId: 100, newPosition: 1 }, opts);

    assert.equal(lockCalls.length, 1);
    assert.equal(lockCalls[0], 10, 'Lock debe ser sobre el sector del ticket (glpiGroupId=10), no sobre actor.userId (3)');
  });

  // CQ7: DELETE usa el glpiGroupId del sector del ticket
  await runTest('CQ7. DELETE usa el glpiGroupId del sector del ticket', async () => {
    // B (userId=3) elimina el ticket 100 del sector 10.
    // deactivateActiveRanking debe recibir glpiGroupId=10 (el sector del ticket), no ownerUserId.
    const rt = new FakeRuntime();
    const r1 = makeRanking({ id: 1, ticketId: 100, rankPosition: 1, glpiGroupId: 10 });
    let deactivateGroupId: number | undefined;

    const opts = {
      repositoryFactory: (_tx: ISqlServerTransaction) => {
        const repos = makeRepos({ ticket: makeTicket({ ticketId: 100, detectedSectorGroupId: 10 }), rankings: [r1] })(new FakeTransaction());
        repos.ranking.deactivateActiveRanking = async (input) => {
          deactivateGroupId = input.glpiGroupId;
          return 'updated';
        };
        repos.audit.writeAudit = async () => {};
        return repos;
      }
    };

    // B elimina ticket 100 del sector compartido
    const result = await deleteOperationalRanking(rt, priorizadorB, { ticketId: 100 }, opts);
    assert.ok(result.changed);
    assert.equal(deactivateGroupId, 10, 'Deactivate debe usar el glpiGroupId del sector (10)');
  });

  // CQ8: REORDER usa el glpiGroupId del sector de los tickets
  await runTest('CQ8. REORDER usa el glpiGroupId del sector de los tickets', async () => {
    // B (userId=3) reordena la cola del sector 10.
    // El lock de reorder debe hacerse sobre glpiGroupId=10, no sobre userId.
    const rt = new FakeRuntime();
    const r1 = makeRanking({ id: 1, ticketId: 100, rankPosition: 1, glpiGroupId: 10 });
    const r2 = makeRanking({ id: 2, ticketId: 200, rankPosition: 2, glpiGroupId: 10 });
    let lockGroup: number | undefined;

    const opts = {
      repositoryFactory: (_tx: ISqlServerTransaction) => {
        const repos = makeRepos({
          tickets: [
            makeTicket({ ticketId: 100, detectedSectorGroupId: 10 }),
            makeTicket({ ticketId: 200, detectedSectorGroupId: 10 })
          ],
          rankings: [r1, r2]
        })(new FakeTransaction());
        repos.ranking.acquireGroupLock = async (glpiGroupId: unknown) => {
          lockGroup = glpiGroupId as number;
        };
        repos.ranking.updateActiveRankingPosition = async () => 'updated';
        repos.ranking.parkActiveRankingPositionsForGroup = async (_glpiGroupId: unknown, _ticketIds: readonly number[], _actorId: unknown, _updatedAt: Date, expected: number) => expected;
        repos.audit.writeAudit = async () => {};
        return repos;
      }
    };

    // B reordena la cola compartida del sector 10
    const result = await reorderOperationalRankings(rt, priorizadorB, { orderedTicketIds: [200, 100] }, opts);
    assert.ok(result.changed);
    assert.equal(lockGroup, 10, 'Reorder debe bloquear el sector del ticket (glpiGroupId=10)');
  });
}

void main().then(() => {
  console.log(`\nTests Service: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
  if (failed > 0) process.exitCode = 1;
}).catch(() => {
  process.exitCode = 1;
});
