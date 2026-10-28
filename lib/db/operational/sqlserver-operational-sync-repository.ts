import { SqlServerOperationalAuditWriteRepository } from './sqlserver-operational-audit-write-repository';
import type { ISqlServerTransaction, ISqlServerRuntime, SqlParameter } from '../sqlserver-runtime-contract';
import { redactSecrets } from '../../secret-sanitizer';

function isSafeNonNegativeInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0 && val <= 2147483647;
}

function isSafePositiveInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val > 0 && val <= 2147483647;
}

function isValidDate(val: unknown): val is Date {
  return val instanceof Date && !isNaN(val.getTime());
}

export interface SyncRunSuccessData {
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly ticketsFetched: number;
  readonly sistemasCount: number;
  readonly tecnologiaCount: number;
  readonly unroutedCount: number;
  readonly activeCount: number;
  readonly historyCount: number;
  readonly usersCount: number;
  readonly groupsCount: number;
  readonly membershipsCount: number;
  readonly publicNotesCount: number;
  readonly privateNotesCount: number;
  readonly durationMs: number;
}

export class SqlServerOperationalSyncRepository {
  constructor(private readonly tx: ISqlServerTransaction) {}

  private parsePositiveInt(val: unknown): number {
    if (typeof val === 'number') {
      if (Number.isSafeInteger(val) && val >= 1 && val <= 2147483647) {
        return val;
      }
    } else if (typeof val === 'string') {
      if (/^[1-9]\d*$/.test(val)) {
        const num = Number(val);
        if (Number.isSafeInteger(num) && num >= 1 && num <= 2147483647) {
          return num;
        }
      }
    }
    throw new Error('corrupt_data');
  }

  async ensureSystemSyncUser(updatedAt: Date): Promise<{ readonly id: number; readonly username: string; readonly displayName: string }> {
    if (!isValidDate(updatedAt)) throw new Error('invalid_input: updatedAt must be a valid Date');
    const safeDate = new Date(updatedAt.getTime());

    const sqlBatch = `
      DECLARE @affected INT = 0;
      UPDATE [prioglpi].[app_user]
      SET role = 'system', is_active = 0, auth_source = 'system', password_hash = NULL,
          glpi_user_id = NULL, ad_object_id = NULL, email = NULL, directory_active = NULL,
          directory_status_checked_at = NULL, updated_at = @updatedAt
      WHERE username = 'system_sync';
      SET @affected = @@ROWCOUNT;

      IF @affected = 0
      BEGIN
        INSERT INTO [prioglpi].[app_user] (
          username, display_name, role, is_active, auth_source, updated_at
        )
        VALUES (
          'system_sync', 'Sistema de Sincronización', 'system', 0, 'system', @updatedAt
        );
        SET @affected = @@ROWCOUNT;
      END

      SELECT @affected AS affected;
    `;
    const batchRows = await this.tx.query(sqlBatch, [{ name: 'updatedAt', type: 'datetime2', scale: 3, nullable: false, value: safeDate }]);
    if (batchRows.length !== 1 || batchRows[0]['affected'] !== 1) {
      throw new Error('unexpected_result');
    }

    const sqlGet = `SELECT TOP (2) id, username, display_name FROM [prioglpi].[app_user] WHERE username = 'system_sync'`;
    const rows = await this.tx.query(sqlGet);
    if (rows.length !== 1) throw new Error('unexpected_result');

    const row = rows[0];
    const keys = Reflect.ownKeys(row);
    if (keys.length !== 3 || !keys.includes('id') || !keys.includes('username') || !keys.includes('display_name')) {
      throw new Error('corrupt_data: exact keys mismatch');
    }

    const id = this.parsePositiveInt(row['id']);
    const username = row['username'];
    const displayName = row['display_name'];

    if (typeof username !== 'string' || username !== 'system_sync') throw new Error('corrupt_data: username');
    if (typeof displayName !== 'string' || displayName.trim() === '') throw new Error('corrupt_data: display_name');

    await this.tx.execute(`DELETE FROM [prioglpi].[user_sector_scope] WHERE user_id = @id`, [{ name: 'id', type: 'int', nullable: false, value: id }]);
    await this.tx.execute(`DELETE FROM [prioglpi].[sector_referent_assignment] WHERE referent_user_id = @id`, [{ name: 'id', type: 'int', nullable: false, value: id }]);

    return Object.freeze({ id, username, displayName });
  }

