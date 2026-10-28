import type { ISqlServerSession, SqlParameter } from '../sqlserver-runtime-contract';
import type { IOperationalCoordinationWriteRepository, OperationalCoordinationUpsertInput } from './operational-coordination-write-repository';
import { OperationalCoordinationMutationError, type OperationalCoordinationState } from './operational-coordination-mutation-types';

function parsePositiveResultId(value: unknown): number | null {
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 2147483647
  ) return value;

  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 2147483647 ? parsed : null;
}
export class SqlServerOperationalCoordinationWriteRepository implements IOperationalCoordinationWriteRepository {
  constructor(private readonly session: ISqlServerSession) {}

  public async findByTicketId(ticketId: number): Promise<OperationalCoordinationState | null> {
    if (typeof ticketId !== 'number' || !Number.isSafeInteger(ticketId) || ticketId < 1 || ticketId > 2147483647) {
      throw new OperationalCoordinationMutationError('invalid_input', 'Invalid ticketId');
    }

    const sql = `
      SELECT TOP (2)
        c.[id],
        c.[ticket_id],
        c.[progress_percent],
        c.[coordinator_comment],
        c.[estimated_delivery_date],
        c.[updated_by_user_id],
        u.[display_name] AS updated_by_display_name,
        c.[updated_at]
      FROM [prioglpi].[ticket_coordination] c
      INNER JOIN [prioglpi].[app_user] u ON c.[updated_by_user_id] = u.[id]
      WHERE c.[ticket_id] = @ticketId
    `;

    const params: SqlParameter[] = [
      { name: 'ticketId', type: 'int', nullable: false, value: ticketId }
    ];

    const rows = await this.session.query(sql, params);

    if (rows.length === 0) {
      return null;
    }
    if (rows.length > 1) {
      throw new OperationalCoordinationMutationError('invalid_state', 'Multiple coordinations found');
    }

    const row = rows[0];
    if (!row) {
      throw new OperationalCoordinationMutationError('invalid_state', 'Corrupt row');
    }

    const id = parsePositiveResultId(row['id']);
    const tid = row['ticket_id'];
    const progressPercent = row['progress_percent'];
    const coordinatorComment = row['coordinator_comment'];
    const estimatedDeliveryDate = row['estimated_delivery_date'];
    const updatedByUserId = row['updated_by_user_id'];
    const updatedByDisplayName = row['updated_by_display_name'];
    const updatedAtRaw = row['updated_at'];

    if (id === null) {
      throw new OperationalCoordinationMutationError('invalid_state', 'Corrupt id');
    }
    if (tid !== ticketId) {
      throw new OperationalCoordinationMutationError('invalid_state', 'Mismatch ticketId');
    }
    if (typeof progressPercent !== 'number' || !Number.isSafeInteger(progressPercent) || progressPercent < 0 || progressPercent > 100) {
      throw new OperationalCoordinationMutationError('invalid_state', 'Corrupt progressPercent');
    }
    if (typeof coordinatorComment !== 'string') {
      throw new OperationalCoordinationMutationError('invalid_state', 'Corrupt coordinatorComment');
    }
    if (estimatedDeliveryDate !== null && typeof estimatedDeliveryDate !== 'string') {
      throw new OperationalCoordinationMutationError('invalid_state', 'Corrupt estimatedDeliveryDate');
    }
    if (typeof updatedByUserId !== 'number' || !Number.isSafeInteger(updatedByUserId) || updatedByUserId < 1 || updatedByUserId > 2147483647) {
      throw new OperationalCoordinationMutationError('invalid_state', 'Corrupt updatedByUserId');
    }
    if (typeof updatedByDisplayName !== 'string') {
      throw new OperationalCoordinationMutationError('invalid_state', 'Corrupt updatedByDisplayName');
    }
    if (!(updatedAtRaw instanceof Date) || Number.isNaN(updatedAtRaw.getTime())) {
      throw new OperationalCoordinationMutationError('invalid_state', 'Corrupt updatedAt');
    }

    return Object.freeze({
      id,
      ticketId: tid,
      progressPercent,
      coordinatorComment,
      estimatedDeliveryDate,
      updatedByUserId,
      updatedByDisplayName,
      updatedAt: new Date(updatedAtRaw.getTime())
    });
  }

