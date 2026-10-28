import type { ISqlServerTransaction, SqlParameter } from '../sqlserver-runtime-contract';
import { OperationalRankingWriteError, type IOperationalRankingWriteRepository } from './operational-ranking-write-repository';
import type {
  OperationalRankingMutationTicket,
  OperationalRankingMutationGroup,
  OperationalActiveRankingState,
  OperationalRankingSharedQueue
} from './operational-ranking-write-types';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 2147483647;
}

function parseResultId(value: unknown): number | null {
  if (isValidId(value)) return value;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;

  const parsed = Number(value);
  return isValidId(parsed) ? parsed : null;
}

function isValidSqlInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647;
}

function isValidStringField(value: unknown, maxLength: number): value is string {
  if (typeof value !== 'string') return false;
  if (value.trim().length === 0) return false;
  if (value.length > maxLength) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 31 || c === 127) return false;
  }
  return true;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function validateExactKeys(input: unknown, expectedKeys: readonly string[]): asserts input is Readonly<Record<string, unknown>> {
  if (!isRecord(input)) {
    throw new OperationalRankingWriteError('invalid_input', 'Invalid input type');
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length !== expectedKeys.length) {
    throw new OperationalRankingWriteError('invalid_input', 'Invalid key count');
  }
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (typeof key !== 'string') {
      throw new OperationalRankingWriteError('invalid_input', 'Symbol or non-string key detected');
    }
    let found = false;
    for (let j = 0; j < expectedKeys.length; j++) {
      if (expectedKeys[j] === key) {
        found = true;
        break;
      }
    }
    if (!found) {
      throw new OperationalRankingWriteError('invalid_input', 'Unexpected key found');
    }
  }
}

function extractBit(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new OperationalRankingWriteError('corrupt_data', 'Invalid BIT value');
}

export class SqlServerOperationalRankingWriteRepository implements IOperationalRankingWriteRepository {
  /**
   * tx debe provenir de ISqlServerRuntime.withTransaction().
   * El repositorio no abre, confirma ni revierte transacciones.
   * No debe utilizarse con una sesión global.
   * La mutación y SqlServerOperationalAuditWriteRepository deberán compartir
   * esta misma referencia tx en la fase orquestadora posterior.
   */
  constructor(private readonly tx: ISqlServerTransaction) {}

  async getSharedQueueForGroup(glpiGroupId: unknown): Promise<OperationalRankingSharedQueue | null> {
    if (!isValidId(glpiGroupId)) throw new OperationalRankingWriteError('invalid_input', 'Invalid shared queue group');
    const queueRows = await this.tx.query(`
      SELECT DISTINCT q.[id] AS [queue_id]
      FROM [prioglpi].[ranking_shared_queue] q
      INNER JOIN [prioglpi].[ranking_shared_queue_scope] s ON s.[queue_id] = q.[id]
      WHERE s.[glpi_group_id] = @glpiGroupId
    `, [{ name: 'glpiGroupId', type: 'int', nullable: false, value: glpiGroupId }]);
    if (queueRows.length === 0) return null;
    if (queueRows.length !== 1 || !isRecord(queueRows[0])) {
      throw new OperationalRankingWriteError('corrupt_data', 'Ambiguous shared queue configuration');
    }
    const queueId = parseResultId(queueRows[0]['queue_id']);
    if (!isValidId(queueId)) {
      throw new OperationalRankingWriteError('corrupt_data', 'Ambiguous shared queue configuration');
    }
    const rows = await this.tx.query(`
      SELECT m.[user_id], s.[glpi_group_id]
      FROM [prioglpi].[ranking_shared_queue_member] m
      CROSS JOIN [prioglpi].[ranking_shared_queue_scope] s
      WHERE m.[queue_id] = @queueId AND s.[queue_id] = @queueId
      ORDER BY m.[user_id], s.[glpi_group_id]
    `, [{ name: 'queueId', type: 'int', nullable: false, value: queueId }]);
    const members = new Set<number>();
    const scopes = new Set<number>();
    for (const row of rows) {
      if (!isRecord(row) || !isValidId(row['user_id']) || !isValidId(row['glpi_group_id'])) throw new OperationalRankingWriteError('corrupt_data', 'Invalid shared queue configuration');
      members.add(row['user_id'] as number);
      scopes.add(row['glpi_group_id'] as number);
    }
    if (members.size < 2 || scopes.size === 0) throw new OperationalRankingWriteError('corrupt_data', 'Incomplete shared queue configuration');
    return Object.freeze({ queueId, memberUserIds: Object.freeze([...members].sort((a, b) => a - b)), scopeGroupIds: Object.freeze([...scopes].sort((a, b) => a - b)) });
  }