  async detectStaleTickets(ticketIds: readonly number[]): Promise<readonly number[]> {
    if (!Array.isArray(ticketIds)) throw new Error('invalid_input');
    if (ticketIds.length > 5000000) throw new Error('invalid_input');

    const set = new Set<number>();
    for (const id of ticketIds) {
      if (!isSafePositiveInteger(id)) throw new Error('invalid_input');
      if (set.has(id)) throw new Error('invalid_input');
      set.add(id);
    }

    const jsonParam = JSON.stringify(Array.from(set));
    const sql = `
      SELECT t.ticket_id
      FROM [prioglpi].[glpi_ticket_cache] t
      WHERE NOT EXISTS (
        SELECT 1
        FROM OPENJSON(@json) WITH ([ticket_id] INT '$') j
        WHERE j.[ticket_id] = t.[ticket_id]
      )
      ORDER BY t.[ticket_id] ASC
    `;
    const rows = await this.tx.query(sql, [{ name: 'json', type: 'nvarchar', length: 'MAX', nullable: false, value: jsonParam }]);

    const result: number[] = [];
    let lastId = -1;
    for (const row of rows) {
      const keys = Reflect.ownKeys(row);
      if (keys.length !== 1 || !keys.includes('ticket_id')) throw new Error('corrupt_data');
      const val = this.parsePositiveInt(row['ticket_id']);
      if (val <= lastId) throw new Error('corrupt_data');
      lastId = val;
      result.push(val);
    }
    return Object.freeze(result);
  }

  async bulkLoadGroups(json: string, expectedCount: number): Promise<void> {
    if (!isSafeNonNegativeInteger(expectedCount)) throw new Error('invalid_input');
    await this.tx.execute(`DELETE FROM [prioglpi].[glpi_group_cache]`);
    const sql = `
      INSERT INTO [prioglpi].[glpi_group_cache] (group_id, name, complete_name, parent_group_id, flags, synced_at)
      SELECT group_id, name, complete_name, parent_group_id, flags, synced_at
      FROM OPENJSON(@json) WITH (
          group_id INT, name NVARCHAR(255), complete_name NVARCHAR(1000),
          parent_group_id INT, flags NVARCHAR(255), synced_at DATETIME2(3)
      );
    `;
    const affected = await this.tx.execute(sql, [{ name: 'json', type: 'nvarchar', length: 'MAX', nullable: false, value: json }]);
    if (affected !== expectedCount) throw new Error('unexpected_result');
  }

  async bulkLoadUsers(json: string, expectedCount: number): Promise<void> {
    if (!isSafeNonNegativeInteger(expectedCount)) throw new Error('invalid_input');
    await this.tx.execute(`DELETE FROM [prioglpi].[glpi_user_cache]`);
    const sql = `
      INSERT INTO [prioglpi].[glpi_user_cache] (glpi_user_id, username, nombres, display_name, default_group_id, is_active, synced_at)
      SELECT glpi_user_id, username, nombres, display_name, default_group_id, is_active, synced_at
      FROM OPENJSON(@json) WITH (
          glpi_user_id INT, username NVARCHAR(255), nombres NVARCHAR(255),
          display_name NVARCHAR(255), default_group_id INT, is_active BIT, synced_at DATETIME2(3)
      );
    `;
    const affected = await this.tx.execute(sql, [{ name: 'json', type: 'nvarchar', length: 'MAX', nullable: false, value: json }]);
    if (affected !== expectedCount) throw new Error('unexpected_result');
  }