  public async upsert(input: OperationalCoordinationUpsertInput): Promise<void> {
    if (typeof input.ticketId !== 'number' || !Number.isSafeInteger(input.ticketId) || input.ticketId < 1 || input.ticketId > 2147483647) {
      throw new OperationalCoordinationMutationError('invalid_input', 'Invalid upsert ticketId');
    }
    if (typeof input.progressPercent !== 'number' || !Number.isSafeInteger(input.progressPercent) || ![0, 25, 50, 75, 100].includes(input.progressPercent)) {
      throw new OperationalCoordinationMutationError('invalid_input', 'Invalid upsert progressPercent');
    }
    if (typeof input.coordinatorComment !== 'string') {
      throw new OperationalCoordinationMutationError('invalid_input', 'Invalid upsert coordinatorComment');
    }
    if (input.estimatedDeliveryDate !== null && typeof input.estimatedDeliveryDate !== 'string') {
      throw new OperationalCoordinationMutationError('invalid_input', 'Invalid upsert estimatedDeliveryDate');
    }
    if (typeof input.updatedByUserId !== 'number' || !Number.isSafeInteger(input.updatedByUserId) || input.updatedByUserId < 1 || input.updatedByUserId > 2147483647) {
      throw new OperationalCoordinationMutationError('invalid_input', 'Invalid upsert updatedByUserId');
    }
    if (!(input.updatedAt instanceof Date) || Number.isNaN(input.updatedAt.getTime())) {
      throw new OperationalCoordinationMutationError('invalid_input', 'Invalid upsert updatedAt');
    }

    const params: SqlParameter[] = [
      { name: 'ticketId', type: 'int', nullable: false, value: input.ticketId },
      { name: 'progressPercent', type: 'int', nullable: false, value: input.progressPercent },
      { name: 'coordinatorComment', type: 'nvarchar', length: 'MAX', nullable: false, value: input.coordinatorComment },
      { name: 'estimatedDeliveryDate', type: 'nvarchar', length: 50, nullable: true, value: input.estimatedDeliveryDate },
      { name: 'updatedByUserId', type: 'int', nullable: false, value: input.updatedByUserId },
      { name: 'updatedAt', type: 'datetime2', scale: 3, nullable: false, value: input.updatedAt }
    ];

    const updateSql = `
      UPDATE [prioglpi].[ticket_coordination]
      SET
        [progress_percent] = @progressPercent,
        [coordinator_comment] = @coordinatorComment,
        [estimated_delivery_date] = @estimatedDeliveryDate,
        [updated_by_user_id] = @updatedByUserId,
        [updated_at] = @updatedAt
      WHERE [ticket_id] = @ticketId;
    `;

    const updatedRows = await this.session.execute(updateSql, params);

    if (updatedRows !== 0 && updatedRows !== 1) {
      throw new OperationalCoordinationMutationError('invalid_state', 'Unexpected update rows affected');
    }

    if (updatedRows === 0) {
      const insertSql = `
        INSERT INTO [prioglpi].[ticket_coordination] (
          [ticket_id],
          [progress_percent],
          [coordinator_comment],
          [estimated_delivery_date],
          [updated_by_user_id],
          [updated_at]
        ) VALUES (
          @ticketId,
          @progressPercent,
          @coordinatorComment,
          @estimatedDeliveryDate,
          @updatedByUserId,
          @updatedAt
        );
      `;
      const insertedRows = await this.session.execute(insertSql, params);

      if (insertedRows !== 1) {
        throw new OperationalCoordinationMutationError('invalid_state', 'Unexpected insert rows affected');
      }
    }
  }
}
