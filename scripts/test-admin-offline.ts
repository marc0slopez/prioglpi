import assert from 'node:assert/strict';
import { SqlServerOperationalAuditReadRepository } from '../lib/db/operational/sqlserver-operational-audit-read-repository';
import { SqlServerOperationalUserReadRepository } from '../lib/db/operational/sqlserver-operational-user-read-repository';
import { SqlServerOperationalUserWriteRepository } from '../lib/db/operational/sqlserver-operational-user-write-repository';
import type { ISqlServerSession, ISqlServerTransaction, SqlParameter, SqlRow } from '../lib/db/sqlserver-runtime-contract';

class CustomFakeSession implements ISqlServerSession {
  public executeCalls = 0;
  constructor(private readonly handler: (sql: string, params?: SqlParameter[]) => SqlRow[]) {}

  async query(sql: string, parameters?: SqlParameter[]): Promise<SqlRow[]> {
    return this.handler(sql, parameters);
  }

  async execute(sql: string, parameters?: SqlParameter[]): Promise<number> {
    void sql;
    void parameters;
    this.executeCalls++;
    return 0;
  }
}

class FakeTx implements ISqlServerTransaction {
  async query(sql: string, parameters?: SqlParameter[]): Promise<SqlRow[]> {
    void sql;
    void parameters;
    return [];
  }
  async execute(sql: string, parameters?: SqlParameter[]): Promise<number> {
    void sql;
    void parameters;
    return 1;
  }
}