  async bulkLoadGroupUsers(json: string, expectedCount: number): Promise<void> {
    if (!isSafeNonNegativeInteger(expectedCount)) throw new Error('invalid_input');
    await this.tx.execute(`DELETE FROM [prioglpi].[glpi_user_group_membership]`);
    const sql = `
      INSERT INTO [prioglpi].[glpi_user_group_membership] (user_id, group_id, is_manager, is_delegate, is_dynamic)
      SELECT user_id, group_id, is_manager, is_delegate, is_dynamic
      FROM OPENJSON(@json) WITH (
          user_id INT, group_id INT, is_manager BIT, is_delegate BIT, is_dynamic BIT
      );
    `;
    const affected = await this.tx.execute(sql, [{ name: 'json', type: 'nvarchar', length: 'MAX', nullable: false, value: json }]);
    if (affected !== expectedCount) throw new Error('unexpected_result');
  }

  async bulkLoadTicketGroupActors(json: string, expectedCount: number): Promise<void> {
    if (!isSafeNonNegativeInteger(expectedCount)) throw new Error('invalid_input');
    await this.tx.execute(`DELETE FROM [prioglpi].[glpi_ticket_group_actor]`);
    const sql = `
      INSERT INTO [prioglpi].[glpi_ticket_group_actor] (ticket_id, group_id, actor_type)
      SELECT ticket_id, group_id, actor_type
      FROM OPENJSON(@json) WITH (ticket_id INT, group_id INT, actor_type INT);
    `;
    const affected = await this.tx.execute(sql, [{ name: 'json', type: 'nvarchar', length: 'MAX', nullable: false, value: json }]);
    if (affected !== expectedCount) throw new Error('unexpected_result');
  }

  async bulkLoadTicketUserActors(json: string, expectedCount: number): Promise<void> {
    if (!isSafeNonNegativeInteger(expectedCount)) throw new Error('invalid_input');
    await this.tx.execute(`DELETE FROM [prioglpi].[glpi_ticket_user_actor]`);
    const sql = `
      INSERT INTO [prioglpi].[glpi_ticket_user_actor] (ticket_id, glpi_user_id, actor_type)
      SELECT ticket_id, glpi_user_id, actor_type
      FROM OPENJSON(@json) WITH (ticket_id INT, glpi_user_id INT, actor_type INT);
    `;
    const affected = await this.tx.execute(sql, [{ name: 'json', type: 'nvarchar', length: 'MAX', nullable: false, value: json }]);
    if (affected !== expectedCount) throw new Error('unexpected_result');
  }

  async bulkLoadFollowups(json: string, expectedCount: number): Promise<void> {
    if (!isSafeNonNegativeInteger(expectedCount)) throw new Error('invalid_input');
    await this.tx.execute(`DELETE FROM [prioglpi].[glpi_followup_cache]`);
    const sql = `
      INSERT INTO [prioglpi].[glpi_followup_cache] (followup_id, ticket_id, author, content_plain, is_private, created_at, updated_at)
      SELECT followup_id, ticket_id, author, content_plain, is_private, created_at, updated_at
      FROM OPENJSON(@json) WITH (
          followup_id INT, ticket_id INT, author NVARCHAR(255), content_plain NVARCHAR(MAX),
          is_private BIT, created_at DATETIME2(3), updated_at DATETIME2(3)
      );
    `;
    const affected = await this.tx.execute(sql, [{ name: 'json', type: 'nvarchar', length: 'MAX', nullable: false, value: json }]);
    if (affected !== expectedCount) throw new Error('unexpected_result');
  }

  async bulkLoadTasks(json: string, expectedCount: number): Promise<void> {
    if (!isSafeNonNegativeInteger(expectedCount)) throw new Error('invalid_input');
    await this.tx.execute(`DELETE FROM [prioglpi].[glpi_task_cache]`);
    const sql = `
      INSERT INTO [prioglpi].[glpi_task_cache] (task_id, ticket_id, author, technician, tech_group, content_plain, is_private, state, created_at, updated_at)
      SELECT task_id, ticket_id, author, technician, tech_group, content_plain, is_private, state, created_at, updated_at
      FROM OPENJSON(@json) WITH (
          task_id INT, ticket_id INT, author NVARCHAR(255), technician NVARCHAR(255),
          tech_group NVARCHAR(255), content_plain NVARCHAR(MAX), is_private BIT,
          state INT, created_at DATETIME2(3), updated_at DATETIME2(3)
      );
    `;
    const affected = await this.tx.execute(sql, [{ name: 'json', type: 'nvarchar', length: 'MAX', nullable: false, value: json }]);
    if (affected !== expectedCount) throw new Error('unexpected_result');
  }

