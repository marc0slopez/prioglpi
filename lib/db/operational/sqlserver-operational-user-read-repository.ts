import type { ISqlServerSession, SqlRow, SqlParameter } from '../sqlserver-runtime-contract';
import { IOperationalUserReadRepository, OperationalUserReadError } from './operational-user-read-repository';
import type {
  OperationalUser,
  OperationalUserRole,
  OperationalUserSectorScope,
  OperationalUserWithScopes,
  OperationalUserAuthSource
} from './operational-user-types';

const SELECT_USER_COLUMNS = `
  u.[id],
  u.[username],
  u.[password_hash],
  u.[display_name],
  u.[role],
  u.[is_active],
  u.[glpi_user_id],
  u.[ad_object_id],
  u.[email],
  u.[auth_source],
  u.[directory_active],
  u.[directory_status_checked_at],
  u.[created_at],
  u.[updated_at]
`;

export function validateOperationalUserRoles(roles: unknown): readonly OperationalUserRole[] {
  if (!Array.isArray(roles) || roles.length < 1 || roles.length > 6) {
    throw new OperationalUserReadError('invalid_input', 'Invalid roles parameter.');
  }
  const uniqueRoles = new Set<string>();
  const parsedRoles: OperationalUserRole[] = [];

  for (const r of roles) {
    if (typeof r !== 'string' || (r !== 'admin' && r !== 'coordinador_sistemas' && r !== 'priorizador' && r !== 'referente' && r !== 'system' && r !== 'tecnico_sistemas')) {
      throw new OperationalUserReadError('invalid_input', 'Invalid role provided.');
    }
    if (uniqueRoles.has(r)) {
      throw new OperationalUserReadError('invalid_input', 'Duplicate role provided.');
    }
    uniqueRoles.add(r);
    parsedRoles.push(r as OperationalUserRole);
  }

  return parsedRoles;
}

export class SqlServerOperationalUserReadRepository implements IOperationalUserReadRepository {
  constructor(private readonly session: ISqlServerSession) {}