  async findTicketById(ticketId: unknown): Promise<OperationalRankingMutationTicket | null> {
    if (!isValidId(ticketId)) {
      throw new OperationalRankingWriteError('invalid_input', 'Invalid ticketId');
    }

    const sql = `
      SELECT TOP (2)
        [ticket_id],
        [is_sistemas_scope],
        [status],
        [status_label],
        [detected_sector],
        [detected_sector_group_id]
      FROM [prioglpi].[glpi_ticket_cache]
      WHERE [ticket_id] = @ticketId
    `;
    const params: SqlParameter[] = [
      { name: 'ticketId', type: 'int', nullable: false, value: ticketId }
    ];

    const rows = await this.tx.query(sql, params);
    if (rows.length === 0) return null;
    if (rows.length > 1) {
      throw new OperationalRankingWriteError('ambiguous_result', 'Ambiguous ticket resolution');
    }

    const row = rows[0];
    if (row === undefined) return null;

    validateExactKeys(row, [
      'ticket_id', 'is_sistemas_scope', 'status', 'status_label',
      'detected_sector', 'detected_sector_group_id'
    ]);

    const id = row['ticket_id'];
    const isScope = row['is_sistemas_scope'];
    const status = row['status'];
    const label = row['status_label'];
    const sector = row['detected_sector'];
    const groupId = row['detected_sector_group_id'];

    if (
      !isValidId(id) ||
      !isValidSqlInt(status) ||
      !isValidStringField(label, 255) ||
      !isValidStringField(sector, 255) ||
      (groupId !== null && !isValidId(groupId))
    ) {
      throw new OperationalRankingWriteError('corrupt_data', 'Corrupt ticket data');
    }

    return Object.freeze({
      ticketId: id,
      isSistemasScope: extractBit(isScope),
      status,
      statusLabel: label,
      detectedSector: sector,
      detectedSectorGroupId: groupId
    });
  }

  async findGroupById(groupId: unknown): Promise<OperationalRankingMutationGroup | null> {
    if (!isValidId(groupId)) {
      throw new OperationalRankingWriteError('invalid_input', 'Invalid groupId');
    }

    const sql = `
      SELECT TOP (2)
        [group_id],
        [name],
        [complete_name]
      FROM [prioglpi].[glpi_group_cache]
      WHERE [group_id] = @groupId
    `;
    const params: SqlParameter[] = [
      { name: 'groupId', type: 'int', nullable: false, value: groupId }
    ];

    const rows = await this.tx.query(sql, params);
    if (rows.length === 0) return null;
    if (rows.length > 1) {
      throw new OperationalRankingWriteError('ambiguous_result', 'Ambiguous group resolution');
    }

    const row = rows[0];
    if (row === undefined) return null;

    validateExactKeys(row, ['group_id', 'name', 'complete_name']);

    const id = row['group_id'];
    const name = row['name'];
    const cname = row['complete_name'];

    if (!isValidId(id) || !isValidStringField(name, 255) || !isValidStringField(cname, 1000)) {
      throw new OperationalRankingWriteError('corrupt_data', 'Corrupt group data');
    }

    return Object.freeze({
      groupId: id,
      name,
      completeName: cname
    });
  }