  async bulkUpsertTickets(json: string, expectedCount: number): Promise<void> {
    if (!isSafeNonNegativeInteger(expectedCount)) throw new Error('invalid_input');
    const jsonParam: SqlParameter = { name: 'json', type: 'nvarchar', length: 'MAX', nullable: false, value: json };
    const sqlUpdate = `
      UPDATE T
      SET T.title = J.title, T.content_plain = J.content_plain, T.status = J.status,
          T.status_label = J.status_label, T.type = J.type, T.type_label = J.type_label,
          T.priority = J.priority, T.priority_label = J.priority_label, T.opened_at = J.opened_at,
          T.updated_at_glpi = J.updated_at_glpi, T.solved_at = J.solved_at, T.closed_at = J.closed_at,
          T.requester_name = J.requester_name, T.requester_group = J.requester_group,
          T.assigned_technician = J.assigned_technician, T.assigned_group_ids = J.assigned_group_ids,
          T.assigned_group_names = J.assigned_group_names, T.detected_sector = J.detected_sector,
          T.is_sistemas_scope = J.is_sistemas_scope, T.is_tecnologia_scope = J.is_tecnologia_scope,
          T.web_url = J.web_url, T.synced_at = J.synced_at, T.requester_user_id = J.requester_user_id,
          T.requester_group_id = J.requester_group_id, T.detected_sector_group_id = J.detected_sector_group_id,
          T.detected_sector_name = J.detected_sector_name, T.sector_source = J.sector_source,
          T.category_id = J.category_id, T.entity_id = J.entity_id, T.location_id = J.location_id,
          T.request_type_id = J.request_type_id, T.urgency = J.urgency, T.impact = J.impact,
          T.glpi_priority = J.glpi_priority
      FROM [prioglpi].[glpi_ticket_cache] T
      INNER JOIN OPENJSON(@json) WITH (
          ticket_id INT, title NVARCHAR(1000), content_plain NVARCHAR(MAX), status INT, status_label NVARCHAR(255),
          type INT, type_label NVARCHAR(255), priority INT, priority_label NVARCHAR(255), opened_at NVARCHAR(50),
          updated_at_glpi NVARCHAR(50), solved_at NVARCHAR(50), closed_at NVARCHAR(50), requester_name NVARCHAR(255),
          requester_group NVARCHAR(255), assigned_technician NVARCHAR(255), assigned_group_ids NVARCHAR(MAX),
          assigned_group_names NVARCHAR(MAX), detected_sector NVARCHAR(255), is_sistemas_scope BIT,
          is_tecnologia_scope BIT, web_url NVARCHAR(1000), synced_at DATETIME2(3), requester_user_id INT,
          requester_group_id INT, detected_sector_group_id INT, detected_sector_name NVARCHAR(255),
          sector_source NVARCHAR(255), category_id INT, entity_id INT, location_id INT, request_type_id INT,
          urgency INT, impact INT, glpi_priority INT
      ) J ON T.ticket_id = J.ticket_id;
    `;
    const updated = await this.tx.execute(sqlUpdate, [jsonParam]);

    const sqlInsert = `
      INSERT INTO [prioglpi].[glpi_ticket_cache] (
          ticket_id, title, content_plain, status, status_label, type, type_label,
          priority, priority_label, opened_at, updated_at_glpi, solved_at, closed_at,
          requester_name, requester_group, assigned_technician, assigned_group_ids,
          assigned_group_names, detected_sector, is_sistemas_scope, is_tecnologia_scope,
          web_url, synced_at, requester_user_id, requester_group_id, detected_sector_group_id,
          detected_sector_name, sector_source, category_id, entity_id, location_id,
          request_type_id, urgency, impact, glpi_priority
      )
      SELECT
          J.ticket_id, J.title, J.content_plain, J.status, J.status_label, J.type, J.type_label,
          J.priority, J.priority_label, J.opened_at, J.updated_at_glpi, J.solved_at, J.closed_at,
          J.requester_name, J.requester_group, J.assigned_technician, J.assigned_group_ids,
          J.assigned_group_names, J.detected_sector, J.is_sistemas_scope, J.is_tecnologia_scope,
          J.web_url, J.synced_at, J.requester_user_id, J.requester_group_id, J.detected_sector_group_id,
          J.detected_sector_name, J.sector_source, J.category_id, J.entity_id, J.location_id,
          J.request_type_id, J.urgency, J.impact, J.glpi_priority
      FROM OPENJSON(@json) WITH (
          ticket_id INT, title NVARCHAR(1000), content_plain NVARCHAR(MAX), status INT, status_label NVARCHAR(255),
          type INT, type_label NVARCHAR(255), priority INT, priority_label NVARCHAR(255), opened_at NVARCHAR(50),
          updated_at_glpi NVARCHAR(50), solved_at NVARCHAR(50), closed_at NVARCHAR(50), requester_name NVARCHAR(255),
          requester_group NVARCHAR(255), assigned_technician NVARCHAR(255), assigned_group_ids NVARCHAR(MAX),
          assigned_group_names NVARCHAR(MAX), detected_sector NVARCHAR(255), is_sistemas_scope BIT,
          is_tecnologia_scope BIT, web_url NVARCHAR(1000), synced_at DATETIME2(3), requester_user_id INT,
          requester_group_id INT, detected_sector_group_id INT, detected_sector_name NVARCHAR(255),
          sector_source NVARCHAR(255), category_id INT, entity_id INT, location_id INT, request_type_id INT,
          urgency INT, impact INT, glpi_priority INT
      ) J
      WHERE NOT EXISTS (SELECT 1 FROM [prioglpi].[glpi_ticket_cache] T WHERE T.ticket_id = J.ticket_id);
    `;
    const inserted = await this.tx.execute(sqlInsert, [jsonParam]);
    if (!isSafeNonNegativeInteger(updated) || !isSafeNonNegativeInteger(inserted)) throw new Error('unexpected_result');
    if (updated + inserted !== expectedCount) throw new Error('unexpected_result');
  }

