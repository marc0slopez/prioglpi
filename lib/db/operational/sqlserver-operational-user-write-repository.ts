import type { ISqlServerTransaction, SqlParameter } from '../sqlserver-runtime-contract';
import { IOperationalUserWriteRepository, OperationalUserWriteError } from './operational-user-write-repository';
import type {
  OperationalUserCreateInput,
  OperationalUserUpdateInput,
  OperationalUserScopeInput
} from './operational-user-types';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class SqlServerOperationalUserWriteRepository implements IOperationalUserWriteRepository {
  /**
   * IMPORTANT:
   * - This repository must receive an ISqlServerTransaction obtained via ISqlServerRuntime.withTransaction().
   * - It does NOT open, commit, or rollback transactions.
   * - updateUser and replaceScopes are only atomic when they share the exact same transaction instance.
   * - Do not construct this repository using a global session for compound operations.
   */
  constructor(private readonly tx: ISqlServerTransaction) {}

  private validateId(id: unknown): number {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
      throw new OperationalUserWriteError('invalid_input', 'Invalid ID.');
    }
    return id;
  }

  private validateString(val: unknown, maxLength: number, doTrim: boolean): string {
    if (typeof val !== 'string') {
      throw new OperationalUserWriteError('invalid_input', 'Invalid string.');
    }
    const result = doTrim ? val.trim() : val;
    if (result.length === 0) {
      throw new OperationalUserWriteError('invalid_input', 'String cannot be empty.');
    }
    if (result.length > maxLength) {
      throw new OperationalUserWriteError('invalid_input', 'String exceeds maximum length.');
    }
    if (/[\x00-\x1F\x7F]/.test(result)) {
      throw new OperationalUserWriteError('invalid_input', 'String contains control characters.');
    }
    return result;
  }

  private validateRole(val: unknown): 'admin' | 'coordinador_sistemas' | 'priorizador' | 'referente' | 'system' | 'tecnico_sistemas' {
    const s = this.validateString(val, 50, false);
    if (s === 'admin' || s === 'coordinador_sistemas' || s === 'priorizador' || s === 'referente' || s === 'system' || s === 'tecnico_sistemas') {
      return s as 'admin' | 'coordinador_sistemas' | 'priorizador' | 'referente' | 'system' | 'tecnico_sistemas';
    }
    throw new OperationalUserWriteError('invalid_input', 'Invalid role.');
  }

  private validateAuthSource(val: unknown): 'local' | 'ad' | 'system' {
    const s = this.validateString(val, 50, false);
    if (s === 'local' || s === 'ad' || s === 'system') {
      return s;
    }
    throw new OperationalUserWriteError('invalid_input', 'Invalid auth source.');
  }

  private validateBoolean(val: unknown): boolean {
    if (typeof val !== 'boolean') {
      throw new OperationalUserWriteError('invalid_input', 'Invalid boolean.');
    }
    return val;
  }

  private validateDate(val: unknown): Date {
    if (!(val instanceof Date) || isNaN(val.getTime())) {
      throw new OperationalUserWriteError('invalid_input', 'Invalid Date.');
    }
    return new Date(val.getTime());
  }

  private validateRowsAffected(rowsAffected: unknown, minAllowed: number): number {
    if (typeof rowsAffected !== 'number' || !Number.isSafeInteger(rowsAffected) || rowsAffected < minAllowed) {
      throw new OperationalUserWriteError('unexpected_result', 'Malformed or negative rowsAffected.');
    }
    return rowsAffected;
  }

  private validateCreateInput(input: unknown): OperationalUserCreateInput {
    if (!isRecord(input)) throw new OperationalUserWriteError('invalid_input', 'Invalid input object.');

    const allowedKeys = new Set([
      'username', 'passwordHash', 'displayName', 'role', 'isActive',
      'glpiUserId', 'adObjectId', 'email', 'authSource', 'directoryActive',
      'directoryStatusCheckedAt', 'createdAt', 'updatedAt'
    ]);

    for (const key of Object.keys(input)) {
      if (!allowedKeys.has(key)) throw new OperationalUserWriteError('invalid_input', 'Unknown property in create input.');
    }

    if (!Object.prototype.hasOwnProperty.call(input, 'username')) throw new OperationalUserWriteError('invalid_input', 'Missing username.');
    if (!Object.prototype.hasOwnProperty.call(input, 'displayName')) throw new OperationalUserWriteError('invalid_input', 'Missing displayName.');
    if (!Object.prototype.hasOwnProperty.call(input, 'role')) throw new OperationalUserWriteError('invalid_input', 'Missing role.');
    if (!Object.prototype.hasOwnProperty.call(input, 'isActive')) throw new OperationalUserWriteError('invalid_input', 'Missing isActive.');
    if (!Object.prototype.hasOwnProperty.call(input, 'authSource')) throw new OperationalUserWriteError('invalid_input', 'Missing authSource.');
    if (!Object.prototype.hasOwnProperty.call(input, 'createdAt')) throw new OperationalUserWriteError('invalid_input', 'Missing createdAt.');
    if (!Object.prototype.hasOwnProperty.call(input, 'updatedAt')) throw new OperationalUserWriteError('invalid_input', 'Missing updatedAt.');

    return {
      username: this.validateString(input.username, 255, true),
      passwordHash: input.passwordHash === null ? null : this.validateString(input.passwordHash, 255, false),
      displayName: this.validateString(input.displayName, 255, true),
      role: this.validateRole(input.role),
      isActive: this.validateBoolean(input.isActive),
      glpiUserId: input.glpiUserId === null ? null : this.validateId(input.glpiUserId),
      adObjectId: input.adObjectId === null ? null : this.validateString(input.adObjectId, 255, false),
      email: input.email === null ? null : this.validateString(input.email, 255, false),
      authSource: this.validateAuthSource(input.authSource),
      directoryActive: input.directoryActive === null ? null : this.validateBoolean(input.directoryActive),
      directoryStatusCheckedAt: input.directoryStatusCheckedAt === null ? null : this.validateDate(input.directoryStatusCheckedAt),
      createdAt: this.validateDate(input.createdAt),
      updatedAt: this.validateDate(input.updatedAt)
    };
  }

  private validateUpdateInput(input: unknown): OperationalUserUpdateInput {
    if (!isRecord(input)) throw new OperationalUserWriteError('invalid_input', 'Invalid input object.');

    const allowedKeys = new Set([
      'passwordHash', 'displayName', 'role', 'isActive',
      'glpiUserId', 'email', 'directoryActive', 'directoryStatusCheckedAt', 'updatedAt'
    ]);

    for (const key of Object.keys(input)) {
      if (!allowedKeys.has(key)) throw new OperationalUserWriteError('invalid_input', 'Unknown property in update input.');
    }

    if (!Object.prototype.hasOwnProperty.call(input, 'updatedAt')) {
      throw new OperationalUserWriteError('invalid_input', 'Missing updatedAt.');
    }
    const updatedAt = this.validateDate(input.updatedAt);

    const result: OperationalUserUpdateInput = { updatedAt };
    let hasMutable = false;

    if (Object.prototype.hasOwnProperty.call(input, 'passwordHash')) {
      result.passwordHash = input.passwordHash === null ? null : this.validateString(input.passwordHash, 255, false);
      hasMutable = true;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'displayName')) {
      result.displayName = this.validateString(input.displayName, 255, true);
      hasMutable = true;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'role')) {
      result.role = this.validateRole(input.role);
      hasMutable = true;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'isActive')) {
      result.isActive = this.validateBoolean(input.isActive);
      hasMutable = true;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'glpiUserId')) {
      result.glpiUserId = input.glpiUserId === null ? null : this.validateId(input.glpiUserId);
      hasMutable = true;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'email')) {
      result.email = input.email === null ? null : this.validateString(input.email, 255, false);
      hasMutable = true;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'directoryActive')) {
      result.directoryActive = input.directoryActive === null ? null : this.validateBoolean(input.directoryActive);
      hasMutable = true;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'directoryStatusCheckedAt')) {
      result.directoryStatusCheckedAt = input.directoryStatusCheckedAt === null ? null : this.validateDate(input.directoryStatusCheckedAt);
      hasMutable = true;
    }

    if (!hasMutable) throw new OperationalUserWriteError('invalid_input', 'No mutable fields provided for update.');

    return result;
  }

  private validateScopesInput(scopes: unknown): readonly OperationalUserScopeInput[] {
    if (!Array.isArray(scopes)) throw new OperationalUserWriteError('invalid_input', 'Scopes must be an array.');

    const validatedScopes: OperationalUserScopeInput[] = [];
    const sectorNames = new Set<string>();
    const glpiGroupIds = new Set<number>();

    for (const scope of scopes) {
      if (!isRecord(scope)) throw new OperationalUserWriteError('invalid_input', 'Invalid scope object.');

      const allowedKeys = new Set(['sectorName', 'glpiGroupId']);
      for (const key of Object.keys(scope)) {
        if (!allowedKeys.has(key)) throw new OperationalUserWriteError('invalid_input', 'Unknown property in scope.');
      }

      if (!Object.prototype.hasOwnProperty.call(scope, 'sectorName')) throw new OperationalUserWriteError('invalid_input', 'Missing sectorName.');
      if (!Object.prototype.hasOwnProperty.call(scope, 'glpiGroupId')) throw new OperationalUserWriteError('invalid_input', 'Missing glpiGroupId.');

      const sectorName = this.validateString(scope.sectorName, 255, true);
      const glpiGroupId = scope.glpiGroupId === null ? null : this.validateId(scope.glpiGroupId);

      const normName = sectorName.toLowerCase();
      if (sectorNames.has(normName)) throw new OperationalUserWriteError('invalid_input', 'Duplicate sectorName.');
      sectorNames.add(normName);

      if (glpiGroupId !== null) {
        if (glpiGroupIds.has(glpiGroupId)) throw new OperationalUserWriteError('invalid_input', 'Duplicate glpiGroupId.');
        glpiGroupIds.add(glpiGroupId);
      }

      validatedScopes.push({ sectorName, glpiGroupId });
    }
    return validatedScopes;
  }

  async createUser(input: unknown): Promise<number> {
    const data = this.validateCreateInput(input);

    const sql = `
      INSERT INTO [prioglpi].[app_user] (
        [username], [password_hash], [display_name], [role], [is_active], [glpi_user_id], [ad_object_id],
        [email], [auth_source], [directory_active], [directory_status_checked_at], [created_at], [updated_at]
      )
      OUTPUT INSERTED.[id] AS [id]
      VALUES (
        @username, @passwordHash, @displayName, @role, @isActive, @glpiUserId, @adObjectId,
        @email, @authSource, @directoryActive, @directoryStatusCheckedAt, @createdAt, @updatedAt
      )
    `;

    const params: SqlParameter[] = [
      { name: 'username', type: 'nvarchar', nullable: false, value: data.username, length: 255 },
      { name: 'passwordHash', type: 'nvarchar', nullable: true, value: data.passwordHash, length: 255 },
      { name: 'displayName', type: 'nvarchar', nullable: false, value: data.displayName, length: 255 },
      { name: 'role', type: 'nvarchar', nullable: false, value: data.role, length: 50 },
      { name: 'isActive', type: 'bit', nullable: false, value: data.isActive },
      { name: 'glpiUserId', type: 'int', nullable: true, value: data.glpiUserId },
      { name: 'adObjectId', type: 'nvarchar', nullable: true, value: data.adObjectId, length: 255 },
      { name: 'email', type: 'nvarchar', nullable: true, value: data.email, length: 255 },
      { name: 'authSource', type: 'nvarchar', nullable: false, value: data.authSource, length: 50 },
      { name: 'directoryActive', type: 'bit', nullable: true, value: data.directoryActive },
      { name: 'directoryStatusCheckedAt', type: 'datetime2', nullable: true, value: data.directoryStatusCheckedAt, scale: 3 },
      { name: 'createdAt', type: 'datetime2', nullable: false, value: data.createdAt, scale: 3 },
      { name: 'updatedAt', type: 'datetime2', nullable: false, value: data.updatedAt, scale: 3 }
    ];

    const rows = await this.tx.query(sql, params);

    if (rows.length !== 1) {
      if (process.env.AUTH_DIAGNOSTICS === 'true') {
        console.log(`[AUTH_DIAGNOSTIC] create_user.rows.${rows.length}`);
      }
      throw new OperationalUserWriteError('unexpected_result', 'Unexpected number of rows returned by create.');
    }
    const rawId = rows[0]?.id;
    let parsedId: number | null = null;

    if (typeof rawId === 'number') {
      if (Number.isSafeInteger(rawId) && rawId >= 1 && rawId <= 2147483647) {
        parsedId = rawId;
      }
    } else if (typeof rawId === 'string') {
      if (/^[1-9]\d*$/.test(rawId)) {
        const num = Number(rawId);
        if (Number.isSafeInteger(num) && num >= 1 && num <= 2147483647) {
          parsedId = num;
        }
      }
    }

    if (parsedId === null) {
      if (process.env.AUTH_DIAGNOSTICS === 'true') {
        const idType = rawId === null || rawId === undefined ? 'null' : typeof rawId;
        console.log(`[AUTH_DIAGNOSTIC] create_user.id_type.${idType}`);
      }
      throw new OperationalUserWriteError('unexpected_result', 'Malformed ID returned by create.');
    }

    return parsedId;
  }

  async updateUser(id: unknown, input: unknown): Promise<'updated' | 'not_found'> {
    const validId = this.validateId(id);
    const data = this.validateUpdateInput(input);

    const setClauses: string[] = [];
    const params: SqlParameter[] = [
      { name: 'id', type: 'int', nullable: false, value: validId }
    ];

    if ('passwordHash' in data) {
      setClauses.push('[password_hash] = @passwordHash');
      params.push({ name: 'passwordHash', type: 'nvarchar', nullable: true, value: data.passwordHash!, length: 255 });
    }
    if ('displayName' in data) {
      setClauses.push('[display_name] = @displayName');
      params.push({ name: 'displayName', type: 'nvarchar', nullable: false, value: data.displayName!, length: 255 });
    }
    if ('role' in data) {
      setClauses.push('[role] = @role');
      params.push({ name: 'role', type: 'nvarchar', nullable: false, value: data.role!, length: 50 });
    }
    if ('isActive' in data) {
      setClauses.push('[is_active] = @isActive');
      params.push({ name: 'isActive', type: 'bit', nullable: false, value: data.isActive! });
    }
    if ('glpiUserId' in data) {
      setClauses.push('[glpi_user_id] = @glpiUserId');
      params.push({ name: 'glpiUserId', type: 'int', nullable: true, value: data.glpiUserId! });
    }
    if ('email' in data) {
      setClauses.push('[email] = @email');
      params.push({ name: 'email', type: 'nvarchar', nullable: true, value: data.email!, length: 255 });
    }
    if ('directoryActive' in data) {
      setClauses.push('[directory_active] = @directoryActive');
      params.push({ name: 'directoryActive', type: 'bit', nullable: true, value: data.directoryActive! });
    }
    if ('directoryStatusCheckedAt' in data) {
      setClauses.push('[directory_status_checked_at] = @directoryStatusCheckedAt');
      params.push({ name: 'directoryStatusCheckedAt', type: 'datetime2', nullable: true, value: data.directoryStatusCheckedAt!, scale: 3 });
    }

    setClauses.push('[updated_at] = @updatedAt');
    params.push({ name: 'updatedAt', type: 'datetime2', nullable: false, value: data.updatedAt, scale: 3 });

    const sql = `UPDATE [prioglpi].[app_user] SET ${setClauses.join(', ')} WHERE [id] = @id`;

    const rowsAffected = await this.tx.execute(sql, params);
    this.validateRowsAffected(rowsAffected, 0);

    if (rowsAffected === 0) return 'not_found';
    if (rowsAffected === 1) return 'updated';
    throw new OperationalUserWriteError('unexpected_result', 'Unexpected number of affected rows on update.');
  }

  async replaceScopes(userId: unknown, scopes: unknown): Promise<void> {
    const validUserId = this.validateId(userId);
    const validatedScopes = this.validateScopesInput(scopes);

    const delAffected = await this.tx.execute(
      'DELETE FROM [prioglpi].[user_sector_scope] WHERE [user_id] = @userId',
      [{ name: 'userId', type: 'int', nullable: false, value: validUserId }]
    );
    this.validateRowsAffected(delAffected, 0);

    for (const scope of validatedScopes) {
      const insAffected = await this.tx.execute(
        'INSERT INTO [prioglpi].[user_sector_scope] ([user_id], [sector_name], [glpi_group_id]) VALUES (@userId, @sectorName, @glpiGroupId)',
        [
          { name: 'userId', type: 'int', nullable: false, value: validUserId },
          { name: 'sectorName', type: 'nvarchar', nullable: false, value: scope.sectorName, length: 255 },
          { name: 'glpiGroupId', type: 'int', nullable: true, value: scope.glpiGroupId }
        ]
      );
      this.validateRowsAffected(insAffected, 0);
      if (insAffected !== 1) {
        throw new OperationalUserWriteError('unexpected_result', 'Unexpected number of affected rows on scope insert.');
      }
    }
  }

  async replaceReferentAssignments(userId: unknown, glpiGroupIds: unknown): Promise<void> {
    const validUserId = this.validateId(userId);
    if (!Array.isArray(glpiGroupIds)) throw new OperationalUserWriteError('invalid_input', 'glpiGroupIds must be an array.');

    const validGroupIds = new Set<number>();
    for (const gid of glpiGroupIds) {
      if (gid === null) continue;
      validGroupIds.add(this.validateId(gid));
    }

    const delAffected = await this.tx.execute(
      'DELETE FROM [prioglpi].[sector_referent_assignment] WHERE [referent_user_id] = @userId',
      [{ name: 'userId', type: 'int', nullable: false, value: validUserId }]
    );
    this.validateRowsAffected(delAffected, 0);

    for (const gId of validGroupIds) {
      const insAffected = await this.tx.execute(
        'INSERT INTO [prioglpi].[sector_referent_assignment] ([glpi_group_id], [referent_user_id]) VALUES (@glpiGroupId, @userId)',
        [
          { name: 'glpiGroupId', type: 'int', nullable: false, value: gId },
          { name: 'userId', type: 'int', nullable: false, value: validUserId }
        ]
      );
      this.validateRowsAffected(insAffected, 0);
      if (insAffected !== 1) {
        throw new OperationalUserWriteError('unexpected_result', 'Unexpected number of affected rows on referent assignment insert.');
      }
    }
  }
}
