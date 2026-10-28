import * as crypto from 'crypto';
import sql from 'mssql/msnodesqlv8';

export type LogicalType =
    | 'integer'
    | 'nullable-integer'
    | 'boolean'
    | 'nullable-boolean'
    | 'string'
    | 'nullable-string'
    | 'datetime'
    | 'nullable-datetime';

export type ExactSqlType =
    | { kind: 'int' }
    | { kind: 'bit' }
    | { kind: 'datetime2', scale: 3 }
    | { kind: 'nvarchar', length: 50 | 255 | 1000 | 'max' };

export interface ColumnMapping {
    sourceCol: string;
    targetCol: string;
    type: LogicalType;
    sqlType: ExactSqlType;
}

export interface TableManifest {
    sqliteTable: string;
    sqlServerTable: string;
    primaryKey: string;
    hasIdentity: boolean;
    columns: ColumnMapping[];
}

export function formatSqlIdentifier(tableName: string): string {
    return `[prioglpi].[${tableName}]`;
}

export const OPERATIONAL_MANIFEST: TableManifest[] = [
    {
        sqliteTable: 'User',
        sqlServerTable: 'app_user',
        primaryKey: 'id',
        hasIdentity: true,
        columns: [
            { sourceCol: 'id', targetCol: 'id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'username', targetCol: 'username', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'passwordHash', targetCol: 'password_hash', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'displayName', targetCol: 'display_name', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'role', targetCol: 'role', type: 'string', sqlType: { kind: 'nvarchar', length: 50 } },
            { sourceCol: 'isActive', targetCol: 'is_active', type: 'boolean', sqlType: { kind: 'bit' } },
            { sourceCol: 'glpiUserId', targetCol: 'glpi_user_id', type: 'nullable-integer', sqlType: { kind: 'int' } },
            { sourceCol: 'adObjectId', targetCol: 'ad_object_id', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'email', targetCol: 'email', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'authSource', targetCol: 'auth_source', type: 'string', sqlType: { kind: 'nvarchar', length: 50 } },
            { sourceCol: 'directoryActive', targetCol: 'directory_active', type: 'nullable-boolean', sqlType: { kind: 'bit' } },
            { sourceCol: 'directoryStatusCheckedAt', targetCol: 'directory_status_checked_at', type: 'nullable-datetime', sqlType: { kind: 'datetime2', scale: 3 } },
            { sourceCol: 'createdAt', targetCol: 'created_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } },
            { sourceCol: 'updatedAt', targetCol: 'updated_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } }
        ]
    },
    {
        sqliteTable: 'GlpiTicketCache',
        sqlServerTable: 'glpi_ticket_cache',
        primaryKey: 'ticketId',
        hasIdentity: false,
        columns: [
            { sourceCol: 'ticketId', targetCol: 'ticket_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'title', targetCol: 'title', type: 'string', sqlType: { kind: 'nvarchar', length: 1000 } },
            { sourceCol: 'contentPlain', targetCol: 'content_plain', type: 'string', sqlType: { kind: 'nvarchar', length: 'max' } },
            { sourceCol: 'status', targetCol: 'status', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'statusLabel', targetCol: 'status_label', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'type', targetCol: 'type', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'typeLabel', targetCol: 'type_label', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'priority', targetCol: 'priority', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'priorityLabel', targetCol: 'priority_label', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'openedAt', targetCol: 'opened_at', type: 'string', sqlType: { kind: 'nvarchar', length: 50 } },
            { sourceCol: 'updatedAtGlpi', targetCol: 'updated_at_glpi', type: 'string', sqlType: { kind: 'nvarchar', length: 50 } },
            { sourceCol: 'solvedAt', targetCol: 'solved_at', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 50 } },
            { sourceCol: 'closedAt', targetCol: 'closed_at', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 50 } },
            { sourceCol: 'requesterName', targetCol: 'requester_name', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'requesterGroup', targetCol: 'requester_group', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'assignedTechnician', targetCol: 'assigned_technician', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'assignedGroupIds', targetCol: 'assigned_group_ids', type: 'string', sqlType: { kind: 'nvarchar', length: 'max' } },
            { sourceCol: 'assignedGroupNames', targetCol: 'assigned_group_names', type: 'string', sqlType: { kind: 'nvarchar', length: 'max' } },
            { sourceCol: 'detectedSector', targetCol: 'detected_sector', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'isSistemasScope', targetCol: 'is_sistemas_scope', type: 'boolean', sqlType: { kind: 'bit' } },
            { sourceCol: 'isTecnologiaScope', targetCol: 'is_tecnologia_scope', type: 'boolean', sqlType: { kind: 'bit' } },
            { sourceCol: 'webUrl', targetCol: 'web_url', type: 'string', sqlType: { kind: 'nvarchar', length: 1000 } },
            { sourceCol: 'syncedAt', targetCol: 'synced_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } },
            { sourceCol: 'requesterUserId', targetCol: 'requester_user_id', type: 'nullable-integer', sqlType: { kind: 'int' } },
            { sourceCol: 'requesterGroupId', targetCol: 'requester_group_id', type: 'nullable-integer', sqlType: { kind: 'int' } },
            { sourceCol: 'detectedSectorGroupId', targetCol: 'detected_sector_group_id', type: 'nullable-integer', sqlType: { kind: 'int' } },
            { sourceCol: 'detectedSectorName', targetCol: 'detected_sector_name', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'sectorSource', targetCol: 'sector_source', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'categoryId', targetCol: 'category_id', type: 'nullable-integer', sqlType: { kind: 'int' } },
            { sourceCol: 'entityId', targetCol: 'entity_id', type: 'nullable-integer', sqlType: { kind: 'int' } },
            { sourceCol: 'locationId', targetCol: 'location_id', type: 'nullable-integer', sqlType: { kind: 'int' } },
            { sourceCol: 'requestTypeId', targetCol: 'request_type_id', type: 'nullable-integer', sqlType: { kind: 'int' } },
            { sourceCol: 'urgency', targetCol: 'urgency', type: 'nullable-integer', sqlType: { kind: 'int' } },
            { sourceCol: 'impact', targetCol: 'impact', type: 'nullable-integer', sqlType: { kind: 'int' } },
            { sourceCol: 'glpiPriority', targetCol: 'glpi_priority', type: 'nullable-integer', sqlType: { kind: 'int' } }
        ]
    },
    {
        sqliteTable: 'SyncRun',
        sqlServerTable: 'sync_run',
        primaryKey: 'id',
        hasIdentity: true,
        columns: [
            { sourceCol: 'id', targetCol: 'id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'startedAt', targetCol: 'started_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } },
            { sourceCol: 'finishedAt', targetCol: 'finished_at', type: 'nullable-datetime', sqlType: { kind: 'datetime2', scale: 3 } },
            { sourceCol: 'status', targetCol: 'status', type: 'string', sqlType: { kind: 'nvarchar', length: 50 } },
            { sourceCol: 'ticketsFetched', targetCol: 'tickets_fetched', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'errorMessage', targetCol: 'error_message', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 'max' } },
            { sourceCol: 'sistemasCount', targetCol: 'sistemas_count', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'tecnologiaCount', targetCol: 'tecnologia_count', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'unroutedCount', targetCol: 'unrouted_count', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'activeCount', targetCol: 'active_count', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'historyCount', targetCol: 'history_count', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'sectorSourceCount', targetCol: 'sector_source_count', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'noSectorCount', targetCol: 'no_sector_count', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'usersCount', targetCol: 'users_count', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'groupsCount', targetCol: 'groups_count', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'membershipsCount', targetCol: 'memberships_count', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'publicNotesCount', targetCol: 'public_notes_count', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'privateNotesCount', targetCol: 'private_notes_count', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'durationMs', targetCol: 'duration_ms', type: 'integer', sqlType: { kind: 'int' } }
        ]
    },
    {
        sqliteTable: 'GlpiGroupCache',
        sqlServerTable: 'glpi_group_cache',
        primaryKey: 'groupId',
        hasIdentity: false,
        columns: [
            { sourceCol: 'groupId', targetCol: 'group_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'name', targetCol: 'name', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'completeName', targetCol: 'complete_name', type: 'string', sqlType: { kind: 'nvarchar', length: 1000 } },
            { sourceCol: 'parentGroupId', targetCol: 'parent_group_id', type: 'nullable-integer', sqlType: { kind: 'int' } },
            { sourceCol: 'flags', targetCol: 'flags', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'syncedAt', targetCol: 'synced_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } }
        ]
    },
    {
        sqliteTable: 'GlpiUserCache',
        sqlServerTable: 'glpi_user_cache',
        primaryKey: 'glpiUserId',
        hasIdentity: false,
        columns: [
            { sourceCol: 'glpiUserId', targetCol: 'glpi_user_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'username', targetCol: 'username', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'nombres', targetCol: 'nombres', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'displayName', targetCol: 'display_name', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'defaultGroupId', targetCol: 'default_group_id', type: 'nullable-integer', sqlType: { kind: 'int' } },
            { sourceCol: 'isActive', targetCol: 'is_active', type: 'boolean', sqlType: { kind: 'bit' } },
            { sourceCol: 'syncedAt', targetCol: 'synced_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } }
        ]
    },
    {
        sqliteTable: 'GlpiUserGroupMembership',
        sqlServerTable: 'glpi_user_group_membership',
        primaryKey: 'id',
        hasIdentity: true,
        columns: [
            { sourceCol: 'id', targetCol: 'id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'userId', targetCol: 'user_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'groupId', targetCol: 'group_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'isManager', targetCol: 'is_manager', type: 'boolean', sqlType: { kind: 'bit' } },
            { sourceCol: 'isDelegate', targetCol: 'is_delegate', type: 'boolean', sqlType: { kind: 'bit' } },
            { sourceCol: 'isDynamic', targetCol: 'is_dynamic', type: 'boolean', sqlType: { kind: 'bit' } }
        ]
    },
    {
        sqliteTable: 'GlpiTicketGroupActor',
        sqlServerTable: 'glpi_ticket_group_actor',
        primaryKey: 'id',
        hasIdentity: true,
        columns: [
            { sourceCol: 'id', targetCol: 'id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'ticketId', targetCol: 'ticket_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'groupId', targetCol: 'group_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'actorType', targetCol: 'actor_type', type: 'integer', sqlType: { kind: 'int' } }
        ]
    },
    {
        sqliteTable: 'GlpiTicketUserActor',
        sqlServerTable: 'glpi_ticket_user_actor',
        primaryKey: 'id',
        hasIdentity: true,
        columns: [
            { sourceCol: 'id', targetCol: 'id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'ticketId', targetCol: 'ticket_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'glpiUserId', targetCol: 'glpi_user_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'actorType', targetCol: 'actor_type', type: 'integer', sqlType: { kind: 'int' } }
        ]
    },
    {
        sqliteTable: 'GlpiFollowupCache',
        sqlServerTable: 'glpi_followup_cache',
        primaryKey: 'followupId',
        hasIdentity: false,
        columns: [
            { sourceCol: 'followupId', targetCol: 'followup_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'ticketId', targetCol: 'ticket_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'author', targetCol: 'author', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'contentPlain', targetCol: 'content_plain', type: 'string', sqlType: { kind: 'nvarchar', length: 'max' } },
            { sourceCol: 'isPrivate', targetCol: 'is_private', type: 'boolean', sqlType: { kind: 'bit' } },
            { sourceCol: 'createdAt', targetCol: 'created_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } },
            { sourceCol: 'updatedAt', targetCol: 'updated_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } }
        ]
    },
    {
        sqliteTable: 'GlpiTaskCache',
        sqlServerTable: 'glpi_task_cache',
        primaryKey: 'taskId',
        hasIdentity: false,
        columns: [
            { sourceCol: 'taskId', targetCol: 'task_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'ticketId', targetCol: 'ticket_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'author', targetCol: 'author', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'technician', targetCol: 'technician', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'techGroup', targetCol: 'tech_group', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'contentPlain', targetCol: 'content_plain', type: 'string', sqlType: { kind: 'nvarchar', length: 'max' } },
            { sourceCol: 'isPrivate', targetCol: 'is_private', type: 'boolean', sqlType: { kind: 'bit' } },
            { sourceCol: 'state', targetCol: 'state', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'createdAt', targetCol: 'created_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } },
            { sourceCol: 'updatedAt', targetCol: 'updated_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } }
        ]
    },
    {
        sqliteTable: 'LoginAttempt',
        sqlServerTable: 'login_attempt',
        primaryKey: 'id',
        hasIdentity: true,
        columns: [
            { sourceCol: 'id', targetCol: 'id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'accountKeyHash', targetCol: 'account_key_hash', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'ipKeyHash', targetCol: 'ip_key_hash', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'attemptedAt', targetCol: 'attempted_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } },
            { sourceCol: 'success', targetCol: 'success', type: 'boolean', sqlType: { kind: 'bit' } }
        ]
    },
    {
        sqliteTable: 'UserSectorScope',
        sqlServerTable: 'user_sector_scope',
        primaryKey: 'id',
        hasIdentity: true,
        columns: [
            { sourceCol: 'id', targetCol: 'id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'userId', targetCol: 'user_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'sectorName', targetCol: 'sector_name', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'glpiGroupId', targetCol: 'glpi_group_id', type: 'nullable-integer', sqlType: { kind: 'int' } }
        ]
    },
    {
        sqliteTable: 'SectorReferentAssignment',
        sqlServerTable: 'sector_referent_assignment',
        primaryKey: 'id',
        hasIdentity: true,
        columns: [
            { sourceCol: 'id', targetCol: 'id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'glpiGroupId', targetCol: 'glpi_group_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'referentUserId', targetCol: 'referent_user_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'assignedAt', targetCol: 'assigned_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } },
            { sourceCol: 'updatedAt', targetCol: 'updated_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } }
        ]
    },
    {
        sqliteTable: 'AuditLog',
        sqlServerTable: 'audit_log',
        primaryKey: 'id',
        hasIdentity: true,
        columns: [
            { sourceCol: 'id', targetCol: 'id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'userId', targetCol: 'user_id', type: 'nullable-integer', sqlType: { kind: 'int' } },
            { sourceCol: 'action', targetCol: 'action', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'entityType', targetCol: 'entity_type', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'entityId', targetCol: 'entity_id', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'beforeJson', targetCol: 'before_json', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 'max' } },
            { sourceCol: 'afterJson', targetCol: 'after_json', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 'max' } },
            { sourceCol: 'createdAt', targetCol: 'created_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } },
            { sourceCol: 'actorName', targetCol: 'actor_name', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'actorUsername', targetCol: 'actor_username', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 255 } }
        ]
    },
    {
        sqliteTable: 'TicketRanking',
        sqlServerTable: 'ticket_ranking',
        primaryKey: 'id',
        hasIdentity: true,
        columns: [
            { sourceCol: 'id', targetCol: 'id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'ticketId', targetCol: 'ticket_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'sectorName', targetCol: 'sector_name', type: 'string', sqlType: { kind: 'nvarchar', length: 255 } },
            { sourceCol: 'glpiGroupId', targetCol: 'glpi_group_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'rankPosition', targetCol: 'rank_position', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'createdByUserId', targetCol: 'created_by_user_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'updatedByUserId', targetCol: 'updated_by_user_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'createdAt', targetCol: 'created_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } },
            { sourceCol: 'updatedAt', targetCol: 'updated_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } },
            { sourceCol: 'isActive', targetCol: 'is_active', type: 'boolean', sqlType: { kind: 'bit' } }
        ]
    },
    {
        sqliteTable: 'TicketCoordination',
        sqlServerTable: 'ticket_coordination',
        primaryKey: 'id',
        hasIdentity: true,
        columns: [
            { sourceCol: 'id', targetCol: 'id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'ticketId', targetCol: 'ticket_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'progressPercent', targetCol: 'progress_percent', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'coordinatorComment', targetCol: 'coordinator_comment', type: 'string', sqlType: { kind: 'nvarchar', length: 'max' } },
            { sourceCol: 'estimatedDeliveryDate', targetCol: 'estimated_delivery_date', type: 'nullable-string', sqlType: { kind: 'nvarchar', length: 50 } },
            { sourceCol: 'updatedByUserId', targetCol: 'updated_by_user_id', type: 'integer', sqlType: { kind: 'int' } },
            { sourceCol: 'updatedAt', targetCol: 'updated_at', type: 'datetime', sqlType: { kind: 'datetime2', scale: 3 } }
        ]
    }
];

export const MIGRATION_LOAD_ORDER = OPERATIONAL_MANIFEST.map(t => t.sqliteTable);
export const MIGRATION_CLEANUP_ORDER = [...MIGRATION_LOAD_ORDER].reverse();

export function resolveMssqlType(type: ExactSqlType): sql.ISqlType {
    switch (type.kind) {
        case 'int': return sql.Int();
        case 'bit': return sql.Bit();
        case 'datetime2': return sql.DateTime2(type.scale);
        case 'nvarchar': return type.length === 'max' ? sql.NVarChar(sql.MAX) : sql.NVarChar(type.length as number);
    }
}

export function parseStrictInteger(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number') throw new Error('Entero debe ser numero estricto');
    if (!Number.isSafeInteger(value)) throw new Error('Entero inseguro o invalido');
    return value;
}

export function parseStrictBoolean(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (value === true || value === 1) return 1;
    if (value === false || value === 0) return 0;
    throw new Error('Booleano invalido');
}

export function parseStrictString(value: unknown, maxLength?: number | 'max'): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') throw new Error('El valor debe ser tipo string');
    if (maxLength && maxLength !== 'max') {
        if (value.length > maxLength) {
            throw new Error('El string excede la longitud maxima');
        }
    }
    return value;
}

export function parseStrictIsoUtc(dateStr: unknown, isNullable: boolean, side: 'source' | 'target'): string | null {
    if (dateStr === null || dateStr === undefined) {
        if (!isNullable) throw new Error('Fecha vacia rechazada para campo obligatorio');
        return null;
    }

    if (dateStr instanceof Date) {
        if (side === 'source') throw new Error('Objeto Date no soportado en origen (SQLite)');
        if (isNaN(dateStr.getTime())) throw new Error('Objeto Date invalido');
        return dateStr.toISOString();
    }

    if (typeof dateStr !== 'string') throw new Error('El formato de fecha debe ser string');
    if (dateStr !== dateStr.trim()) throw new Error('Fecha rechazada por contener espacios iniciales/finales');
    if (!dateStr) {
        if (!isNullable) throw new Error('Fecha vacia rechazada para campo obligatorio');
        return null;
    }

    const isoRegex = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?)?(Z|([+-])(\d{2}):?(\d{2}))?$/;
    const match = dateStr.match(isoRegex);
    if (!match) throw new Error('Formato de fecha no valido');

    const yearStr = match[1];
    const monthStr = match[2];
    const dayStr = match[3];
    const hourStr = match[4];
    const minStr = match[5];
    const secStr = match[6];
    const msStr = match[7];
    const tzSign = match[9];
    const tzHourStr = match[10];
    const tzMinStr = match[11];

    if (msStr && msStr.length > 3) {
        throw new Error('Fraccion de segundos con mas de 3 digitos rechazada');
    }

    const y = parseInt(yearStr, 10);
    const m = parseInt(monthStr, 10) - 1; // 0-based
    const d = parseInt(dayStr, 10);

    const testDate = new Date(Date.UTC(y, m, d));
    if (testDate.getUTCFullYear() !== y || testDate.getUTCMonth() !== m || testDate.getUTCDate() !== d) {
        throw new Error('Fecha rechazada por desborde en calendario (ej. 30 de febrero)');
    }

    if (hourStr !== undefined) {
        const hh = parseInt(hourStr, 10);
        const mm = parseInt(minStr, 10);
        const ss = parseInt(secStr, 10);
        const ms = msStr ? parseInt(msStr.padEnd(3, '0').substring(0, 3), 10) : 0;

        if (hh > 23 || mm > 59 || ss > 59) throw new Error('Hora no valida');

        let offsetMs = 0;
        if (tzHourStr && tzMinStr) {
            const tzH = parseInt(tzHourStr, 10);
            const tzM = parseInt(tzMinStr, 10);

            if (tzH < 0 || tzH > 14) throw new Error('Timezone hour fuera de rango (0-14)');
            if (tzM < 0 || tzM > 59) throw new Error('Timezone minute fuera de rango (0-59)');
            if (tzH === 14 && tzM !== 0) throw new Error('Timezone invalido (+14:01 o superior)');

            offsetMs = (tzH * 60 + tzM) * 60000;
            if (tzSign === '-') {
                offsetMs = -offsetMs;
            }
        }

        const finalDate = new Date(Date.UTC(y, m, d, hh, mm, ss, ms) - offsetMs);
        if (isNaN(finalDate.getTime())) throw new Error('Tiempo invalido');
        return finalDate.toISOString();
    }

    return testDate.toISOString();
}

export type StrictRow = Record<string, unknown>;

export function generateLogicalHash(rows: StrictRow[], manifest: TableManifest, side: 'source' | 'target'): string {
    const pkKey = side === 'source' ? manifest.primaryKey : manifest.columns.find(c => c.sourceCol === manifest.primaryKey)!.targetCol;

    const sorted = [...rows].sort((a, b) => {
        const valA = a[pkKey];
        const valB = b[pkKey];
        if (valA === null || valA === undefined) throw new Error('PK nula');
        if (valB === null || valB === undefined) throw new Error('PK nula');
        if (typeof valA !== 'number' && typeof valA !== 'string') throw new Error('PK invalida');
        if (typeof valB !== 'number' && typeof valB !== 'string') throw new Error('PK invalida');
        if (valA < valB) return -1;
        if (valA > valB) return 1;
        return 0;
    });

    for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i][pkKey] === sorted[i + 1][pkKey]) {
            throw new Error('PK duplicada');
        }
    }

    const hash = crypto.createHash('sha256');
    for (const row of sorted) {
        const canonicalRow: Array<{col: string, val: unknown}> = [];
        for (const col of manifest.columns) {
            const rowKey = side === 'source' ? col.sourceCol : col.targetCol;

            if (!(rowKey in row)) {
                throw new Error('Falta propiedad obligatoria en fila');
            }

            const val = row[rowKey];
            let finalVal: unknown;

            if (val === null || val === undefined) {
                if (!col.type.startsWith('nullable')) throw new Error('Valor NULL prohibido en columna obligatoria');
                finalVal = null;
            } else {
                switch (col.type) {
                    case 'boolean':
                    case 'nullable-boolean':
                        finalVal = parseStrictBoolean(val);
                        break;
                    case 'integer':
                    case 'nullable-integer':
                        finalVal = parseStrictInteger(val);
                        break;
                    case 'datetime':
                    case 'nullable-datetime':
                        finalVal = parseStrictIsoUtc(val, col.type.startsWith('nullable'), side);
                        break;
                    case 'string':
                    case 'nullable-string':
                        const nvarcharLen = col.sqlType.kind === 'nvarchar' ? col.sqlType.length : undefined;
                        finalVal = parseStrictString(val, nvarcharLen);
                        break;
                }
            }
            canonicalRow.push({ col: col.sourceCol, val: finalVal });
        }
        hash.update(JSON.stringify(canonicalRow) + '\n');
    }

    return hash.digest('hex');
}