  async processClosedRankings(closedTicketIds: readonly number[], sysUserId: number, username: string, displayName: string, now: Date): Promise<number> {
    if (!Array.isArray(closedTicketIds)) throw new Error('invalid_input');
    if (!isSafePositiveInteger(sysUserId)) throw new Error('invalid_input');
    if (typeof username !== 'string' || !username) throw new Error('invalid_input');
    if (typeof displayName !== 'string' || !displayName) throw new Error('invalid_input');
    if (!isValidDate(now)) throw new Error('invalid_input');

    const set = new Set<number>();
    for (const id of closedTicketIds) {
      if (!isSafePositiveInteger(id)) throw new Error('invalid_input');
      if (set.has(id)) throw new Error('invalid_input');
      set.add(id);
    }
    if (set.size === 0) return 0;
    const uniqueIds = Array.from(set);

    const safeNow = new Date(now.getTime());
    const auditRepo = new SqlServerOperationalAuditWriteRepository(this.tx);
    const idsJson = JSON.stringify(uniqueIds);

    const sqlGet = `
      SELECT r.id, r.ticket_id, r.glpi_group_id, r.sector_name, r.rank_position, r.updated_by_user_id
      FROM [prioglpi].[ticket_ranking] r
      JOIN [prioglpi].[glpi_ticket_cache] t ON r.ticket_id = t.ticket_id
      WHERE r.ticket_id IN (SELECT [ticket_id] FROM OPENJSON(@ids) WITH ([ticket_id] INT '$'))
        AND r.is_active = 1
        AND t.status IN (5, 6)
      ORDER BY r.rank_position ASC, r.ticket_id ASC, r.id ASC
    `;
    const rows = await this.tx.query(sqlGet, [{ name: 'ids', type: 'nvarchar', length: 'MAX', nullable: false, value: idsJson }]);
    let deactivatedCount = 0;
    const groupIdsToRenumber = new Set<number>();

    for (const row of rows) {
      const keys = Reflect.ownKeys(row);
      if (keys.length !== 6 || !keys.includes('id') || !keys.includes('ticket_id') || !keys.includes('glpi_group_id') || !keys.includes('sector_name') || !keys.includes('rank_position') || !keys.includes('updated_by_user_id')) {
        throw new Error('corrupt_data');
      }

      const id = this.parsePositiveInt(row['id']);
      const ticketId = this.parsePositiveInt(row['ticket_id']);
      const glpiGroupId = this.parsePositiveInt(row['glpi_group_id']);
      const sectorName = row['sector_name'];
      const rankPosition = this.parsePositiveInt(row['rank_position']);
      const updatedByUserId = this.parsePositiveInt(row['updated_by_user_id']);

      if (typeof sectorName !== 'string') {
        throw new Error('corrupt_data');
      }

      const sqlDeactivate = `
        UPDATE [prioglpi].[ticket_ranking]
        SET is_active = 0, updated_by_user_id = @sysUserId, updated_at = @now
        WHERE id = @id AND ticket_id = @ticketId AND glpi_group_id = @glpiGroupId AND is_active = 1
      `;
      const affected = await this.tx.execute(sqlDeactivate, [
        { name: 'sysUserId', type: 'int', nullable: false, value: sysUserId },
        { name: 'now', type: 'datetime2', scale: 3, nullable: false, value: safeNow },
        { name: 'id', type: 'int', nullable: false, value: id },
        { name: 'ticketId', type: 'int', nullable: false, value: ticketId },
        { name: 'glpiGroupId', type: 'int', nullable: false, value: glpiGroupId }
      ]);
      if (affected !== 1) throw new Error('unexpected_result');

      deactivatedCount++;
      groupIdsToRenumber.add(glpiGroupId);

      await auditRepo.writeAudit({
        userId: sysUserId,
        action: 'ranking_auto_deactivate',
        entityType: 'ranking',
        entityId: `${glpiGroupId}/${ticketId}`,
        actorName: displayName,
        actorUsername: username,
        before: { ticketId, glpiGroupId, sectorName, rankPosition, isActive: true, updatedByUserId },
        after: { ticketId, glpiGroupId, sectorName, rankPosition, isActive: false, updatedByUserId: sysUserId }
      });
    }

    for (const groupId of groupIdsToRenumber) {
      const sqlGetRemaining = `
        SELECT id, ticket_id, rank_position
        FROM [prioglpi].[ticket_ranking]
        WHERE glpi_group_id = @groupId AND is_active = 1
        ORDER BY rank_position ASC, ticket_id ASC, id ASC
      `;
      const remRows = await this.tx.query(sqlGetRemaining, [{ name: 'groupId', type: 'int', nullable: false, value: groupId }]);
      const seenIds = new Set<number>();
      for (let i = 0; i < remRows.length; i++) {
        const row = remRows[i];
        const keys = Reflect.ownKeys(row);
        if (keys.length !== 3 || !keys.includes('id') || !keys.includes('ticket_id') || !keys.includes('rank_position')) {
          throw new Error('corrupt_data');
        }

        const remId = this.parsePositiveInt(row['id']);
        const remTicketId = this.parsePositiveInt(row['ticket_id']);
        const currentPos = this.parsePositiveInt(row['rank_position']);

        if (seenIds.has(remId)) throw new Error('corrupt_data');
        seenIds.add(remId);

        const expectedPos = i + 1;
        if (currentPos !== expectedPos) {
          const sqlUpdatePos = `
            UPDATE [prioglpi].[ticket_ranking]
            SET rank_position = @pos, updated_by_user_id = @sysUserId, updated_at = @now
            WHERE id = @id AND ticket_id = @ticketId AND glpi_group_id = @groupId AND is_active = 1
          `;
          const affectedPos = await this.tx.execute(sqlUpdatePos, [
            { name: 'pos', type: 'int', nullable: false, value: expectedPos },
            { name: 'sysUserId', type: 'int', nullable: false, value: sysUserId },
            { name: 'now', type: 'datetime2', scale: 3, nullable: false, value: safeNow },
            { name: 'id', type: 'int', nullable: false, value: remId },
            { name: 'ticketId', type: 'int', nullable: false, value: remTicketId },
            { name: 'groupId', type: 'int', nullable: false, value: groupId }
          ]);
          if (affectedPos !== 1) throw new Error('unexpected_result');
        }
      }
    }
    return deactivatedCount;
  }