  async listActiveRankingsByGroupId(glpiGroupId: unknown): Promise<readonly OperationalActiveRankingState[]> {
    if (!isValidId(glpiGroupId)) {
      throw new OperationalRankingWriteError('invalid_input', 'Invalid glpiGroupId');
    }

    const sql = `
      SELECT
        [id],
        [ticket_id],
        [sector_name],
        [glpi_group_id],
        [rank_position],
        [created_by_user_id],
        [updated_by_user_id],
        [priority_set_by_user_id],
        [created_at],
        [updated_at],
        [is_active],
        [owner_user_id]
      FROM [prioglpi].[ticket_ranking]
      WHERE [glpi_group_id] = @glpiGroupId AND [is_active] = 1
      ORDER BY [rank_position] ASC, [ticket_id] ASC, [id] ASC
    `;
    const params: SqlParameter[] = [
      { name: 'glpiGroupId', type: 'int', nullable: false, value: glpiGroupId }
    ];

    const rows = await this.tx.query(sql, params);
    const results: OperationalActiveRankingState[] = [];
    const idSet = new Set<number>();
    const ticketGroupSet = new Set<string>();
    let lastPosition = -1;
    let lastTicketId = -1;
    let lastId = -1;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row === undefined) continue;

      validateExactKeys(row, [
        'id', 'ticket_id', 'sector_name', 'glpi_group_id', 'rank_position',
        'created_by_user_id', 'updated_by_user_id', 'priority_set_by_user_id', 'created_at', 'updated_at', 'is_active', 'owner_user_id'
      ]);

      const id = parseResultId(row['id']);
      const ticketId = row['ticket_id'];
      const sectorName = row['sector_name'];
      const rowGlpiGroupId = row['glpi_group_id'];
      const rankPosition = row['rank_position'];
      const createdByUserId = row['created_by_user_id'];
      const updatedByUserId = row['updated_by_user_id'];
      const createdAt = row['created_at'];
      const updatedAt = row['updated_at'];
      const isActive = row['is_active'];
      const ownerUserId = row['owner_user_id'];

      if (
        !isValidId(id) ||
        !isValidId(ticketId) ||
        !isValidStringField(sectorName, 255) ||
        !isValidId(rowGlpiGroupId) ||
        !isValidId(rankPosition) ||
        !isValidId(createdByUserId) ||
        !isValidId(updatedByUserId) ||
        !isValidDate(createdAt) ||
        !isValidDate(updatedAt) ||
        !extractBit(isActive) ||
        !isValidId(ownerUserId)
      ) {
        throw new OperationalRankingWriteError('corrupt_data', 'Corrupt active ranking data');
      }

      if (rowGlpiGroupId !== glpiGroupId) {
        throw new OperationalRankingWriteError('corrupt_data', 'Ranking belongs to wrong group');
      }
      if (idSet.has(id)) {
        throw new OperationalRankingWriteError('corrupt_data', 'Duplicate ranking ID');
      }
      const tgKey = `${ticketId}-${rowGlpiGroupId}`;
      if (ticketGroupSet.has(tgKey)) {
        throw new OperationalRankingWriteError('corrupt_data', 'Duplicate ticket in group');
      }
      if (
        rankPosition < lastPosition ||
        (rankPosition === lastPosition && ticketId < lastTicketId) ||
        (rankPosition === lastPosition && ticketId === lastTicketId && id < lastId)
      ) {
        throw new OperationalRankingWriteError('corrupt_data', 'Rankings out of order');
      }

      idSet.add(id);
      ticketGroupSet.add(tgKey);
      lastPosition = rankPosition;
      lastTicketId = ticketId;
      lastId = id;