async function run() {
  console.log('Testing Admin Offline...');

  const defaultSession = new CustomFakeSession((sql) => {
    if (sql.includes('glpi_user_cache')) return [{ '1': 1 }];
    if (sql.includes('glpi_group_cache')) return [{ group_id: 1, name: 'Sistemas' }];
    if (sql.includes('glpi_ticket_cache')) return [{ ticket_id: 1, title: 'Ticket 1' }];
    if (sql.includes('COUNT(*)')) return [{ cnt: 42 }];
    if (sql.includes('TOP (1) a.[created_at], a.[id]')) return [{ created_at: new Date(), id: 10 }];
    if (sql.includes('audit_log')) {
      return [{
        id: 1,
        user_id: 1,
        action: 'user_create',
        entity_type: 'user',
        entity_id: '2',
        before_json: null,
        after_json: '{"role":"admin"}',
        created_at: new Date(),
        actor_name: 'Admin',
        actor_username: 'admin',
        user_display_name: 'Admin',
        user_username: 'admin'
      }];
    }
    if (sql.includes('app_user')) {
      return [{
        id: 1,
        username: 'admin',
        password_hash: 'hash',
        display_name: 'Admin',
        role: 'admin',
        is_active: 1,
        glpi_user_id: null,
        ad_object_id: null,
        email: null,
        auth_source: 'local',
        directory_active: null,
        directory_status_checked_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        scope_id: null
      }];
    }
    return [];
  });

  const tx = new FakeTx();

  const auditRepo = new SqlServerOperationalAuditReadRepository(defaultSession);
  const userReadRepo = new SqlServerOperationalUserReadRepository(defaultSession);
  const userWriteRepo = new SqlServerOperationalUserWriteRepository(tx);

  console.log('1. userReadRepo.listAllUsersWithScopes');
  const users = await userReadRepo.listAllUsersWithScopes();
  assert.equal(users.length, 1);
  assert.equal(defaultSession.executeCalls, 0);

  console.log('2. userReadRepo.checkGlpiUserExists');
  const userExists = await userReadRepo.checkGlpiUserExists(123);
  assert.equal(userExists, true);
  assert.equal(defaultSession.executeCalls, 0);

  console.log('3. userWriteRepo.replaceReferentAssignments');
  await userWriteRepo.replaceReferentAssignments(1, [1, 2]);

  console.log('4. auditRepo.countAudits');
  const cnt = await auditRepo.countAudits({ user: 'admin', from: '2023-01-01', to: '2023-12-31' });
  assert.equal(cnt, 42);
  assert.equal(defaultSession.executeCalls, 0);

  console.log('5. auditRepo.searchAuditsHumanized');
  const logs = await auditRepo.searchAuditsHumanized({ ticketId: '123' }, 1, 10);
  assert.equal(logs.length, 1);
  assert.equal(defaultSession.executeCalls, 0);

  console.log('6. Testing string decimal canonical IDs and Counts in Audit Repo');
  const stringSession = new CustomFakeSession((sql) => {
    if (sql.includes('COUNT(*)')) return [{ cnt: '100' }];
    if (sql.includes('TOP (1) a.[created_at], a.[id]')) return [{ created_at: new Date(), id: '99' }];
    if (sql.includes('audit_log')) {
      return [{
        id: '15',
        user_id: '42',
        action: 'user_create',
        entity_type: 'user',
        entity_id: '2',
        before_json: null,
        after_json: '{"role":"admin"}',
        created_at: new Date(),
        actor_name: 'Admin',
        actor_username: 'admin',
        user_display_name: 'Admin',
        user_username: 'admin'
      }];
    }
    return [];
  });
  const stringAuditRepo = new SqlServerOperationalAuditReadRepository(stringSession);
  const stringCount = await stringAuditRepo.countAudits({});
  assert.equal(stringCount, 100);

  const maxLog = await stringAuditRepo.getMaxLog({});
  assert.equal(maxLog?.id, 99);

  const stringLogs = await stringAuditRepo.searchAuditsHumanized({}, 1, 10);
  assert.equal(stringLogs[0].id, 15);
  assert.equal(stringLogs[0].userId, 42);

  console.log('7. Testing null user_id in Audit Repo');
  const nullUserSession = new CustomFakeSession((sql) => {
    if (sql.includes('audit_log')) {
      return [{
        id: 1,
        user_id: null,
        action: 'auth_unavailable',
        entity_type: 'authentication',
        entity_id: 'auth',
        before_json: null,
        after_json: null,
        created_at: new Date(),
        actor_name: null,
        actor_username: null,
        user_display_name: null,
        user_username: null
      }];
    }
    return [];
  });
  const nullUserAuditRepo = new SqlServerOperationalAuditReadRepository(nullUserSession);
  const nullUserLogs = await nullUserAuditRepo.searchAuditsHumanized({}, 1, 10);
  assert.equal(nullUserLogs[0].userId, null);

  console.log('8. Testing invalid ID formats rejection');
  const invalidIdFormats = ['0', '-1', '123abc', '1.5', '9999999999999999', ' 12 ', '+1', '01'];
  for (const badId of invalidIdFormats) {
    const badSession = new CustomFakeSession((sql) => {
      if (sql.includes('audit_log')) {
        return [{
          id: badId,
          user_id: 1,
          action: 'user_create',
          entity_type: 'user',
          entity_id: '2',
          before_json: null,
          after_json: null,
          created_at: new Date(),
          actor_name: 'Admin',
          actor_username: 'admin',
          user_display_name: 'Admin',
          user_username: 'admin'
        }];
      }
      return [];
    });
    const badAuditRepo = new SqlServerOperationalAuditReadRepository(badSession);
    await assert.rejects(
      () => badAuditRepo.searchAuditsHumanized({}, 1, 10),
      (err: Error) => err.message.includes('ID numérico entero positivo inválido.')
    );
  }

  console.log('9. Testing invalid Count formats rejection');
  const invalidCountFormats = ['-1', '1.5', 'abc', '01', ' 5 '];
  for (const badCnt of invalidCountFormats) {
    const badSession = new CustomFakeSession((sql) => {
      if (sql.includes('COUNT(*)')) return [{ cnt: badCnt }];
      return [];
    });
    const badAuditRepo = new SqlServerOperationalAuditReadRepository(badSession);
    await assert.rejects(
      () => badAuditRepo.countAudits({}),
      (err: Error) => err.message.includes('COUNT o entero no negativo inválido.')
    );
  }

  console.log('Offline tests passed.');
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
