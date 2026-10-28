import type { ISqlServerSession, SqlParameter } from '../sqlserver-runtime-contract';
import type { IOperationalTicketFilterOptionsRepository } from './operational-ticket-filter-options-repository';
import { OperationalTicketFilterOptionsError } from './operational-ticket-filter-options-repository';
import type {
  OperationalFilterOption,
  OperationalReferentOption,
  OperationalReferentGroupOption
} from './operational-ticket-filter-options-types';

function isPositiveSqlInt(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 1 && val <= 2147483647;
}

function isValidString(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  if (val.trim().length === 0) return false;
  if (/[\x00-\x1F\x7F]/.test(val)) return false;
  return true;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseSimpleOptions(rows: readonly unknown[]): readonly OperationalFilterOption[] {
  const options: OperationalFilterOption[] = [];
  const seenIds = new Set<number>();
  let nextExpectedOrder = 1;

  for (const row of rows) {
    if (!isRecord(row)) {
      throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid row type');
    }
    const keys = Object.keys(row);
    if (keys.length !== 3 || !keys.includes('id') || !keys.includes('name') || !keys.includes('row_order')) {
      throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid columns');
    }

    const id = row.id;
    const name = row.name;
    const row_order = row.row_order;

    if (!isPositiveSqlInt(id)) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid id');
    if (!isValidString(name)) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid name');
    if (!isPositiveSqlInt(row_order)) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid row_order');

    if (row_order !== nextExpectedOrder) {
      throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid row order sequence');
    }
    nextExpectedOrder++;

    if (seenIds.has(id)) {
      throw new OperationalTicketFilterOptionsError('corrupt_data', 'Duplicate id');
    }
    seenIds.add(id);

    options.push(Object.freeze({
      id,
      name: name.slice()
    }));
  }

  return Object.freeze(options);
}

function parseReferentOptions(rows: readonly unknown[]): readonly OperationalReferentOption[] {
  const referents: OperationalReferentOption[] = [];
  const seenUserIds = new Set<number>();

  let currentReferent: OperationalReferentOption | null = null;
  let currentGroups: OperationalReferentGroupOption[] = [];
  let hadNullScope = false;

  let lastScopeId: number | null = null;
  let nextExpectedOrder = 1;

  for (const row of rows) {
    if (!isRecord(row)) {
      throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid row type');
    }
    const keys = Object.keys(row);
    if (keys.length !== 8 ||
        !keys.includes('user_id') ||
        !keys.includes('display_name') ||
        !keys.includes('glpi_user_id') ||
        !keys.includes('is_active') ||
        !keys.includes('scope_id') ||
        !keys.includes('scope_glpi_group_id') ||
        !keys.includes('scope_sector_name') ||
        !keys.includes('row_order')) {
      throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid columns');
    }

    const user_id = row.user_id;
    const display_name = row.display_name;
    const glpi_user_id = row.glpi_user_id;
    const is_active = row.is_active;
    const scope_id = row.scope_id;
    const scope_glpi_group_id = row.scope_glpi_group_id;
    const scope_sector_name = row.scope_sector_name;
    const row_order = row.row_order;

    if (!isPositiveSqlInt(user_id)) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid user_id');
    if (!isValidString(display_name)) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid display_name');
    if (glpi_user_id !== null && !isPositiveSqlInt(glpi_user_id)) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid glpi_user_id');
    if (is_active !== true && is_active !== 1) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid is_active');
    if (!isPositiveSqlInt(row_order)) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid row_order');

    if (row_order !== nextExpectedOrder) {
      throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid row sequence');
    }
    nextExpectedOrder++;

    const isScopeNull = scope_id === null;
    if (isScopeNull) {
      if (scope_glpi_group_id !== null || scope_sector_name !== null) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Partial null scope');
    } else {
      if (!isPositiveSqlInt(scope_id)) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid scope_id');
      if (!isPositiveSqlInt(scope_glpi_group_id)) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid scope_glpi_group_id');
      if (!isValidString(scope_sector_name)) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Invalid scope_sector_name');
    }

    if (currentReferent && currentReferent.id !== user_id) {
      if (seenUserIds.has(user_id)) {
        throw new OperationalTicketFilterOptionsError('corrupt_data', 'Scattered referent rows');
      }
      seenUserIds.add(currentReferent.id);

      const frozenGroups = Object.freeze([...currentGroups]);
      referents.push(Object.freeze({ ...currentReferent, groups: frozenGroups }));

      currentReferent = null;
      currentGroups = [];
      lastScopeId = null;
      hadNullScope = false;
    }

    if (!currentReferent) {
      currentReferent = {
        id: user_id,
        displayName: display_name.slice(),
        glpiUserId: glpi_user_id,
        isActive: true,
        groups: []
      };
      if (isScopeNull) {
        hadNullScope = true;
      }
    } else {
      if (currentReferent.displayName !== display_name || currentReferent.glpiUserId !== glpi_user_id || currentReferent.isActive !== (is_active === true || is_active === 1)) {
        throw new OperationalTicketFilterOptionsError('corrupt_data', 'Metadata mismatch for referent');
      }
      if (isScopeNull) {
        throw new OperationalTicketFilterOptionsError('corrupt_data', 'Valid scope followed by null scope');
      }
      if (hadNullScope && !isScopeNull) {
        throw new OperationalTicketFilterOptionsError('corrupt_data', 'Null scope followed by valid scope');
      }
    }

    if (!isScopeNull) {
      if (lastScopeId !== null && typeof scope_id === 'number' && scope_id <= lastScopeId) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Out of order scope_id');

      const gId = scope_glpi_group_id;
      if (typeof gId !== 'number' || typeof scope_sector_name !== 'string') {
         throw new OperationalTicketFilterOptionsError('corrupt_data', 'Type mismatch');
      }

      const sName = scope_sector_name.slice();
      const sNameLower = sName.trim().toLowerCase();

      for (const g of currentGroups) {
        if (g.glpiGroupId === gId) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Duplicate scope_glpi_group_id');
        if (g.sectorName.trim().toLowerCase() === sNameLower) throw new OperationalTicketFilterOptionsError('corrupt_data', 'Duplicate scope_sector_name');
      }

      currentGroups.push(Object.freeze({
        glpiGroupId: gId,
        sectorName: sName
      }));
      lastScopeId = scope_id;
    }
  }

  if (currentReferent) {
    seenUserIds.add(currentReferent.id);
    const frozenGroups = Object.freeze([...currentGroups]);
    referents.push(Object.freeze({ ...currentReferent, groups: frozenGroups }));
  }

  return Object.freeze(referents);
}

export class SqlServerOperationalTicketFilterOptionsRepository implements IOperationalTicketFilterOptionsRepository {
  constructor(private readonly session: ISqlServerSession) {}

  async listTechnicians(): Promise<readonly OperationalFilterOption[]> {
    const params: SqlParameter[] = [
      {
        name: 'technicalGroupId',
        type: 'int',
        nullable: false,
        value: 30
      },
      {
        name: 'excludedTechId',
        type: 'int',
        nullable: false,
        value: 231
      }
    ];

    const sql = `
      WITH Options AS (
        SELECT DISTINCT
          CAST(u.[glpi_user_id] AS INT) AS [id],
          u.[display_name] AS [name]
        FROM [prioglpi].[glpi_user_cache] u
        INNER JOIN [prioglpi].[glpi_user_group_membership] m ON u.[glpi_user_id] = m.[user_id]
        WHERE u.[is_active] = 1
          AND m.[group_id] = @technicalGroupId
          AND u.[glpi_user_id] <> @excludedTechId
          AND LOWER(u.[display_name]) NOT LIKE N'%julián cancio%'
          AND LOWER(u.[display_name]) NOT LIKE N'%julian cancio%'
          AND LOWER(u.[display_name]) NOT LIKE N'%joel lugo%'
          AND LOWER(u.[display_name]) NOT LIKE N'%guillermo kunz%'
          AND NOT EXISTS (
            SELECT 1 FROM [prioglpi].[app_user] a
            WHERE a.[glpi_user_id] = u.[glpi_user_id]
              AND a.[role] = N'priorizador'
          )
        UNION
        SELECT DISTINCT
          CAST(grp.[group_id] AS INT) AS [id],
          N'Soporte Dycos' AS [name]
        FROM [prioglpi].[glpi_group_cache] grp
        INNER JOIN [prioglpi].[glpi_ticket_group_actor] actor ON actor.[group_id] = grp.[group_id]
        WHERE actor.[actor_type] = 2
          AND (
            LOWER(grp.[complete_name]) LIKE N'%soporte dycos%'
            OR LOWER(grp.[name]) LIKE N'%soporte dycos%'
          )
      )
      SELECT [id], [name], CAST(ROW_NUMBER() OVER (ORDER BY [name] ASC, [id] ASC) AS INT) AS [row_order]
      FROM Options
      ORDER BY [name] ASC, [id] ASC
    `;
    const rows = await this.session.query(sql, params);
    return parseSimpleOptions(rows);
  }

  async listSistemasSectors(): Promise<readonly OperationalFilterOption[]> {
    const sql = `
      WITH Options AS (
        SELECT
          CAST([detected_sector_group_id] AS INT) AS [id],
          COALESCE(MIN(NULLIF(LTRIM(RTRIM([detected_sector])), N'')), N'Sector ' + CAST([detected_sector_group_id] AS NVARCHAR(20))) AS [name]
        FROM [prioglpi].[glpi_ticket_cache]
        WHERE [is_sistemas_scope] = 1
          AND [detected_sector_group_id] IS NOT NULL
          AND [detected_sector_group_id] > 0
        GROUP BY [detected_sector_group_id]
      )
      SELECT [id], [name], CAST(ROW_NUMBER() OVER (ORDER BY [name] ASC, [id] ASC) AS INT) AS [row_order]
      FROM Options
      ORDER BY [name] ASC, [id] ASC
    `;
    const rows = await this.session.query(sql, []);
    return parseSimpleOptions(rows);
  }

  async listSistemasRequesters(): Promise<readonly OperationalFilterOption[]> {
    const sql = `
      WITH Options AS (
        SELECT DISTINCT
          CAST(u.[glpi_user_id] AS INT) AS [id],
          u.[display_name] AS [name]
        FROM [prioglpi].[glpi_ticket_cache] t
        INNER JOIN [prioglpi].[glpi_ticket_user_actor] a ON t.[ticket_id] = a.[ticket_id]
        INNER JOIN [prioglpi].[glpi_user_cache] u ON a.[glpi_user_id] = u.[glpi_user_id]
        WHERE t.[is_sistemas_scope] = 1
          AND a.[actor_type] = 1
          AND u.[is_active] = 1
      )
      SELECT [id], [name], CAST(ROW_NUMBER() OVER (ORDER BY [name] ASC, [id] ASC) AS INT) AS [row_order]
      FROM Options
      ORDER BY [name] ASC, [id] ASC
    `;
    const rows = await this.session.query(sql, []);
    return parseSimpleOptions(rows);
  }

  async listActiveReferentOptions(): Promise<readonly OperationalReferentOption[]> {
    const sql = `
      WITH ScopeOptions AS (
        SELECT
          s.[user_id],
          MIN(s.[id]) AS [scope_id],
          s.[glpi_group_id],
          MIN(s.[sector_name]) AS [scope_sector_name]
        FROM [prioglpi].[user_sector_scope] s
        WHERE s.[glpi_group_id] IS NOT NULL
          AND s.[glpi_group_id] > 0
          AND NULLIF(LTRIM(RTRIM(s.[sector_name])), N'') IS NOT NULL
        GROUP BY s.[user_id], s.[glpi_group_id]
      ),
      Options AS (
        SELECT
          CAST(u.[id] AS INT) AS [user_id],
          u.[display_name],
          CAST(u.[glpi_user_id] AS INT) AS [glpi_user_id],
          u.[is_active],
          CAST(s.[scope_id] AS INT) AS [scope_id],
          CAST(s.[glpi_group_id] AS INT) AS [scope_glpi_group_id],
          s.[scope_sector_name]
        FROM [prioglpi].[app_user] u
        LEFT JOIN ScopeOptions s ON u.[id] = s.[user_id]
        WHERE u.[role] = N'priorizador'
          AND u.[is_active] = 1
      )
      SELECT [user_id], [display_name], [glpi_user_id], [is_active], [scope_id], [scope_glpi_group_id], [scope_sector_name],
             CAST(ROW_NUMBER() OVER (ORDER BY [display_name] ASC, [user_id] ASC, [scope_id] ASC) AS INT) AS [row_order]
      FROM Options
      ORDER BY [display_name] ASC, [user_id] ASC, [scope_id] ASC
    `;
    const rows = await this.session.query(sql, []);
    return parseReferentOptions(rows);
  }

  async listScopedRequesters(groupIds: unknown): Promise<readonly OperationalFilterOption[]> {
    if (!Array.isArray(groupIds)) {
      throw new OperationalTicketFilterOptionsError('invalid_input', 'Invalid input type');
    }
    if (groupIds.length > 200) {
      throw new OperationalTicketFilterOptionsError('invalid_input', 'Too many ids');
    }

    const uniqueIds = new Set<number>();
    const validatedIds: number[] = [];
    for (const id of groupIds) {
      if (!isPositiveSqlInt(id)) {
        throw new OperationalTicketFilterOptionsError('invalid_input', 'Invalid id');
      }
      if (uniqueIds.has(id)) {
        throw new OperationalTicketFilterOptionsError('invalid_input', 'Duplicate id');
      }
      uniqueIds.add(id);
      validatedIds.push(id);
    }

    if (validatedIds.length === 0) {
      return Object.freeze([]);
    }

    const sortedIds = [...validatedIds].sort((a, b) => a - b);
    const jsonStr = JSON.stringify(sortedIds);

    const params: SqlParameter[] = [
      {
        name: 'groupIdsJson',
        type: 'nvarchar',
        length: 'MAX',
        nullable: false,
        value: jsonStr
      }
    ];

    const sql = `
      WITH Options AS (
        SELECT DISTINCT
          CAST(u.[glpi_user_id] AS INT) AS [id],
          u.[display_name] AS [name]
        FROM OPENJSON(@groupIdsJson) WITH ([value] INT '$') j
        INNER JOIN [prioglpi].[glpi_user_group_membership] m ON m.[group_id] = j.[value]
        INNER JOIN [prioglpi].[glpi_user_cache] u ON u.[glpi_user_id] = m.[user_id]
        WHERE u.[is_active] = 1
          AND NOT EXISTS (
            SELECT 1
            FROM [prioglpi].[app_user] a
            INNER JOIN [prioglpi].[user_sector_scope] s ON a.[id] = s.[user_id]
            WHERE a.[role] = N'priorizador'
              AND a.[is_active] = 1
              AND a.[glpi_user_id] = u.[glpi_user_id]
              AND s.[glpi_group_id] IN (SELECT [value] FROM OPENJSON(@groupIdsJson) WITH ([value] INT '$'))
          )
      )
      SELECT [id], [name], CAST(ROW_NUMBER() OVER (ORDER BY [name] ASC, [id] ASC) AS INT) AS [row_order]
      FROM Options
      ORDER BY [name] ASC, [id] ASC
    `;
    const rows = await this.session.query(sql, params);
    return parseSimpleOptions(rows);
  }
}