  private validateId(id: unknown): number {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
      throw new OperationalUserReadError('invalid_input', 'Invalid ID.');
    }
    return id;
  }

  private validateString(val: unknown, maxLength: number): string {
    if (typeof val !== 'string') {
      throw new OperationalUserReadError('invalid_input', 'Invalid string.');
    }
    const trimmed = val.trim();
    if (trimmed.length === 0) {
      throw new OperationalUserReadError('invalid_input', 'String cannot be empty.');
    }
    if (trimmed.length > maxLength) {
      throw new OperationalUserReadError('invalid_input', 'String exceeds maximum length.');
    }
    if (/[\x00-\x1F\x7F]/.test(trimmed)) {
      throw new OperationalUserReadError('invalid_input', 'String contains control characters.');
    }
    return trimmed;
  }

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
    throw new OperationalUserReadError('corrupt_data', 'Corrupted database integer.');
  }

  private parseString(val: unknown, maxLength: number, allowEmpty: boolean): string {
    if (typeof val !== 'string') throw new OperationalUserReadError('corrupt_data', 'Corrupted database string.');
    if (val.length > maxLength) throw new OperationalUserReadError('corrupt_data', 'Corrupted database string length.');
    if (!allowEmpty && val.trim().length === 0) throw new OperationalUserReadError('corrupt_data', 'Corrupted database empty string.');
    if (/[\x00-\x1F\x7F]/.test(val)) throw new OperationalUserReadError('corrupt_data', 'Corrupted database string with control chars.');
    return val;
  }

  private parseBoolean(val: unknown): boolean {
    if (val === true || val === 1) return true;
    if (val === false || val === 0) return false;
    throw new OperationalUserReadError('corrupt_data', 'Corrupted database boolean.');
  }

  private parseDate(val: unknown): Date {
    if (!(val instanceof Date) || isNaN(val.getTime())) {
      throw new OperationalUserReadError('corrupt_data', 'Corrupted database date.');
    }
    return new Date(val.getTime());
  }

  private parseRole(val: unknown): OperationalUserRole {
    const s = this.parseString(val, 50, false);
    if (s === 'admin' || s === 'coordinador_sistemas' || s === 'priorizador' || s === 'referente' || s === 'system' || s === 'tecnico_sistemas') {
      return s;
    }
    throw new OperationalUserReadError('corrupt_data', 'Corrupted database role.');
  }

  private parseAuthSource(val: unknown): OperationalUserAuthSource {
    const s = this.parseString(val, 50, false);
    if (s === 'local' || s === 'ad' || s === 'system') {
      return s;
    }
    throw new OperationalUserReadError('corrupt_data', 'Corrupted database auth source.');
  }

  private parseUser(row: SqlRow): OperationalUser {
    return {
      id: this.parsePositiveInt(row.id),
      username: this.parseString(row.username, 255, false),
      passwordHash: row.password_hash === null ? null : this.parseString(row.password_hash, 255, true),
      displayName: this.parseString(row.display_name, 255, false),
      role: this.parseRole(row.role),
      isActive: this.parseBoolean(row.is_active),
      glpiUserId: row.glpi_user_id === null ? null : this.parsePositiveInt(row.glpi_user_id),
      adObjectId: row.ad_object_id === null ? null : this.parseString(row.ad_object_id, 255, false),
      email: row.email === null ? null : this.parseString(row.email, 255, true),
      authSource: this.parseAuthSource(row.auth_source),
      directoryActive: row.directory_active === null ? null : this.parseBoolean(row.directory_active),
      directoryStatusCheckedAt: row.directory_status_checked_at === null ? null : this.parseDate(row.directory_status_checked_at),
      createdAt: this.parseDate(row.created_at),
      updatedAt: this.parseDate(row.updated_at)
    };
  }

  async findById(id: number): Promise<OperationalUser | null> {
    this.validateId(id);

    const rows = await this.session.query(`
      SELECT TOP (2) ${SELECT_USER_COLUMNS}
      FROM [prioglpi].[app_user] u
      WHERE u.[id] = @id
    `, [{ name: 'id', type: 'int', nullable: false, value: id }]);

    if (rows.length === 0) return null;
    if (rows.length > 1) throw new OperationalUserReadError('ambiguous_result', 'Ambiguous user identity.');

    return this.parseUser(rows[0]);
  }

  async findByUsername(username: string): Promise<OperationalUser | null> {
    const u = this.validateString(username, 255);

    const rows = await this.session.query(`
      SELECT TOP (2) ${SELECT_USER_COLUMNS}
      FROM [prioglpi].[app_user] u
      WHERE u.[username] = @username
    `, [{ name: 'username', type: 'nvarchar', nullable: false, value: u, length: 255 }]);

    if (rows.length === 0) return null;
    if (rows.length > 1) throw new OperationalUserReadError('ambiguous_result', 'Ambiguous user identity by username.');

    return this.parseUser(rows[0]);
  }

  async findByGlpiUserId(glpiUserId: number): Promise<OperationalUser | null> {
    this.validateId(glpiUserId);

    const rows = await this.session.query(`
      SELECT TOP (2) ${SELECT_USER_COLUMNS}
      FROM [prioglpi].[app_user] u
      WHERE u.[glpi_user_id] = @glpiUserId
    `, [{ name: 'glpiUserId', type: 'int', nullable: false, value: glpiUserId }]);

    if (rows.length === 0) return null;
    if (rows.length > 1) throw new OperationalUserReadError('ambiguous_result', 'Ambiguous user identity by GLPI ID.');

    return this.parseUser(rows[0]);
  }

  async findCandidatesByUsernameOrAdObjectId(username: string, adObjectId: string): Promise<readonly OperationalUser[]> {
    const u = this.validateString(username, 255);
    const a = this.validateString(adObjectId, 255);

    const rows = await this.session.query(`
      SELECT TOP (3) ${SELECT_USER_COLUMNS}
      FROM [prioglpi].[app_user] u
      WHERE u.[username] = @username OR u.[ad_object_id] = @adObjectId
      ORDER BY u.[id] ASC
    `, [
      { name: 'username', type: 'nvarchar', nullable: false, value: u, length: 255 },
      { name: 'adObjectId', type: 'nvarchar', nullable: false, value: a, length: 255 }
    ]);

    if (rows.length === 0) return [];
    if (rows.length > 2) throw new OperationalUserReadError('corrupt_data', 'Corrupted DB: too many candidate users found.');

    return rows.map(r => this.parseUser(r));
  }

  async findByIdWithScopes(id: number): Promise<OperationalUserWithScopes | null> {
    this.validateId(id);

    const rows = await this.session.query(`
      SELECT
        ${SELECT_USER_COLUMNS},
        s.[id] as scope_id,
        s.[user_id] as scope_user_id,
        s.[sector_name] as scope_sector_name,
        s.[glpi_group_id] as scope_glpi_group_id
      FROM [prioglpi].[app_user] u
      LEFT JOIN [prioglpi].[user_sector_scope] s ON u.[id] = s.[user_id]
      WHERE u.[id] = @id
      ORDER BY s.[id] ASC
    `, [{ name: 'id', type: 'int', nullable: false, value: id }]);

    if (rows.length === 0) return null;

    const user = this.parseUser(rows[0]);

    for (const r of rows) {
      const u = this.parseUser(r);
      if (
        u.id !== user.id ||
        u.username !== user.username ||
        u.passwordHash !== user.passwordHash ||
        u.displayName !== user.displayName ||
        u.role !== user.role ||
        u.isActive !== user.isActive ||
        u.glpiUserId !== user.glpiUserId ||
        u.adObjectId !== user.adObjectId ||
        u.email !== user.email ||
        u.authSource !== user.authSource ||
        u.directoryActive !== user.directoryActive ||
        u.directoryStatusCheckedAt?.getTime() !== user.directoryStatusCheckedAt?.getTime() ||
        u.createdAt.getTime() !== user.createdAt.getTime() ||
        u.updatedAt.getTime() !== user.updatedAt.getTime()
      ) {
        throw new OperationalUserReadError('corrupt_data', 'Corrupted database: user fields mismatch across joined rows.');
      }
    }

    const scopes: OperationalUserSectorScope[] = [];
    const scopeIds = new Set<number>();
    const sectorNames = new Set<string>();
    const glpiGroupIds = new Set<number>();
    let lastId = -1;

    for (const row of rows) {
      if (row.scope_id === null) {
        if (row.scope_user_id !== null || row.scope_sector_name !== null || row.scope_glpi_group_id !== null) {
          throw new OperationalUserReadError('corrupt_data', 'Corrupted database: partial null scope row.');
        }
      } else {
        if (row.scope_user_id === null || row.scope_sector_name === null) {
          throw new OperationalUserReadError('corrupt_data', 'Corrupted database: scope missing mandatory fields.');
        }

        const scopeUserId = this.parsePositiveInt(row.scope_user_id);
        if (scopeUserId !== user.id) throw new OperationalUserReadError('corrupt_data', 'Corrupted database: scope user_id mismatch.');

        const scopeId = this.parsePositiveInt(row.scope_id);
        const sectorName = this.parseString(row.scope_sector_name, 255, false);
        const glpiGroupId = row.scope_glpi_group_id === null ? null : this.parsePositiveInt(row.scope_glpi_group_id);

        if (scopeIds.has(scopeId)) throw new OperationalUserReadError('corrupt_data', 'Corrupted database: duplicate scope ID.');

        const normalizedSectorName = sectorName.trim().toLowerCase();
        if (sectorNames.has(normalizedSectorName)) throw new OperationalUserReadError('corrupt_data', 'Corrupted database: duplicate scope sector name.');

        if (glpiGroupId !== null) {
          if (glpiGroupIds.has(glpiGroupId)) throw new OperationalUserReadError('corrupt_data', 'Corrupted database: duplicate scope GLPI group ID.');
          glpiGroupIds.add(glpiGroupId);
        }

        scopeIds.add(scopeId);
        sectorNames.add(normalizedSectorName);

        if (scopeId <= lastId) throw new OperationalUserReadError('corrupt_data', 'Corrupted database: scopes unordered.');
        lastId = scopeId;

        scopes.push({
          id: scopeId,
          userId: scopeUserId,
          sectorName: sectorName,
          glpiGroupId: glpiGroupId
        });
      }
    }

    return { ...user, sectorScopes: scopes };
  }

  async listActiveByRoles(roles: unknown): Promise<readonly OperationalUser[]> {
    const parsedRoles = validateOperationalUserRoles(roles);

    const params: SqlParameter[] = [];
    const paramNames: string[] = [];
    parsedRoles.forEach((r, i) => {
      params.push({ name: `role${i}`, type: 'nvarchar', nullable: false, value: r, length: 50 });
      paramNames.push(`@role${i}`);
    });

    const rows = await this.session.query(`
      SELECT ${SELECT_USER_COLUMNS}
      FROM [prioglpi].[app_user] u
      WHERE u.[is_active] = 1 AND u.[role] IN (${paramNames.join(', ')})
      ORDER BY u.[id] ASC
    `, params);

    return rows.map(r => this.parseUser(r));
  }

  async listAllUsersWithScopes(): Promise<readonly OperationalUserWithScopes[]> {
    const rows = await this.session.query(`
      SELECT
        ${SELECT_USER_COLUMNS},
        s.[id] as scope_id,
        s.[user_id] as scope_user_id,
        s.[sector_name] as scope_sector_name,
        s.[glpi_group_id] as scope_glpi_group_id
      FROM [prioglpi].[app_user] u
      LEFT JOIN [prioglpi].[user_sector_scope] s ON u.[id] = s.[user_id]
      ORDER BY u.[id] ASC, s.[id] ASC
    `, []);

    type MutableScope = {
      id: number;
      userId: number;
      sectorName: string;
      glpiGroupId: number | null;
    };

    const usersMap = new Map<number, { user: OperationalUser; scopes: MutableScope[] }>();

    for (const row of rows) {
      const u = this.parseUser(row);
      let entry = usersMap.get(u.id);
      if (!entry) {
        entry = { user: u, scopes: [] };
        usersMap.set(u.id, entry);
      }

      if (row.scope_id !== null) {
        const scopeId = this.parsePositiveInt(row.scope_id);
        const scopeUserId = this.parsePositiveInt(row.scope_user_id);
        const sectorName = this.parseString(row.scope_sector_name, 255, false);
        const glpiGroupId = row.scope_glpi_group_id === null ? null : this.parsePositiveInt(row.scope_glpi_group_id);

        entry.scopes.push({
          id: scopeId,
          userId: scopeUserId,
          sectorName: sectorName,
          glpiGroupId: glpiGroupId
        });
      }
    }

    const result: OperationalUserWithScopes[] = [];
    for (const entry of usersMap.values()) {
      result.push(Object.freeze({
        ...entry.user,
        sectorScopes: Object.freeze([...entry.scopes])
      }));
    }

    return Object.freeze(result);
  }

  async listReferentAssignmentsByGroupId(glpiGroupId: number): Promise<readonly { id: number; referentUserId: number; referentDisplayName: string }[]> {
    this.validateId(glpiGroupId);
    const rows = await this.session.query(`
      SELECT
        ra.[id],
        ra.[referent_user_id],
        u.[display_name] as referent_display_name
      FROM [prioglpi].[sector_referent_assignment] ra
      INNER JOIN [prioglpi].[app_user] u ON ra.[referent_user_id] = u.[id]
      WHERE ra.[glpi_group_id] = @glpiGroupId
      ORDER BY ra.[id] ASC
    `, [{ name: 'glpiGroupId', type: 'int', nullable: false, value: glpiGroupId }]);

    return rows.map(r => ({
      id: this.parsePositiveInt(r.id),
      referentUserId: this.parsePositiveInt(r.referent_user_id),
      referentDisplayName: this.parseString(r.referent_display_name, 255, false)
    }));
  }

  async checkGlpiUserExists(glpiUserId: number): Promise<boolean> {
    this.validateId(glpiUserId);
    const rows = await this.session.query(`
      SELECT TOP (1) 1
      FROM [prioglpi].[glpi_user_cache]
      WHERE [glpi_user_id] = @id
    `, [{ name: 'id', type: 'int', nullable: false, value: glpiUserId }]);
    return rows.length > 0;
  }

  async checkGlpiGroupExists(glpiGroupId: number): Promise<boolean> {
    this.validateId(glpiGroupId);
    const rows = await this.session.query(`
      SELECT TOP (1) 1
      FROM [prioglpi].[glpi_group_cache]
      WHERE [group_id] = @id
    `, [{ name: 'id', type: 'int', nullable: false, value: glpiGroupId }]);
    return rows.length > 0;
  }
}