  async insertSyncRunSuccess(data: SyncRunSuccessData): Promise<void> {
    const keys = Reflect.ownKeys(data);
    const expectedKeys = ['startedAt', 'finishedAt', 'ticketsFetched', 'sistemasCount', 'tecnologiaCount', 'unroutedCount', 'activeCount', 'historyCount', 'usersCount', 'groupsCount', 'membershipsCount', 'publicNotesCount', 'privateNotesCount', 'durationMs'];
    if (keys.length !== expectedKeys.length || !expectedKeys.every(k => keys.includes(k))) throw new Error('invalid_input');

    if (!isValidDate(data.startedAt) || !isValidDate(data.finishedAt)) throw new Error('invalid_input');
    const safeStart = new Date(data.startedAt.getTime());
    const safeFinish = new Date(data.finishedAt.getTime());
    if (safeFinish.getTime() < safeStart.getTime()) throw new Error('invalid_input');

    const counts = [data.ticketsFetched, data.sistemasCount, data.tecnologiaCount, data.unroutedCount, data.activeCount, data.historyCount, data.usersCount, data.groupsCount, data.membershipsCount, data.publicNotesCount, data.privateNotesCount, data.durationMs];
    if (!counts.every(isSafeNonNegativeInteger)) throw new Error('invalid_input');

    const sql = `
      INSERT INTO [prioglpi].[sync_run] (
        started_at, finished_at, status, tickets_fetched, sistemas_count,
        tecnologia_count, unrouted_count, active_count, history_count,
        sector_source_count, no_sector_count, users_count, groups_count,
        memberships_count, public_notes_count, private_notes_count, duration_ms
      ) VALUES (
        @startedAt, @finishedAt, 'success', @ticketsFetched, @sistemasCount,
        @tecnologiaCount, @unroutedCount, @activeCount, @historyCount,
        0, 0, @usersCount, @groupsCount,
        @membershipsCount, @publicNotesCount, @privateNotesCount, @durationMs
      )
    `;
    const affected = await this.tx.execute(sql, [
      { name: 'startedAt', type: 'datetime2', scale: 3, nullable: false, value: safeStart },
      { name: 'finishedAt', type: 'datetime2', scale: 3, nullable: false, value: safeFinish },
      { name: 'ticketsFetched', type: 'int', nullable: false, value: data.ticketsFetched },
      { name: 'sistemasCount', type: 'int', nullable: false, value: data.sistemasCount },
      { name: 'tecnologiaCount', type: 'int', nullable: false, value: data.tecnologiaCount },
      { name: 'unroutedCount', type: 'int', nullable: false, value: data.unroutedCount },
      { name: 'activeCount', type: 'int', nullable: false, value: data.activeCount },
      { name: 'historyCount', type: 'int', nullable: false, value: data.historyCount },
      { name: 'usersCount', type: 'int', nullable: false, value: data.usersCount },
      { name: 'groupsCount', type: 'int', nullable: false, value: data.groupsCount },
      { name: 'membershipsCount', type: 'int', nullable: false, value: data.membershipsCount },
      { name: 'publicNotesCount', type: 'int', nullable: false, value: data.publicNotesCount },
      { name: 'privateNotesCount', type: 'int', nullable: false, value: data.privateNotesCount },
      { name: 'durationMs', type: 'int', nullable: false, value: data.durationMs }
    ]);
    if (affected !== 1) throw new Error('unexpected_result');
  }

