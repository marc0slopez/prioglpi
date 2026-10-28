import sql from 'mssql/msnodesqlv8';
import {
    OPERATIONAL_MANIFEST,
    parseStrictIsoUtc,
    generateLogicalHash,
    parseStrictInteger,
    parseStrictBoolean,
    parseStrictString,
    resolveMssqlType,
    StrictRow,
    TableManifest
} from './sql-server/operational-migration-manifest';

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(`TEST FAILED: ${message}`);
    }
}

function assertThrows(fn: () => void, message: string) {
    let threw = false;
    try {
        fn();
    } catch {
        threw = true;
    }
    assert(threw, message);
}

const EXPECTED_OPERATIONAL_CONTRACT: TableManifest[] = [
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

function runOfflineTests() {
    console.log('Iniciando tests offline estrictos...');

    assert(JSON.stringify(EXPECTED_OPERATIONAL_CONTRACT) === JSON.stringify(OPERATIONAL_MANIFEST), 'El contrato independiente no coincide con el manifiesto');

    const userManifest = OPERATIONAL_MANIFEST.find(m => m.sqliteTable === 'User');

    // sql.ISqlType testing properties explicitly per user rules
    const tInt = resolveMssqlType({ kind: 'int' });
    assert(tInt.type === sql.Int, 'Debe resolver int');

    const tBit = resolveMssqlType({ kind: 'bit' });
    assert(tBit.type === sql.Bit, 'Debe resolver bit');

    const tDate = resolveMssqlType({ kind: 'datetime2', scale: 3 });
    assert(tDate.type === sql.DateTime2, 'Debe resolver datetime2');
    assert('scale' in tDate && (tDate as { scale?: number }).scale === 3, 'Debe resolver scale 3');

    const tNvarMax = resolveMssqlType({ kind: 'nvarchar', length: 'max' });
    assert(tNvarMax.type === sql.NVarChar, 'Debe resolver nvarchar MAX');
    assert('length' in tNvarMax && (tNvarMax as { length?: number }).length === sql.MAX, 'Debe resolver length MAX');

    const tNvar255 = resolveMssqlType({ kind: 'nvarchar', length: 255 });
    assert(tNvar255.type === sql.NVarChar, 'Debe resolver nvarchar 255');
    assert('length' in tNvar255 && (tNvar255 as { length?: number }).length === 255, 'Debe resolver length 255');

    const offsetNeg3 = parseStrictIsoUtc('2026-07-30T22:00:00-03:00', false, 'target');
    assert(offsetNeg3 === '2026-07-31T01:00:00.000Z', 'Offset -03:00 debe resolver correctamente');

    const offsetPos14 = parseStrictIsoUtc('2026-07-30T10:00:00+14:00', false, 'target');
    assert(offsetPos14 === '2026-07-29T20:00:00.000Z', 'Offset +14:00 debe ser valido');

    assertThrows(() => parseStrictIsoUtc('2026-07-30T10:00:00+14:01', false, 'target'), '+14:01 debe ser invalido');
    assertThrows(() => parseStrictIsoUtc('2026-07-30T10:00:00+15:00', false, 'target'), '+15:00 debe ser invalido');
    assertThrows(() => parseStrictIsoUtc('2026-07-30T10:00:00.1234Z', false, 'target'), 'Fraccion 4 digitos debe fallar');
    assertThrows(() => parseStrictIsoUtc(null, false, 'target'), 'Null en false isNullable debe fallar');
    assertThrows(() => parseStrictIsoUtc(new Date(), false, 'source'), 'Date invalido en source');

    const targetDate = parseStrictIsoUtc(new Date('2026-01-01T00:00:00Z'), false, 'target');
    assert(targetDate === '2026-01-01T00:00:00.000Z', 'Date valido en target');

    assert(parseStrictString('abc', 3) === 'abc', 'Largo 3 entra en 3');
    assertThrows(() => parseStrictString('abcd', 3), 'Largo 4 rechaza 3');
    assert(parseStrictString('abcd', 'max') === 'abcd', 'max permite largo');

    assert(parseStrictInteger(42) === 42, 'Entero valido debe parsear');
    assertThrows(() => parseStrictInteger(42.5), 'Decimales deben ser rechazados');
    assertThrows(() => parseStrictInteger('42'), 'Strings numericos deben ser rechazados');
    assert(parseStrictBoolean(true) === 1, 'true debe ser 1');
    assert(parseStrictBoolean(1) === 1, '1 numerico debe ser 1');
    assert(parseStrictBoolean(false) === 0, 'false debe ser 0');
    assert(parseStrictBoolean(0) === 0, '0 numerico debe ser 0');
    assertThrows(() => parseStrictBoolean('1'), 'Strings 1 deben ser rechazados');

    const row1: StrictRow = {
        id: 1,
        username: 'juan',
        passwordHash: null,
        displayName: 'Juan Perez',
        role: 'referente',
        isActive: 1,
        glpiUserId: null,
        adObjectId: null,
        email: null,
        authSource: 'local',
        directoryActive: null,
        directoryStatusCheckedAt: null,
        createdAt: '2026-07-30T12:00:00.000Z',
        updatedAt: '2026-07-30T12:00:00.000Z'
    };

    const row2: StrictRow = {
        id: 2,
        username: 'pedro',
        passwordHash: 'hash',
        displayName: 'Pedro',
        role: 'admin',
        isActive: 1,
        glpiUserId: 10,
        adObjectId: 'abc',
        email: 'p@p.com',
        authSource: 'system',
        directoryActive: 1,
        directoryStatusCheckedAt: '2026-07-30T12:00:00.000Z',
        createdAt: '2026-07-30T12:00:00.000Z',
        updatedAt: '2026-07-30T12:00:00.000Z'
    };

    const hash1 = generateLogicalHash([row1, row2], userManifest!, 'source');
    const hash2 = generateLogicalHash([row2, row1], userManifest!, 'source');
    assert(hash1 === hash2, 'Hash estable ante reordenamiento');

    console.log('TEST OFFLINE ESTRICTOS COMPLETADOS.');
}

if (require.main === module) {
    try {
        runOfflineTests();
        process.exitCode = 0;
    } catch (err: unknown) {
        console.error(err instanceof Error ? err.message : 'Error desconocido');
        process.exitCode = 1;
    }
}