      results.push(Object.freeze({
        id,
        ticketId,
        sectorName,
        glpiGroupId: rowGlpiGroupId,
        rankPosition,
        createdByUserId,
        updatedByUserId,
        createdAt: new Date(createdAt.getTime()),
        updatedAt: new Date(updatedAt.getTime()),
        isActive: true,
        ownerUserId
      }));
    }

    return Object.freeze(results);
  }

  async listActiveRankingsByOwnerUserId(ownerUserId: unknown): Promise<readonly OperationalActiveRankingState[]> {
    if (!isValidId(ownerUserId)) {
      throw new OperationalRankingWriteError('invalid_input', 'Invalid ownerUserId');
    }

    const sql = `
      SELECT [id], [ticket_id], [sector_name], [glpi_group_id], [rank_position],
             [created_by_user_id], [updated_by_user_id], [priority_set_by_user_id], [created_at], [updated_at],
             [is_active], [owner_user_id]
      FROM [prioglpi].[ticket_ranking]
      WHERE [owner_user_id] = @ownerUserId AND [is_active] = 1
      ORDER BY [rank_position] ASC, [ticket_id] ASC, [id] ASC
    `;
    const rows = await this.tx.query(sql, [{ name: 'ownerUserId', type: 'int', nullable: false, value: ownerUserId }]);
    const results: OperationalActiveRankingState[] = [];
    const ticketIds = new Set<number>();
    for (const row of rows) {
      validateExactKeys(row, ['id', 'ticket_id', 'sector_name', 'glpi_group_id', 'rank_position', 'created_by_user_id', 'updated_by_user_id', 'priority_set_by_user_id', 'created_at', 'updated_at', 'is_active', 'owner_user_id']);
      const id = parseResultId(row['id']);
      const ticketId = row['ticket_id'];
      const sectorName = row['sector_name'];
      const glpiGroupId = row['glpi_group_id'];
      const rankPosition = row['rank_position'];
      const createdByUserId = row['created_by_user_id'];
      const updatedByUserId = row['updated_by_user_id'];
      const prioritySetByUserId = row['priority_set_by_user_id'];
      const createdAt = row['created_at'];
      const updatedAt = row['updated_at'];
      const invalidFields = [
        !isValidId(id) && 'id',
        !isValidId(ticketId) && 'ticket_id',
        !isValidStringField(sectorName, 255) && 'sector_name',
        !isValidId(glpiGroupId) && 'glpi_group_id',
        !isValidId(rankPosition) && 'rank_position',
        !isValidId(createdByUserId) && 'created_by_user_id',
        !isValidId(updatedByUserId) && 'updated_by_user_id',
        !isValidId(prioritySetByUserId) && 'priority_set_by_user_id',
        !isValidDate(createdAt) && 'created_at',
        !isValidDate(updatedAt) && 'updated_at',
        !extractBit(row['is_active']) && 'is_active',
        row['owner_user_id'] !== ownerUserId && 'owner_user_id',
        isValidId(ticketId) && ticketIds.has(ticketId) && 'duplicate_ticket_id'
      ].filter((field): field is string => typeof field === 'string');
      if (invalidFields.length > 0) {
        throw new OperationalRankingWriteError(
          'corrupt_data',
          `Corrupt owner ranking data (owner=${ownerUserId}, ticket=${String(ticketId)}, fields=${invalidFields.join(',')})`
        );
      }
      ticketIds.add(ticketId as number);
      results.push(Object.freeze({
        id: id as number,
        ticketId: ticketId as number,
        sectorName: sectorName as string,
        glpiGroupId: glpiGroupId as number,
        rankPosition: rankPosition as number,
        createdByUserId: createdByUserId as number,
        updatedByUserId: updatedByUserId as number,
        prioritySetByUserId: prioritySetByUserId as number,
        createdAt: new Date((createdAt as Date).getTime()),
        updatedAt: new Date((updatedAt as Date).getTime()),
        isActive: true,
        ownerUserId
      }));
    }
    return Object.freeze(results);
  }

  async upsertActiveRanking(input: unknown): Promise<void> {
    validateExactKeys(input, [
      'ticketId', 'sectorName', 'glpiGroupId', 'ownerUserId', 'rankPosition', 'actorUserId', 'updatedAt'
    ]);

    const ticketId = input['ticketId'];
    const sectorName = input['sectorName'];
    const glpiGroupId = input['glpiGroupId'];
    const ownerUserId = input['ownerUserId'];
    const rankPosition = input['rankPosition'];
    const actorUserId = input['actorUserId'];
    const updatedAt = input['updatedAt'];

    if (
      !isValidId(ticketId) ||
      !isValidStringField(sectorName, 255) ||
      !isValidId(glpiGroupId) ||
      !isValidId(ownerUserId) ||
      !isValidId(rankPosition) ||
      !isValidId(actorUserId) ||
      !isValidDate(updatedAt)
    ) {
      throw new OperationalRankingWriteError('invalid_input', 'Invalid upsert input');
    }

    const safeDate = new Date(updatedAt.getTime());

    const sql = `
      UPDATE [prioglpi].[ticket_ranking]
      SET [sector_name] = @sectorName,
          [rank_position] = @rankPosition,
          [updated_by_user_id] = @actorUserId,
          [priority_set_by_user_id] = @actorUserId,
          [owner_user_id] = @ownerUserId,
          [updated_at] = @updatedAt,
          [is_active] = 1
      WHERE [ticket_id] = @ticketId AND [owner_user_id] = @ownerUserId AND [is_active] = 1;

      IF @@ROWCOUNT = 0
      BEGIN
        INSERT INTO [prioglpi].[ticket_ranking] (
          [ticket_id],
          [sector_name],
          [glpi_group_id],
          [owner_user_id],
          [rank_position],
          [created_by_user_id],
          [updated_by_user_id],
          [priority_set_by_user_id],
          [updated_at],
          [is_active]
        )
        VALUES (
          @ticketId,
          @sectorName,
          @glpiGroupId,
          @ownerUserId,
          @rankPosition,
          @actorUserId,
          @actorUserId,
          @actorUserId,
          @updatedAt,
          1
        )
      END
    `;

    const params: SqlParameter[] = [
      { name: 'ticketId', type: 'int', nullable: false, value: ticketId },
      { name: 'sectorName', type: 'nvarchar', length: 255, nullable: false, value: sectorName },
      { name: 'glpiGroupId', type: 'int', nullable: false, value: glpiGroupId },
      { name: 'ownerUserId', type: 'int', nullable: false, value: ownerUserId },
      { name: 'rankPosition', type: 'int', nullable: false, value: rankPosition },
      { name: 'actorUserId', type: 'int', nullable: false, value: actorUserId },
      { name: 'updatedAt', type: 'datetime2', scale: 3, nullable: false, value: safeDate }
    ];

    const rowsAffected = await this.tx.execute(sql, params);
    if (typeof rowsAffected !== 'number' || !Number.isSafeInteger(rowsAffected) || rowsAffected !== 1) {
      throw new OperationalRankingWriteError('unexpected_result', 'Unexpected upsert result');
    }
  }

  async updateActiveRankingPosition(input: unknown): Promise<'updated' | 'not_found'> {
    validateExactKeys(input, [
      'rankingId', 'ticketId', 'glpiGroupId', 'ownerUserId', 'rankPosition', 'actorUserId', 'prioritySetByUserId', 'updatedAt'
    ]);

    const rankingId = input['rankingId'];
    const ticketId = input['ticketId'];
    const glpiGroupId = input['glpiGroupId'];
    const ownerUserId = input['ownerUserId'];
    const rankPosition = input['rankPosition'];
    const actorUserId = input['actorUserId'];
    const prioritySetByUserId = input['prioritySetByUserId'];
    const updatedAt = input['updatedAt'];

    if (
      !isValidId(rankingId) ||
      !isValidId(ticketId) ||
      !isValidId(glpiGroupId) ||
      !isValidId(ownerUserId) ||
      !isValidId(rankPosition) ||
      !isValidId(actorUserId) ||
      !isValidId(prioritySetByUserId) ||
      !isValidDate(updatedAt)
    ) {
      throw new OperationalRankingWriteError('invalid_input', 'Invalid update input');
    }

    const safeDate = new Date(updatedAt.getTime());

    const sql = `
      UPDATE [prioglpi].[ticket_ranking]
      SET [rank_position] = @rankPosition,
          [updated_by_user_id] = @actorUserId,
          [priority_set_by_user_id] = @prioritySetByUserId,
          [updated_at] = @updatedAt
      WHERE [id] = @rankingId
        AND [ticket_id] = @ticketId
        AND [owner_user_id] = @ownerUserId
        AND [is_active] = 1;
    `;

    const params: SqlParameter[] = [
      { name: 'rankingId', type: 'int', nullable: false, value: rankingId },
      { name: 'ticketId', type: 'int', nullable: false, value: ticketId },
      { name: 'glpiGroupId', type: 'int', nullable: false, value: glpiGroupId },
      { name: 'ownerUserId', type: 'int', nullable: false, value: ownerUserId },
      { name: 'rankPosition', type: 'int', nullable: false, value: rankPosition },
      { name: 'actorUserId', type: 'int', nullable: false, value: actorUserId },
      { name: 'prioritySetByUserId', type: 'int', nullable: false, value: prioritySetByUserId },
      { name: 'updatedAt', type: 'datetime2', scale: 3, nullable: false, value: safeDate }
    ];

    const rowsAffected = await this.tx.execute(sql, params);
    if (rowsAffected === 1) return 'updated';
    if (rowsAffected === 0) return 'not_found';

    throw new OperationalRankingWriteError('unexpected_result', 'Unexpected update result');
  }

  async deactivateActiveRanking(input: unknown): Promise<'updated' | 'not_found'> {
    validateExactKeys(input, [
      'rankingId', 'ticketId', 'glpiGroupId', 'ownerUserId', 'actorUserId', 'updatedAt'
    ]);

    const rankingId = input['rankingId'];
    const ticketId = input['ticketId'];
    const glpiGroupId = input['glpiGroupId'];
    const ownerUserId = input['ownerUserId'];
    const actorUserId = input['actorUserId'];
    const updatedAt = input['updatedAt'];

    if (
      !isValidId(rankingId) ||
      !isValidId(ticketId) ||
      !isValidId(glpiGroupId) ||
      !isValidId(ownerUserId) ||
      !isValidId(actorUserId) ||
      !isValidDate(updatedAt)
    ) {
      throw new OperationalRankingWriteError('invalid_input', 'Invalid deactivate input');
    }

    const safeDate = new Date(updatedAt.getTime());

    const sql = `
      UPDATE [prioglpi].[ticket_ranking]
      SET [is_active] = 0,
          [updated_by_user_id] = @actorUserId,
          [updated_at] = @updatedAt
      WHERE [id] = @rankingId
        AND [ticket_id] = @ticketId
        AND [owner_user_id] = @ownerUserId
        AND [is_active] = 1;
    `;

    const params: SqlParameter[] = [
      { name: 'rankingId', type: 'int', nullable: false, value: rankingId },
      { name: 'ticketId', type: 'int', nullable: false, value: ticketId },
      { name: 'glpiGroupId', type: 'int', nullable: false, value: glpiGroupId },
      { name: 'ownerUserId', type: 'int', nullable: false, value: ownerUserId },
      { name: 'actorUserId', type: 'int', nullable: false, value: actorUserId },
      { name: 'updatedAt', type: 'datetime2', scale: 3, nullable: false, value: safeDate }
    ];

    const rowsAffected = await this.tx.execute(sql, params);
    if (rowsAffected === 1) return 'updated';
    if (rowsAffected === 0) return 'not_found';

    throw new OperationalRankingWriteError('unexpected_result', 'Unexpected deactivate result');
  }

  async acquireGroupLock(glpiGroupId: unknown): Promise<void> {
    if (!isValidId(glpiGroupId)) {
      throw new OperationalRankingWriteError('invalid_input', 'Invalid glpiGroupId for lock');
    }

    const sql = `
      DECLARE @res INT;
      EXEC @res = sp_getapplock
        @Resource = @LockResource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 5000;

      SELECT @res AS Result;
    `;

    const params: SqlParameter[] = [
      { name: 'LockResource', type: 'nvarchar', length: 255, nullable: false, value: `prioglpi-ranking-group-${glpiGroupId}` }
    ];

    const rows = await this.tx.query(sql, params);
    if (!rows || rows.length === 0) {
      throw new OperationalRankingWriteError('unexpected_result', 'Failed to acquire lock: no result');
    }

    const result = rows[0]?.Result;
    if (typeof result !== 'number' || result < 0) {
      throw new OperationalRankingWriteError('concurrency_conflict', 'Could not acquire lock for owner');
    }
  }

  async acquireOwnerLock(ownerUserId: unknown): Promise<void> {
    if (!isValidId(ownerUserId)) throw new OperationalRankingWriteError('invalid_input', 'Invalid ownerUserId for lock');
    const rows = await this.tx.query(`
      DECLARE @res INT;
      EXEC @res = sp_getapplock @Resource = @LockResource, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 5000;
      SELECT @res AS Result;
    `, [{ name: 'LockResource', type: 'nvarchar', length: 255, nullable: false, value: `prioglpi-ranking-owner-${ownerUserId}` }]);
    if (typeof rows[0]?.Result !== 'number' || rows[0].Result < 0) {
      throw new OperationalRankingWriteError('concurrency_conflict', 'Could not acquire lock for owner');
    }
  }

  async parkActiveRankingPositionsForGroup(
    glpiGroupId: unknown,
    ticketIds: readonly number[],
    actorUserId: unknown,
    updatedAt: Date,
    expectedRows: number
  ): Promise<number> {
    if (!isValidId(glpiGroupId) || !isValidId(actorUserId) || !isValidDate(updatedAt)) {
      throw new OperationalRankingWriteError('invalid_input', 'Invalid park input');
    }
    if (typeof expectedRows !== 'number' || !Number.isSafeInteger(expectedRows) || expectedRows < 0) {
      throw new OperationalRankingWriteError('invalid_input', 'Invalid expectedRows');
    }
    if (!Array.isArray(ticketIds) || ticketIds.length === 0 || ticketIds.length > 200) {
      throw new OperationalRankingWriteError('invalid_input', 'Invalid ticketIds array');
    }
    for (const tid of ticketIds) {
      if (!isValidId(tid)) throw new OperationalRankingWriteError('invalid_input', 'Invalid ticketId in array');
    }

    const safeDate = new Date(updatedAt.getTime());
    const params: SqlParameter[] = [
      { name: 'glpiGroupId', type: 'int', nullable: false, value: glpiGroupId },
      { name: 'actorUserId', type: 'int', nullable: false, value: actorUserId },
      { name: 'updatedAt', type: 'datetime2', scale: 3, nullable: false, value: safeDate }
    ];

    const inClauses = ticketIds.map((tid, idx) => {
      const pName = `tId${idx}`;
      params.push({ name: pName, type: 'int', nullable: false, value: tid });
      return `@${pName}`;
    }).join(', ');

    const sql = `
      UPDATE [prioglpi].[ticket_ranking]
      SET [rank_position] = [rank_position] + 1000000,
          [updated_by_user_id] = @actorUserId,
          [updated_at] = @updatedAt
      WHERE [glpi_group_id] = @glpiGroupId
        AND [is_active] = 1
        AND [ticket_id] IN (${inClauses});
    `;

    const rowsAffected = await this.tx.execute(sql, params);
    if (typeof rowsAffected !== 'number' || !Number.isSafeInteger(rowsAffected)) {
      throw new OperationalRankingWriteError('unexpected_result', 'Unexpected park update result');
    }
    if (rowsAffected !== expectedRows) {
      throw new OperationalRankingWriteError('concurrency_conflict', 'Concurrency conflict during parking');
    }
    return rowsAffected;
  }

  async parkActiveRankingPositionsForOwner(ownerUserId: unknown, ticketIds: readonly number[], actorUserId: unknown, updatedAt: Date, expectedRows: number): Promise<number> {
    if (!isValidId(ownerUserId) || !isValidId(actorUserId) || !isValidDate(updatedAt) || !Number.isSafeInteger(expectedRows) || expectedRows < 0 || ticketIds.length === 0 || ticketIds.length > 200 || ticketIds.some((id) => !isValidId(id))) {
      throw new OperationalRankingWriteError('invalid_input', 'Invalid owner park input');
    }
    const params: SqlParameter[] = [
      { name: 'ownerUserId', type: 'int', nullable: false, value: ownerUserId },
      { name: 'actorUserId', type: 'int', nullable: false, value: actorUserId },
      { name: 'updatedAt', type: 'datetime2', scale: 3, nullable: false, value: new Date(updatedAt.getTime()) }
    ];
    const values = ticketIds.map((ticketId, index) => {
      const name = `ticketId${index}`;
      params.push({ name, type: 'int', nullable: false, value: ticketId });
      return `@${name}`;
    }).join(', ');
    const affected = await this.tx.execute(`
      UPDATE [prioglpi].[ticket_ranking]
      SET [rank_position] = [rank_position] + 1000000, [updated_by_user_id] = @actorUserId, [updated_at] = @updatedAt
      WHERE [owner_user_id] = @ownerUserId AND [is_active] = 1 AND [ticket_id] IN (${values});
    `, params);
    if (!Number.isSafeInteger(affected) || affected !== expectedRows) throw new OperationalRankingWriteError('concurrency_conflict', 'Concurrency conflict during owner parking');
    return affected;
  }

  async listTicketsByIds(ticketIds: readonly number[]): Promise<readonly OperationalRankingMutationTicket[]> {
    if (!Array.isArray(ticketIds) || ticketIds.length > 200) {
      throw new OperationalRankingWriteError('invalid_input', 'Invalid ticketIds array');
    }
    if (ticketIds.length === 0) return Object.freeze([]);

    const set = new Set<number>();
    for (let i = 0; i < ticketIds.length; i++) {
      const id = ticketIds[i];
      if (!isValidId(id)) throw new OperationalRankingWriteError('invalid_input', 'Invalid ticket ID in array');
      if (set.has(id)) throw new OperationalRankingWriteError('invalid_input', 'Duplicate ticket ID');
      set.add(id);
    }

    const jsonParam = JSON.stringify(Array.from(set));

    const sql = `
      SELECT
        t.[ticket_id],
        t.[is_sistemas_scope],
        t.[status],
        t.[status_label],
        t.[detected_sector],
        t.[detected_sector_group_id]
      FROM [prioglpi].[glpi_ticket_cache] t
      INNER JOIN OPENJSON(@json) WITH ([ticket_id] INT '$') j ON t.[ticket_id] = j.[ticket_id]
      ORDER BY t.[ticket_id] ASC
    `;
    const params: SqlParameter[] = [
      { name: 'json', type: 'nvarchar', length: 'MAX', nullable: false, value: jsonParam }
    ];

    const rows = await this.tx.query(sql, params);
    const results: OperationalRankingMutationTicket[] = [];

    let lastId = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row === undefined) continue;

      validateExactKeys(row, [
        'ticket_id', 'is_sistemas_scope', 'status', 'status_label',
        'detected_sector', 'detected_sector_group_id'
      ]);

      const id = row['ticket_id'];
      const isScope = row['is_sistemas_scope'];
      const status = row['status'];
      const label = row['status_label'];
      const sector = row['detected_sector'];
      const groupId = row['detected_sector_group_id'];

      if (
        !isValidId(id) ||
        !isValidSqlInt(status) ||
        !isValidStringField(label, 255) ||
        !isValidStringField(sector, 255) ||
        (groupId !== null && !isValidId(groupId))
      ) {
        throw new OperationalRankingWriteError('corrupt_data', 'Corrupt ticket data');
      }

      if (id <= lastId) {
        throw new OperationalRankingWriteError('corrupt_data', 'Tickets out of order or duplicated');
      }
      if (!set.has(id)) {
        throw new OperationalRankingWriteError('corrupt_data', 'Returned ticket not in input');
      }
      lastId = id;

      results.push(Object.freeze({
        ticketId: id,
        isSistemasScope: extractBit(isScope),
        status,
        statusLabel: label,
        detectedSector: sector,
        detectedSectorGroupId: groupId
      }));
    }

    return Object.freeze(results);
  }
}