  static async insertSyncRunError(rt: ISqlServerRuntime, startedAt: Date, errorMessage: string, clock?: Date): Promise<void> {
    if (!isValidDate(startedAt)) throw new Error('invalid_input');
    if (clock !== undefined && !isValidDate(clock)) throw new Error('invalid_input');
    if (typeof errorMessage !== 'string') throw new Error('invalid_input');
    const safeError = String(redactSecrets(errorMessage)).substring(0, 4000);
    const sql = `
      INSERT INTO [prioglpi].[sync_run] (
        started_at, finished_at, status, tickets_fetched, error_message,
        sistemas_count, tecnologia_count, unrouted_count, active_count, history_count,
        sector_source_count, no_sector_count, users_count, groups_count,
        memberships_count, public_notes_count, private_notes_count, duration_ms
      ) VALUES (
        @startedAt, @finishedAt, 'error', 0, @errorMsg,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
      )
    `;
    await rt.withTransaction({ isolation: 'serializable' }, async tx => {
      const affected = await tx.execute(sql, [
        { name: 'startedAt', type: 'datetime2', scale: 3, nullable: false, value: new Date(startedAt.getTime()) },
        { name: 'finishedAt', type: 'datetime2', scale: 3, nullable: false, value: clock ? new Date(clock.getTime()) : new Date() },
        { name: 'errorMsg', type: 'nvarchar', length: 'MAX', nullable: true, value: safeError }
      ]);
      if (affected !== 1) throw new Error('unexpected_result');
    });
  }

