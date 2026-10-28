import assert from 'node:assert/strict';
import { resolveOperationalAuthSessionUser } from '../lib/db/operational/operational-auth-session';
import type { IOperationalUserReadRepository } from '../lib/db/operational/operational-user-read-repository';
import type { OperationalUserWithScopes, OperationalUser, OperationalUserSectorScope } from '../lib/db/operational/operational-user-types';
import type { JwtPayload } from '../lib/jwt-utils';
import { OperationalUserReadError } from '../lib/db/operational/operational-user-read-repository';

class FakeReadRepo implements IOperationalUserReadRepository {
  public userWithScopesResponses: (OperationalUserWithScopes | null)[] = [];
  public forceError: Error | null = null;

  async findById(_id: number): Promise<OperationalUser | null> { void _id; return null; }
  async findByUsername(_username: string): Promise<OperationalUser | null> { void _username; return null; }
  async findByGlpiUserId(_id: number): Promise<OperationalUser | null> { void _id; return null; }

  async findCandidatesByUsernameOrAdObjectId(_username: string, _adObjectId: string): Promise<readonly OperationalUser[]> {
    void _username; void _adObjectId; return [];
  }

  async findByIdWithScopes(id: number): Promise<OperationalUserWithScopes | null> {
    void id;
    if (this.forceError) throw this.forceError;
    const res = this.userWithScopesResponses.shift();
    return res !== undefined ? res : null;
  }

  async listActiveByRoles(_roles: unknown): Promise<readonly OperationalUser[]> { void _roles; return []; }
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

const fixedClock = new Date('2023-01-01T00:00:00Z');

function makePayload(overrides?: Partial<JwtPayload>): JwtPayload {
  return {
    userId: 100,
    username: 'testuser',
    role: 'referente',
    displayName: 'Test User',
    authSource: 'ad',
    ...overrides
  };
}

function makeOperationalUser(overrides?: Partial<OperationalUser>): OperationalUser {
  return {
    id: 100,
    username: 'testuser',
    adObjectId: '12345678-1234-1234-1234-123456789012',
    authSource: 'ad',
    passwordHash: null,
    role: 'referente',
    isActive: true,
    directoryActive: true,
    glpiUserId: null,
    displayName: 'Test User',
    email: 'old@example.com',
    directoryStatusCheckedAt: fixedClock,
    createdAt: fixedClock,
    updatedAt: fixedClock,
    ...overrides
  };
}

function makeOperationalUserWithScopes(user: OperationalUser, scopes: OperationalUserSectorScope[]): OperationalUserWithScopes {
  return { ...user, sectorScopes: scopes };
}

async function main() {
  await runTest('Usuario AD valido con scopes', async () => {
    const read = new FakeReadRepo();
    const user = makeOperationalUser();
    const scopes: OperationalUserSectorScope[] = [
      { id: 1, userId: 100, sectorName: 's1', glpiGroupId: 10 },
      { id: 2, userId: 100, sectorName: 's2', glpiGroupId: 20 }
    ];
    read.userWithScopesResponses.push(makeOperationalUserWithScopes(user, scopes));

    const res = await resolveOperationalAuthSessionUser(read, makePayload());
    assert.ok(res);
    assert.equal(res.userId, 100);
    assert.equal(res.username, 'testuser');
    assert.equal(res.role, 'referente');
    assert.equal(res.authSource, 'ad');
    assert.equal(res.sectors.length, 2);
    assert.equal(res.sectors[0], 's1');
    assert.equal(res.sectorGroupIds[0], 10);
  });

  await runTest('Usuario valido sin scopes', async () => {
    const read = new FakeReadRepo();
    read.userWithScopesResponses.push(makeOperationalUserWithScopes(makeOperationalUser(), []));
    const res = await resolveOperationalAuthSessionUser(read, makePayload());
    assert.ok(res);
    assert.equal(res.sectors.length, 0);
  });

  await runTest('Usuario inexistente', async () => {
    const read = new FakeReadRepo();
    read.userWithScopesResponses.push(null);
    const res = await resolveOperationalAuthSessionUser(read, makePayload());
    assert.equal(res, null);
  });

  await runTest('Usuario inactivo', async () => {
    const read = new FakeReadRepo();
    read.userWithScopesResponses.push(makeOperationalUserWithScopes(makeOperationalUser({ isActive: false }), []));
    const res = await resolveOperationalAuthSessionUser(read, makePayload());
    assert.equal(res, null);
  });

  await runTest('directoryActive false y null', async () => {
    const read1 = new FakeReadRepo();
    read1.userWithScopesResponses.push(makeOperationalUserWithScopes(makeOperationalUser({ directoryActive: false }), []));
    const res1 = await resolveOperationalAuthSessionUser(read1, makePayload());
    assert.equal(res1, null);

    const read2 = new FakeReadRepo();
    const u2 = makeOperationalUser();
    u2.directoryActive = null;
    read2.userWithScopesResponses.push(makeOperationalUserWithScopes(u2, []));
    const res2 = await resolveOperationalAuthSessionUser(read2, makePayload());
    assert.equal(res2, null);
  });

  await runTest('authSource local/system', async () => {
    for (const source of ['local', 'system'] as const) {
      const read = new FakeReadRepo();
      read.userWithScopesResponses.push(makeOperationalUserWithScopes(makeOperationalUser({ authSource: source }), []));
      const res = await resolveOperationalAuthSessionUser(read, makePayload());
      assert.equal(res, null);
    }
  });

  await runTest('passwordHash presente', async () => {
    const read = new FakeReadRepo();
    read.userWithScopesResponses.push(makeOperationalUserWithScopes(makeOperationalUser({ passwordHash: 'hash' }), []));
    const res = await resolveOperationalAuthSessionUser(read, makePayload());
    assert.equal(res, null);
  });

  await runTest('adObjectId null y vacio', async () => {
    const read1 = new FakeReadRepo();
    read1.userWithScopesResponses.push(makeOperationalUserWithScopes(makeOperationalUser({ adObjectId: null }), []));
    const res1 = await resolveOperationalAuthSessionUser(read1, makePayload());
    assert.equal(res1, null);

    const read2 = new FakeReadRepo();
    read2.userWithScopesResponses.push(makeOperationalUserWithScopes(makeOperationalUser({ adObjectId: '   ' }), []));
    const res2 = await resolveOperationalAuthSessionUser(read2, makePayload());
    assert.equal(res2, null);
  });

  await runTest('rol system', async () => {
    const read = new FakeReadRepo();
    read.userWithScopesResponses.push(makeOperationalUserWithScopes(makeOperationalUser({ role: 'system' }), []));
    const res = await resolveOperationalAuthSessionUser(read, makePayload({ role: 'system' }));
    assert.equal(res, null);
  });

  await runTest('mismatch de userId', async () => {
    const read = new FakeReadRepo();
    read.userWithScopesResponses.push(makeOperationalUserWithScopes(makeOperationalUser({ id: 100 }), []));
    const res = await resolveOperationalAuthSessionUser(read, makePayload({ userId: 999 }));
    assert.equal(res, null);
  });

  await runTest('mismatch de username', async () => {
    const read = new FakeReadRepo();
    read.userWithScopesResponses.push(makeOperationalUserWithScopes(makeOperationalUser({ username: 'user1' }), []));
    const res = await resolveOperationalAuthSessionUser(read, makePayload({ username: 'user2' }));
    assert.equal(res, null);
  });

  await runTest('mismatch de role', async () => {
    const read = new FakeReadRepo();
    read.userWithScopesResponses.push(makeOperationalUserWithScopes(makeOperationalUser({ role: 'admin' }), []));
    const res = await resolveOperationalAuthSessionUser(read, makePayload({ role: 'referente' }));
    assert.equal(res, null);
  });

  await runTest('payload authSource local', async () => {
    const read = new FakeReadRepo();
    read.userWithScopesResponses.push(makeOperationalUserWithScopes(makeOperationalUser(), []));
    const res = await resolveOperationalAuthSessionUser(read, makePayload({ authSource: 'local' }));
    assert.equal(res, null);
  });

  await runTest('filtrado de glpiGroupId null', async () => {
    const read = new FakeReadRepo();
    const user = makeOperationalUser();
    const scopes: OperationalUserSectorScope[] = [
      { id: 1, userId: 100, sectorName: 's1', glpiGroupId: null }
    ];
    read.userWithScopesResponses.push(makeOperationalUserWithScopes(user, scopes));

    const res = await resolveOperationalAuthSessionUser(read, makePayload());
    assert.ok(res);
    assert.equal(res.sectors.length, 0);
  });

  await runTest('rechazo de glpiGroupId cero, negativo, decimal o unsafe si llega desde un fake corrupto', async () => {
    const read = new FakeReadRepo();
    const user = makeOperationalUser();

    const scopes: OperationalUserSectorScope[] = [
      { id: 1, userId: 100, sectorName: 's1', glpiGroupId: 0 },
      { id: 2, userId: 100, sectorName: 's2', glpiGroupId: -5 },
      { id: 3, userId: 100, sectorName: 's3', glpiGroupId: 5.5 },
      { id: 4, userId: 100, sectorName: 's4', glpiGroupId: Number.MAX_SAFE_INTEGER + 1 },
      { id: 5, userId: 100, sectorName: 's5', glpiGroupId: NaN }
    ];

    read.userWithScopesResponses.push(makeOperationalUserWithScopes(user, scopes));
    const res = await resolveOperationalAuthSessionUser(read, makePayload());
    assert.ok(res);
    assert.equal(res.sectors.length, 0);
  });

  await runTest('propagacion exacta de OperationalUserReadError', async () => {
    const read = new FakeReadRepo();
    const forceErr = new OperationalUserReadError('corrupt_data', 'Db err');
    read.forceError = forceErr;

    let caught: unknown;
    try {
      await resolveOperationalAuthSessionUser(read, makePayload());
    } catch (err) {
      caught = err;
    }

    assert.equal(caught, forceErr);
  });

  await runTest('inmutabilidad del usuario y scopes originales', async () => {
    const read = new FakeReadRepo();
    const user = makeOperationalUser();
    const scopes: OperationalUserSectorScope[] = [
      { id: 1, userId: 100, sectorName: 's1', glpiGroupId: 10 }
    ];

    const userCopy = { ...user };
    const scopesCopy = [{ ...scopes[0] }];

    read.userWithScopesResponses.push(makeOperationalUserWithScopes(user, scopes));

    const res = await resolveOperationalAuthSessionUser(read, makePayload());

    assert.ok(res);
    assert.deepEqual(user, userCopy);
    assert.deepEqual(scopes, scopesCopy);
  });

  await runTest('Arquitectura: auth.ts carga Prisma de forma lazy sin import estatico y usa el factory SQL', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const authPath = path.join(process.cwd(), 'lib', 'auth.ts');
    const content = await fs.readFile(authPath, 'utf8');

    assert.equal(content.includes("import { prisma } from './prisma';"), false, 'Se encontro import estatico de prisma.');
    assert.equal(content.includes("await import('./prisma')"), true, 'Falta el lazy import de prisma.');
    assert.equal(content.includes("import { getSharedSqlServerRuntime } from './db/sqlserver-runtime-factory';"), true, 'Falta import correcto del factory de sqlserver.');
    assert.equal(content.includes("import { getSharedSqlServerRuntime } from './db/sqlserver-runtime';"), false, 'Existe el import incorrecto/legacy del runtime sqlserver.');
  });
}

void main().then(() => {
  console.log(`Tests Operational Auth Session: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
}).catch(() => {
  process.exitCode = 1;
});