  static async getSyncStatus(rt: ISqlServerRuntime) {
    const sqlRun = `SELECT TOP (1) started_at, finished_at, status, tickets_fetched, error_message FROM [prioglpi].[sync_run] ORDER BY id DESC`;
    const sqlTotal = `SELECT COUNT(*) AS c FROM [prioglpi].[glpi_ticket_cache]`;
    const sqlSistemas = `SELECT COUNT(*) AS c FROM [prioglpi].[glpi_ticket_cache] WHERE is_sistemas_scope = 1`;

    const [tRows, sRows] = await Promise.all([rt.query(sqlTotal), rt.query(sqlSistemas)]);

    if (tRows.length !== 1) throw new Error('corrupt_data');
    if (sRows.length !== 1) throw new Error('corrupt_data');

    const tKeys = Reflect.ownKeys(tRows[0]);
    if (tKeys.length !== 1 || tKeys[0] !== 'c') throw new Error('corrupt_data');
    const totalCachedTickets = tRows[0]['c'];
    if (!isSafeNonNegativeInteger(totalCachedTickets)) throw new Error('corrupt_data');

    const sKeys = Reflect.ownKeys(sRows[0]);
    if (sKeys.length !== 1 || sKeys[0] !== 'c') throw new Error('corrupt_data');
    const sistemasCachedTickets = sRows[0]['c'];
    if (!isSafeNonNegativeInteger(sistemasCachedTickets)) throw new Error('corrupt_data');

    const runs = await rt.query(sqlRun);
    if (runs.length > 1) throw new Error('corrupt_data');

    const lastRun = runs.length === 1 ? runs[0] : null;
    let lastSync = null;
    if (lastRun) {
      const runKeys = Reflect.ownKeys(lastRun);
      const expectedRunKeys = ['started_at', 'finished_at', 'status', 'tickets_fetched', 'error_message'];
      if (runKeys.length !== expectedRunKeys.length || !expectedRunKeys.every(k => runKeys.includes(k))) throw new Error('corrupt_data');

      const status = lastRun['status'];
      if (status !== 'running' && status !== 'success' && status !== 'error') throw new Error('corrupt_data');

      const started_at = lastRun['started_at'];
      const finished_at = lastRun['finished_at'];
      if (!isValidDate(started_at)) throw new Error('corrupt_data');
      if (finished_at !== null && !isValidDate(finished_at)) throw new Error('corrupt_data');

      const tickets_fetched = lastRun['tickets_fetched'];
      if (!isSafeNonNegativeInteger(tickets_fetched)) throw new Error('corrupt_data');

      const error_message = lastRun['error_message'];
      if (error_message !== null && typeof error_message !== 'string') throw new Error('corrupt_data');

      lastSync = Object.freeze({
        startedAt: new Date(started_at.getTime()),
        finishedAt: finished_at ? new Date(finished_at.getTime()) : null,
        status,
        ticketsFetched: tickets_fetched,
        errorMessage: error_message
      });
    }

    return Object.freeze({
      isRunning: lastSync?.status === 'running',
      lastSync,
      totalCachedTickets,
      sistemasCachedTickets
    });
  }
}
