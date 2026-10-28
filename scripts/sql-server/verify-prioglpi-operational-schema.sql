-- Ejecutar conectado a la base de datos destino de PrioGLPI.
SET NOCOUNT ON;

BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'prioglpi')
        THROW 51000, 'Schema [prioglpi] no existe.', 1;

    -- 1. Validar existencia de las 16 tablas esperadas
    DECLARE @ExpectedTables TABLE (TableName SYSNAME);
    INSERT INTO @ExpectedTables VALUES
        ('app_user'), ('user_sector_scope'), ('glpi_ticket_cache'), ('ticket_ranking'),
        ('sector_referent_assignment'), ('ticket_coordination'), ('sync_run'), ('audit_log'),
        ('glpi_group_cache'), ('glpi_user_cache'), ('glpi_user_group_membership'),
        ('glpi_ticket_group_actor'), ('glpi_ticket_user_actor'), ('glpi_followup_cache'),
        ('glpi_task_cache'), ('login_attempt');

    IF EXISTS (
        SELECT t.name FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE s.name = 'prioglpi' AND t.name NOT IN (SELECT TableName FROM @ExpectedTables)
    ) THROW 51001, 'Existen tablas inesperadas en el schema prioglpi.', 1;

    IF EXISTS (
        SELECT TableName FROM @ExpectedTables
        WHERE TableName NOT IN (SELECT t.name FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'prioglpi')
    ) THROW 51002, 'Faltan tablas esperadas en el schema prioglpi.', 1;

    -- 2. Validar ausencia de otros objetos
    IF EXISTS (
        SELECT 1 FROM sys.objects o JOIN sys.schemas s ON o.schema_id = s.schema_id
        WHERE s.name = 'prioglpi' AND o.type NOT IN ('U', 'PK', 'F', 'UQ', 'C', 'D')
    ) THROW 51003, 'Existen objetos inesperados (vistas, procs, etc) en el schema prioglpi.', 1;

    -- 3. Que las 16 tablas estÃ©n vacÃ­as (verificador pre-migraciÃ³n)
    IF EXISTS (
        SELECT 1 FROM sys.partitions p JOIN sys.tables t ON p.object_id = t.object_id JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE s.name = 'prioglpi' AND p.rows > 0 AND p.index_id IN (0, 1)
    ) THROW 51004, 'Hay tablas en prioglpi que no estÃ¡n vacÃ­as (Este verificador corresponde exclusivamente a la etapa previa a la migraciÃ³n de datos).', 1;

    -- 4. Validar Columnas (tabla, nombre, tipo, max_length, precision, scale, nullable, identity)
    CREATE TABLE #ExpectedColumns (
        TableName SYSNAME, ColName SYSNAME, TypeName SYSNAME, MaxLength INT,
        Precision INT, Scale INT, IsNullable BIT, IsIdentity BIT
    );

    INSERT INTO #ExpectedColumns VALUES
    ('app_user', 'id', 'int', 4, 10, 0, 0, 1),
    ('app_user', 'username', 'nvarchar', 510, 0, 0, 0, 0),
    ('app_user', 'password_hash', 'nvarchar', 510, 0, 0, 1, 0),
    ('app_user', 'display_name', 'nvarchar', 510, 0, 0, 0, 0),
    ('app_user', 'role', 'nvarchar', 100, 0, 0, 0, 0),
    ('app_user', 'is_active', 'bit', 1, 1, 0, 0, 0),
    ('app_user', 'glpi_user_id', 'int', 4, 10, 0, 1, 0),
    ('app_user', 'ad_object_id', 'nvarchar', 510, 0, 0, 1, 0),
    ('app_user', 'email', 'nvarchar', 510, 0, 0, 1, 0),
    ('app_user', 'auth_source', 'nvarchar', 100, 0, 0, 0, 0),
    ('app_user', 'directory_active', 'bit', 1, 1, 0, 1, 0),
    ('app_user', 'directory_status_checked_at', 'datetime2', 7, 23, 3, 1, 0),
    ('app_user', 'created_at', 'datetime2', 7, 23, 3, 0, 0),
    ('app_user', 'updated_at', 'datetime2', 7, 23, 3, 0, 0),

    ('user_sector_scope', 'id', 'int', 4, 10, 0, 0, 1),
    ('user_sector_scope', 'user_id', 'int', 4, 10, 0, 0, 0),
    ('user_sector_scope', 'sector_name', 'nvarchar', 510, 0, 0, 0, 0),
    ('user_sector_scope', 'glpi_group_id', 'int', 4, 10, 0, 1, 0),

    ('glpi_ticket_cache', 'ticket_id', 'int', 4, 10, 0, 0, 0),
    ('glpi_ticket_cache', 'title', 'nvarchar', 2000, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'content_plain', 'nvarchar', -1, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'status', 'int', 4, 10, 0, 0, 0),
    ('glpi_ticket_cache', 'status_label', 'nvarchar', 510, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'type', 'int', 4, 10, 0, 0, 0),
    ('glpi_ticket_cache', 'type_label', 'nvarchar', 510, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'priority', 'int', 4, 10, 0, 0, 0),
    ('glpi_ticket_cache', 'priority_label', 'nvarchar', 510, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'opened_at', 'nvarchar', 100, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'updated_at_glpi', 'nvarchar', 100, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'solved_at', 'nvarchar', 100, 0, 0, 1, 0),
    ('glpi_ticket_cache', 'closed_at', 'nvarchar', 100, 0, 0, 1, 0),
    ('glpi_ticket_cache', 'requester_name', 'nvarchar', 510, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'requester_group', 'nvarchar', 510, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'assigned_technician', 'nvarchar', 510, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'assigned_group_ids', 'nvarchar', -1, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'assigned_group_names', 'nvarchar', -1, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'detected_sector', 'nvarchar', 510, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'is_sistemas_scope', 'bit', 1, 1, 0, 0, 0),
    ('glpi_ticket_cache', 'is_tecnologia_scope', 'bit', 1, 1, 0, 0, 0),
    ('glpi_ticket_cache', 'web_url', 'nvarchar', 2000, 0, 0, 0, 0),
    ('glpi_ticket_cache', 'synced_at', 'datetime2', 7, 23, 3, 0, 0),
    ('glpi_ticket_cache', 'requester_user_id', 'int', 4, 10, 0, 1, 0),
    ('glpi_ticket_cache', 'requester_group_id', 'int', 4, 10, 0, 1, 0),
    ('glpi_ticket_cache', 'detected_sector_group_id', 'int', 4, 10, 0, 1, 0),
    ('glpi_ticket_cache', 'detected_sector_name', 'nvarchar', 510, 0, 0, 1, 0),
    ('glpi_ticket_cache', 'sector_source', 'nvarchar', 510, 0, 0, 1, 0),
    ('glpi_ticket_cache', 'category_id', 'int', 4, 10, 0, 1, 0),
    ('glpi_ticket_cache', 'entity_id', 'int', 4, 10, 0, 1, 0),
    ('glpi_ticket_cache', 'location_id', 'int', 4, 10, 0, 1, 0),
    ('glpi_ticket_cache', 'request_type_id', 'int', 4, 10, 0, 1, 0),
    ('glpi_ticket_cache', 'urgency', 'int', 4, 10, 0, 1, 0),
    ('glpi_ticket_cache', 'impact', 'int', 4, 10, 0, 1, 0),
    ('glpi_ticket_cache', 'glpi_priority', 'int', 4, 10, 0, 1, 0),

    ('ticket_ranking', 'id', 'int', 4, 10, 0, 0, 1),
    ('ticket_ranking', 'ticket_id', 'int', 4, 10, 0, 0, 0),
    ('ticket_ranking', 'sector_name', 'nvarchar', 510, 0, 0, 0, 0),
    ('ticket_ranking', 'glpi_group_id', 'int', 4, 10, 0, 0, 0),
    ('ticket_ranking', 'rank_position', 'int', 4, 10, 0, 0, 0),
    ('ticket_ranking', 'owner_user_id', 'int', 4, 10, 0, 0, 0),
    ('ticket_ranking', 'created_by_user_id', 'int', 4, 10, 0, 0, 0),
    ('ticket_ranking', 'updated_by_user_id', 'int', 4, 10, 0, 0, 0),
    ('ticket_ranking', 'created_at', 'datetime2', 7, 23, 3, 0, 0),
    ('ticket_ranking', 'updated_at', 'datetime2', 7, 23, 3, 0, 0),
    ('ticket_ranking', 'is_active', 'bit', 1, 1, 0, 0, 0),

    ('sector_referent_assignment', 'id', 'int', 4, 10, 0, 0, 1),
    ('sector_referent_assignment', 'glpi_group_id', 'int', 4, 10, 0, 0, 0),
    ('sector_referent_assignment', 'referent_user_id', 'int', 4, 10, 0, 0, 0),
    ('sector_referent_assignment', 'assigned_at', 'datetime2', 7, 23, 3, 0, 0),
    ('sector_referent_assignment', 'updated_at', 'datetime2', 7, 23, 3, 0, 0),

    ('ticket_coordination', 'id', 'int', 4, 10, 0, 0, 1),
    ('ticket_coordination', 'ticket_id', 'int', 4, 10, 0, 0, 0),
    ('ticket_coordination', 'progress_percent', 'int', 4, 10, 0, 0, 0),
    ('ticket_coordination', 'coordinator_comment', 'nvarchar', -1, 0, 0, 0, 0),
    ('ticket_coordination', 'estimated_delivery_date', 'nvarchar', 100, 0, 0, 1, 0),
    ('ticket_coordination', 'updated_by_user_id', 'int', 4, 10, 0, 0, 0),
    ('ticket_coordination', 'updated_at', 'datetime2', 7, 23, 3, 0, 0),

    ('sync_run', 'id', 'int', 4, 10, 0, 0, 1),
    ('sync_run', 'started_at', 'datetime2', 7, 23, 3, 0, 0),
    ('sync_run', 'finished_at', 'datetime2', 7, 23, 3, 1, 0),
    ('sync_run', 'status', 'nvarchar', 100, 0, 0, 0, 0),
    ('sync_run', 'tickets_fetched', 'int', 4, 10, 0, 0, 0),
    ('sync_run', 'error_message', 'nvarchar', -1, 0, 0, 1, 0),
    ('sync_run', 'sistemas_count', 'int', 4, 10, 0, 0, 0),
    ('sync_run', 'tecnologia_count', 'int', 4, 10, 0, 0, 0),
    ('sync_run', 'unrouted_count', 'int', 4, 10, 0, 0, 0),
    ('sync_run', 'active_count', 'int', 4, 10, 0, 0, 0),
    ('sync_run', 'history_count', 'int', 4, 10, 0, 0, 0),
    ('sync_run', 'sector_source_count', 'int', 4, 10, 0, 0, 0),
    ('sync_run', 'no_sector_count', 'int', 4, 10, 0, 0, 0),
    ('sync_run', 'users_count', 'int', 4, 10, 0, 0, 0),
    ('sync_run', 'groups_count', 'int', 4, 10, 0, 0, 0),
    ('sync_run', 'memberships_count', 'int', 4, 10, 0, 0, 0),
    ('sync_run', 'public_notes_count', 'int', 4, 10, 0, 0, 0),
    ('sync_run', 'private_notes_count', 'int', 4, 10, 0, 0, 0),
    ('sync_run', 'duration_ms', 'int', 4, 10, 0, 0, 0),

    ('audit_log', 'id', 'int', 4, 10, 0, 0, 1),
    ('audit_log', 'user_id', 'int', 4, 10, 0, 1, 0),
    ('audit_log', 'action', 'nvarchar', 510, 0, 0, 0, 0),
    ('audit_log', 'entity_type', 'nvarchar', 510, 0, 0, 0, 0),
    ('audit_log', 'entity_id', 'nvarchar', 510, 0, 0, 0, 0),
    ('audit_log', 'before_json', 'nvarchar', -1, 0, 0, 1, 0),
    ('audit_log', 'after_json', 'nvarchar', -1, 0, 0, 1, 0),
    ('audit_log', 'created_at', 'datetime2', 7, 23, 3, 0, 0),
    ('audit_log', 'actor_name', 'nvarchar', 510, 0, 0, 1, 0),
    ('audit_log', 'actor_username', 'nvarchar', 510, 0, 0, 1, 0),

    ('glpi_group_cache', 'group_id', 'int', 4, 10, 0, 0, 0),
    ('glpi_group_cache', 'name', 'nvarchar', 510, 0, 0, 0, 0),
    ('glpi_group_cache', 'complete_name', 'nvarchar', 2000, 0, 0, 0, 0),
    ('glpi_group_cache', 'parent_group_id', 'int', 4, 10, 0, 1, 0),
    ('glpi_group_cache', 'flags', 'nvarchar', 510, 0, 0, 1, 0),
    ('glpi_group_cache', 'synced_at', 'datetime2', 7, 23, 3, 0, 0),

    ('glpi_user_cache', 'glpi_user_id', 'int', 4, 10, 0, 0, 0),
    ('glpi_user_cache', 'username', 'nvarchar', 510, 0, 0, 0, 0),
    ('glpi_user_cache', 'nombres', 'nvarchar', 510, 0, 0, 0, 0),
    ('glpi_user_cache', 'display_name', 'nvarchar', 510, 0, 0, 0, 0),
    ('glpi_user_cache', 'default_group_id', 'int', 4, 10, 0, 1, 0),
    ('glpi_user_cache', 'is_active', 'bit', 1, 1, 0, 0, 0),
    ('glpi_user_cache', 'synced_at', 'datetime2', 7, 23, 3, 0, 0),

    ('glpi_user_group_membership', 'id', 'int', 4, 10, 0, 0, 1),
    ('glpi_user_group_membership', 'user_id', 'int', 4, 10, 0, 0, 0),
    ('glpi_user_group_membership', 'group_id', 'int', 4, 10, 0, 0, 0),
    ('glpi_user_group_membership', 'is_manager', 'bit', 1, 1, 0, 0, 0),
    ('glpi_user_group_membership', 'is_delegate', 'bit', 1, 1, 0, 0, 0),
    ('glpi_user_group_membership', 'is_dynamic', 'bit', 1, 1, 0, 0, 0),

    ('glpi_ticket_group_actor', 'id', 'int', 4, 10, 0, 0, 1),
    ('glpi_ticket_group_actor', 'ticket_id', 'int', 4, 10, 0, 0, 0),
    ('glpi_ticket_group_actor', 'group_id', 'int', 4, 10, 0, 0, 0),
    ('glpi_ticket_group_actor', 'actor_type', 'int', 4, 10, 0, 0, 0),

    ('glpi_ticket_user_actor', 'id', 'int', 4, 10, 0, 0, 1),
    ('glpi_ticket_user_actor', 'ticket_id', 'int', 4, 10, 0, 0, 0),
    ('glpi_ticket_user_actor', 'glpi_user_id', 'int', 4, 10, 0, 0, 0),
    ('glpi_ticket_user_actor', 'actor_type', 'int', 4, 10, 0, 0, 0),

    ('glpi_followup_cache', 'followup_id', 'int', 4, 10, 0, 0, 0),
    ('glpi_followup_cache', 'ticket_id', 'int', 4, 10, 0, 0, 0),
    ('glpi_followup_cache', 'author', 'nvarchar', 510, 0, 0, 1, 0),
    ('glpi_followup_cache', 'content_plain', 'nvarchar', -1, 0, 0, 0, 0),
    ('glpi_followup_cache', 'is_private', 'bit', 1, 1, 0, 0, 0),
    ('glpi_followup_cache', 'created_at', 'datetime2', 7, 23, 3, 0, 0),
    ('glpi_followup_cache', 'updated_at', 'datetime2', 7, 23, 3, 0, 0),

    ('glpi_task_cache', 'task_id', 'int', 4, 10, 0, 0, 0),
    ('glpi_task_cache', 'ticket_id', 'int', 4, 10, 0, 0, 0),
    ('glpi_task_cache', 'author', 'nvarchar', 510, 0, 0, 1, 0),
    ('glpi_task_cache', 'technician', 'nvarchar', 510, 0, 0, 1, 0),
    ('glpi_task_cache', 'tech_group', 'nvarchar', 510, 0, 0, 1, 0),
    ('glpi_task_cache', 'content_plain', 'nvarchar', -1, 0, 0, 0, 0),
    ('glpi_task_cache', 'is_private', 'bit', 1, 1, 0, 0, 0),
    ('glpi_task_cache', 'state', 'int', 4, 10, 0, 0, 0),
    ('glpi_task_cache', 'created_at', 'datetime2', 7, 23, 3, 0, 0),
    ('glpi_task_cache', 'updated_at', 'datetime2', 7, 23, 3, 0, 0),

    ('login_attempt', 'id', 'int', 4, 10, 0, 0, 1),
    ('login_attempt', 'account_key_hash', 'nvarchar', 510, 0, 0, 0, 0),
    ('login_attempt', 'ip_key_hash', 'nvarchar', 510, 0, 0, 1, 0),
    ('login_attempt', 'attempted_at', 'datetime2', 7, 23, 3, 0, 0),
    ('login_attempt', 'success', 'bit', 1, 1, 0, 0, 0);

    IF EXISTS (
        SELECT e.TableName, e.ColName FROM #ExpectedColumns e
        LEFT JOIN sys.columns c ON c.name = e.ColName AND c.object_id = OBJECT_ID('prioglpi.' + e.TableName)
        WHERE c.name IS NULL
    ) THROW 51005, 'Faltan columnas esperadas en las tablas de prioglpi.', 1;

    IF EXISTS (
        SELECT t.name, c.name FROM sys.columns c
        JOIN sys.tables t ON c.object_id = t.object_id
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        LEFT JOIN #ExpectedColumns e ON e.TableName = t.name AND e.ColName = c.name
        WHERE s.name = 'prioglpi' AND e.ColName IS NULL
    ) THROW 51006, 'Existen columnas no esperadas en las tablas de prioglpi.', 1;

    IF EXISTS (
        SELECT e.TableName, e.ColName
        FROM #ExpectedColumns e
        JOIN sys.columns c ON c.name = e.ColName AND c.object_id = OBJECT_ID('prioglpi.' + e.TableName)
        JOIN sys.types ty ON c.user_type_id = ty.user_type_id
        WHERE ty.name <> e.TypeName
           OR c.max_length <> e.MaxLength
           OR c.precision <> e.Precision
           OR c.scale <> e.Scale
           OR c.is_nullable <> e.IsNullable
           OR c.is_identity <> e.IsIdentity
    ) THROW 51007, 'Una o mÃ¡s columnas no tienen los metadatos exactos esperados (tipo, longitud, precisiÃ³n, escala, nulabilidad, identidad).', 1;

    -- 5. Validar PK (exactamente 16)
    CREATE TABLE #ExpectedPKs (TableName SYSNAME, PkName SYSNAME, ColName SYSNAME, KeyOrdinal INT);
    INSERT INTO #ExpectedPKs VALUES
    ('app_user', 'pk_app_user', 'id', 1),
    ('user_sector_scope', 'pk_user_sector_scope', 'id', 1),
    ('glpi_ticket_cache', 'pk_glpi_ticket_cache', 'ticket_id', 1),
    ('ticket_ranking', 'pk_ticket_ranking', 'id', 1),
    ('sector_referent_assignment', 'pk_sector_referent_assignment', 'id', 1),
    ('ticket_coordination', 'pk_ticket_coordination', 'id', 1),
    ('sync_run', 'pk_sync_run', 'id', 1),
    ('audit_log', 'pk_audit_log', 'id', 1),
    ('glpi_group_cache', 'pk_glpi_group_cache', 'group_id', 1),
    ('glpi_user_cache', 'pk_glpi_user_cache', 'glpi_user_id', 1),
    ('glpi_user_group_membership', 'pk_glpi_user_group_membership', 'id', 1),
    ('glpi_ticket_group_actor', 'pk_glpi_ticket_group_actor', 'id', 1),
    ('glpi_ticket_user_actor', 'pk_glpi_ticket_user_actor', 'id', 1),
    ('glpi_followup_cache', 'pk_glpi_followup_cache', 'followup_id', 1),
    ('glpi_task_cache', 'pk_glpi_task_cache', 'task_id', 1),
    ('login_attempt', 'pk_login_attempt', 'id', 1);

    IF EXISTS (
        SELECT e.TableName FROM #ExpectedPKs e
        LEFT JOIN sys.indexes i ON i.name = e.PkName AND i.object_id = OBJECT_ID('prioglpi.' + e.TableName)
            AND i.is_primary_key = 1
            AND i.type = 1
            AND i.is_disabled = 0
            AND i.is_hypothetical = 0
        LEFT JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id AND ic.key_ordinal = e.KeyOrdinal
        LEFT JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id AND c.name = e.ColName
        WHERE c.name IS NULL
    ) THROW 51008, 'Faltan PKs o su definiciÃ³n (columnas, orden, tipo, estado) es incorrecta.', 1;

    IF EXISTS (
        SELECT 1
        FROM sys.indexes AS i
        INNER JOIN sys.tables AS t
            ON t.object_id = i.object_id
        INNER JOIN sys.schemas AS s
            ON s.schema_id = t.schema_id
        INNER JOIN sys.index_columns AS ic
            ON ic.object_id = i.object_id
           AND ic.index_id = i.index_id
        WHERE s.name = 'prioglpi' AND i.is_primary_key = 1
        GROUP BY t.name, i.name
        HAVING COUNT(ic.column_id) <> 1
    ) THROW 510081, 'Existen PKs con columnas inesperadas adicionales.', 1;

    IF (SELECT COUNT(*) FROM sys.key_constraints k JOIN sys.schemas s ON k.schema_id = s.schema_id WHERE s.name = 'prioglpi' AND k.type = 'PK') <> 16
        THROW 51009, 'La cantidad de PKs reales difiere de 16.', 1;

    -- 6. Validar FKs (exactamente 8)
    CREATE TABLE #ExpectedFKs (FkName SYSNAME, ParentTable SYSNAME, ParentCol SYSNAME, RefTable SYSNAME, RefCol SYSNAME, DeleteAction INT, UpdateAction INT);
    INSERT INTO #ExpectedFKs VALUES
    ('fk_user_sector_scope_user', 'user_sector_scope', 'user_id', 'app_user', 'id', 1, 0),
    ('fk_ticket_ranking_ticket', 'ticket_ranking', 'ticket_id', 'glpi_ticket_cache', 'ticket_id', 1, 0),
    ('fk_ticket_ranking_owner', 'ticket_ranking', 'owner_user_id', 'app_user', 'id', 0, 0),
    ('fk_ticket_ranking_created_by', 'ticket_ranking', 'created_by_user_id', 'app_user', 'id', 0, 0),
    ('fk_ticket_ranking_updated_by', 'ticket_ranking', 'updated_by_user_id', 'app_user', 'id', 0, 0),
    ('fk_sector_referent_assignment_referent', 'sector_referent_assignment', 'referent_user_id', 'app_user', 'id', 0, 0),
    ('fk_ticket_coordination_ticket', 'ticket_coordination', 'ticket_id', 'glpi_ticket_cache', 'ticket_id', 1, 0),
    ('fk_ticket_coordination_updated_by', 'ticket_coordination', 'updated_by_user_id', 'app_user', 'id', 0, 0),
    ('fk_audit_log_user', 'audit_log', 'user_id', 'app_user', 'id', 2, 0);

    IF EXISTS (
        SELECT e.FkName FROM #ExpectedFKs e
        LEFT JOIN sys.foreign_keys fk ON fk.name = e.FkName
            AND fk.parent_object_id = OBJECT_ID('prioglpi.' + e.ParentTable)
            AND fk.referenced_object_id = OBJECT_ID('prioglpi.' + e.RefTable)
            AND fk.delete_referential_action = e.DeleteAction
            AND fk.update_referential_action = e.UpdateAction
            AND fk.is_disabled = 0
            AND fk.is_not_trusted = 0
        LEFT JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        LEFT JOIN sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id AND pc.name = e.ParentCol
        LEFT JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id AND rc.name = e.RefCol
        WHERE pc.name IS NULL OR rc.name IS NULL
    ) THROW 51010, 'Faltan FKs o su definiciÃ³n (columnas, acciones, habilitada, trusted) es incorrecta.', 1;

    IF EXISTS (
        SELECT fk.name FROM sys.foreign_keys fk JOIN sys.schemas s ON fk.schema_id = s.schema_id
        JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        WHERE s.name = 'prioglpi'
        GROUP BY fk.name HAVING COUNT(fkc.constraint_column_id) > 1
    ) THROW 510101, 'Existen FKs con columnas inesperadas adicionales.', 1;

    IF (SELECT COUNT(*) FROM sys.foreign_keys fk JOIN sys.schemas s ON fk.schema_id = s.schema_id WHERE s.name = 'prioglpi') <> 8
        THROW 51011, 'La cantidad de FKs reales difiere de 8.', 1;

    -- 7. Validar Ãndices (UNIQUE: 6, UNIQUE FILTRADO: 3, NO UNIQUE: 16) = 25 totales
    CREATE TABLE #ExpectedIndexes (IndexName SYSNAME, TableName SYSNAME, ColName SYSNAME, KeyOrdinal INT, IsUnique BIT, Filter NVARCHAR(MAX));
    INSERT INTO #ExpectedIndexes VALUES
    -- UNIQUE (9)
    ('uq_app_user_username', 'app_user', 'username', 1, 1, NULL),
    ('idx_app_user_glpi_user_id', 'app_user', 'glpi_user_id', 1, 1, '([glpi_user_id] IS NOT NULL)'),
    ('idx_app_user_ad_object_id', 'app_user', 'ad_object_id', 1, 1, '([ad_object_id] IS NOT NULL)'),
    ('uq_user_sector_scope_user_sector', 'user_sector_scope', 'user_id', 1, 1, NULL),
    ('uq_user_sector_scope_user_sector', 'user_sector_scope', 'sector_name', 2, 1, NULL),
    ('idx_user_sector_scope_user_group', 'user_sector_scope', 'user_id', 1, 1, '([glpi_group_id] IS NOT NULL)'),
    ('idx_user_sector_scope_user_group', 'user_sector_scope', 'glpi_group_id', 2, 1, '([glpi_group_id] IS NOT NULL)'),
    ('uq_ticket_ranking_owner_ticket', 'ticket_ranking', 'owner_user_id', 1, 1, NULL),
    ('uq_ticket_ranking_owner_ticket', 'ticket_ranking', 'ticket_id', 2, 1, NULL),
    ('uq_sector_referent_assignment_group', 'sector_referent_assignment', 'glpi_group_id', 1, 1, NULL),
    ('uq_ticket_coordination_ticket', 'ticket_coordination', 'ticket_id', 1, 1, NULL),
    ('uq_glpi_user_group_membership_user_group', 'glpi_user_group_membership', 'user_id', 1, 1, NULL),
    ('uq_glpi_user_group_membership_user_group', 'glpi_user_group_membership', 'group_id', 2, 1, NULL),
    -- NO UNIQUE (16)
    ('idx_user_sector_scope_group_id', 'user_sector_scope', 'glpi_group_id', 1, 0, NULL),
    ('idx_ticket_ranking_owner_active_rank', 'ticket_ranking', 'owner_user_id', 1, 0, NULL),
    ('idx_ticket_ranking_owner_active_rank', 'ticket_ranking', 'is_active', 2, 0, NULL),
    ('idx_ticket_ranking_owner_active_rank', 'ticket_ranking', 'rank_position', 3, 0, NULL),
    ('idx_sector_referent_assignment_referent', 'sector_referent_assignment', 'referent_user_id', 1, 0, NULL),
    ('idx_audit_log_entity', 'audit_log', 'entity_type', 1, 0, NULL),
    ('idx_audit_log_entity', 'audit_log', 'entity_id', 2, 0, NULL),
    ('idx_audit_log_created_at', 'audit_log', 'created_at', 1, 0, NULL),
    ('idx_audit_log_user_id', 'audit_log', 'user_id', 1, 0, NULL),
    ('idx_audit_log_actor_username', 'audit_log', 'actor_username', 1, 0, NULL),
    ('idx_audit_log_action', 'audit_log', 'action', 1, 0, NULL),
    ('idx_glpi_ticket_group_actor_t_g_a', 'glpi_ticket_group_actor', 'ticket_id', 1, 0, NULL),
    ('idx_glpi_ticket_group_actor_t_g_a', 'glpi_ticket_group_actor', 'group_id', 2, 0, NULL),
    ('idx_glpi_ticket_group_actor_t_g_a', 'glpi_ticket_group_actor', 'actor_type', 3, 0, NULL),
    ('idx_glpi_ticket_group_actor_group', 'glpi_ticket_group_actor', 'group_id', 1, 0, NULL),
    ('idx_glpi_ticket_user_actor_t_u_a', 'glpi_ticket_user_actor', 'ticket_id', 1, 0, NULL),
    ('idx_glpi_ticket_user_actor_t_u_a', 'glpi_ticket_user_actor', 'glpi_user_id', 2, 0, NULL),
    ('idx_glpi_ticket_user_actor_t_u_a', 'glpi_ticket_user_actor', 'actor_type', 3, 0, NULL),
    ('idx_glpi_ticket_user_actor_user', 'glpi_ticket_user_actor', 'glpi_user_id', 1, 0, NULL),
    ('idx_glpi_followup_cache_ticket', 'glpi_followup_cache', 'ticket_id', 1, 0, NULL),
    ('idx_glpi_task_cache_ticket', 'glpi_task_cache', 'ticket_id', 1, 0, NULL),
    ('idx_login_attempt_account_time', 'login_attempt', 'account_key_hash', 1, 0, NULL),
    ('idx_login_attempt_account_time', 'login_attempt', 'attempted_at', 2, 0, NULL),
    ('idx_login_attempt_ip_time', 'login_attempt', 'ip_key_hash', 1, 0, NULL),
    ('idx_login_attempt_ip_time', 'login_attempt', 'attempted_at', 2, 0, NULL);

    IF EXISTS (
        SELECT e.IndexName FROM #ExpectedIndexes e
        LEFT JOIN sys.indexes i ON i.name = e.IndexName AND i.object_id = OBJECT_ID('prioglpi.' + e.TableName)
            AND i.is_unique = e.IsUnique AND i.is_primary_key = 0
            AND i.type = 2
            AND i.is_disabled = 0
            AND i.is_hypothetical = 0
            AND ISNULL(i.filter_definition, '') = ISNULL(e.Filter, '')
        LEFT JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id AND ic.key_ordinal = e.KeyOrdinal AND ic.is_included_column = 0
        LEFT JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id AND c.name = e.ColName
        WHERE i.name IS NULL OR c.name IS NULL
    ) THROW 51012, 'Faltan Ã­ndices (Ãºnicos o no Ãºnicos) o su definiciÃ³n (columnas, tipo, unicidad, estado, filtro) es incorrecta.', 1;

    -- Verificar que no haya columnas extras en los Ã­ndices (ni included)
    IF EXISTS (
        SELECT 1
        FROM (
            SELECT
                t.name AS TableName,
                i.name AS IndexName,
                COUNT(ic.column_id) AS ActualColumnCount
            FROM sys.indexes AS i
            INNER JOIN sys.tables AS t
                ON t.object_id = i.object_id
            INNER JOIN sys.schemas AS s
                ON s.schema_id = t.schema_id
            INNER JOIN sys.index_columns AS ic
                ON ic.object_id = i.object_id
               AND ic.index_id = i.index_id
            WHERE s.name = 'prioglpi'
              AND i.is_primary_key = 0
            GROUP BY t.name, i.name
        ) AS actual
        LEFT JOIN (
            SELECT
                TableName,
                IndexName,
                COUNT(*) AS ExpectedColumnCount
            FROM #ExpectedIndexes
            GROUP BY TableName, IndexName
        ) AS expected
            ON expected.TableName = actual.TableName COLLATE DATABASE_DEFAULT
           AND expected.IndexName = actual.IndexName COLLATE DATABASE_DEFAULT
        WHERE expected.IndexName IS NULL
           OR actual.ActualColumnCount <> expected.ExpectedColumnCount
    )
        THROW 510121,
            'Existen Ã­ndices con columnas adicionales inesperadas (incluyendo INCLUDE).',
            1;

    IF (
        SELECT COUNT(*)
        FROM sys.indexes AS i
        INNER JOIN sys.tables AS t
            ON t.object_id = i.object_id
        INNER JOIN sys.schemas AS s
            ON s.schema_id = t.schema_id
        WHERE s.name = 'prioglpi'
          AND i.is_unique = 1
          AND i.is_primary_key = 0
    ) <> 9
        THROW 51013,
            'La cantidad de Ã­ndices Ãºnicos reales difiere de 9.',
            1;

    IF (
        SELECT COUNT(*)
        FROM sys.indexes AS i
        INNER JOIN sys.tables AS t
            ON t.object_id = i.object_id
        INNER JOIN sys.schemas AS s
            ON s.schema_id = t.schema_id
        WHERE s.name = 'prioglpi'
          AND i.is_unique = 0
          AND i.is_primary_key = 0
          AND i.type = 2
    ) <> 16
        THROW 510131,
            'La cantidad de Ã­ndices no Ãºnicos reales difiere de 16.',
            1;

    -- 8. Validar Defaults (exactamente 53)
    CREATE TABLE #ExpectedDefaults (TableName SYSNAME, ColName SYSNAME, DefaultName SYSNAME, Definition NVARCHAR(MAX));
    INSERT INTO #ExpectedDefaults VALUES
    ('app_user', 'is_active', 'df_app_user_is_active', '((1))'),
    ('app_user', 'auth_source', 'df_app_user_auth_source', '(''local'')'),
    ('app_user', 'created_at', 'df_app_user_created_at', '(sysutcdatetime())'),
    ('glpi_ticket_cache', 'content_plain', 'df_glpi_ticket_cache_content_plain', '('''')'),
    ('glpi_ticket_cache', 'status_label', 'df_glpi_ticket_cache_status_label', '('''')'),
    ('glpi_ticket_cache', 'type', 'df_glpi_ticket_cache_type', '((1))'),
    ('glpi_ticket_cache', 'type_label', 'df_glpi_ticket_cache_type_label', '('''')'),
    ('glpi_ticket_cache', 'priority', 'df_glpi_ticket_cache_priority', '((3))'),
    ('glpi_ticket_cache', 'priority_label', 'df_glpi_ticket_cache_priority_label', '('''')'),
    ('glpi_ticket_cache', 'opened_at', 'df_glpi_ticket_cache_opened_at', '('''')'),
    ('glpi_ticket_cache', 'updated_at_glpi', 'df_glpi_ticket_cache_updated_at_glpi', '('''')'),
    ('glpi_ticket_cache', 'requester_name', 'df_glpi_ticket_cache_requester_name', '('''')'),
    ('glpi_ticket_cache', 'requester_group', 'df_glpi_ticket_cache_requester_group', '('''')'),
    ('glpi_ticket_cache', 'assigned_technician', 'df_glpi_ticket_cache_assigned_technician', '('''')'),
    ('glpi_ticket_cache', 'assigned_group_ids', 'df_glpi_ticket_cache_assigned_group_ids', '('''')'),
    ('glpi_ticket_cache', 'assigned_group_names', 'df_glpi_ticket_cache_assigned_group_names', '('''')'),
    ('glpi_ticket_cache', 'detected_sector', 'df_glpi_ticket_cache_detected_sector', '(''Sin sector'')'),
    ('glpi_ticket_cache', 'is_sistemas_scope', 'df_glpi_ticket_cache_is_sistemas_scope', '((0))'),
    ('glpi_ticket_cache', 'is_tecnologia_scope', 'df_glpi_ticket_cache_is_tecnologia_scope', '((0))'),
    ('glpi_ticket_cache', 'web_url', 'df_glpi_ticket_cache_web_url', '('''')'),
    ('glpi_ticket_cache', 'synced_at', 'df_glpi_ticket_cache_synced_at', '(sysutcdatetime())'),
    ('ticket_ranking', 'created_at', 'df_ticket_ranking_created_at', '(sysutcdatetime())'),
    ('ticket_ranking', 'is_active', 'df_ticket_ranking_is_active', '((1))'),
    ('sector_referent_assignment', 'assigned_at', 'df_sector_referent_assignment_assigned_at', '(sysutcdatetime())'),
    ('ticket_coordination', 'progress_percent', 'df_ticket_coordination_progress', '((0))'),
    ('ticket_coordination', 'coordinator_comment', 'df_ticket_coordination_comment', '('''')'),
    ('sync_run', 'started_at', 'df_sync_run_started_at', '(sysutcdatetime())'),
    ('sync_run', 'status', 'df_sync_run_status', '(''running'')'),
    ('sync_run', 'tickets_fetched', 'df_sync_run_tickets', '((0))'),
    ('sync_run', 'sistemas_count', 'df_sync_run_sistemas', '((0))'),
    ('sync_run', 'tecnologia_count', 'df_sync_run_tecnologia', '((0))'),
    ('sync_run', 'unrouted_count', 'df_sync_run_unrouted', '((0))'),
    ('sync_run', 'active_count', 'df_sync_run_active', '((0))'),
    ('sync_run', 'history_count', 'df_sync_run_history', '((0))'),
    ('sync_run', 'sector_source_count', 'df_sync_run_sector_source', '((0))'),
    ('sync_run', 'no_sector_count', 'df_sync_run_no_sector', '((0))'),
    ('sync_run', 'users_count', 'df_sync_run_users', '((0))'),
    ('sync_run', 'groups_count', 'df_sync_run_groups', '((0))'),
    ('sync_run', 'memberships_count', 'df_sync_run_memberships', '((0))'),
    ('sync_run', 'public_notes_count', 'df_sync_run_public_notes', '((0))'),
    ('sync_run', 'private_notes_count', 'df_sync_run_private_notes', '((0))'),
    ('sync_run', 'duration_ms', 'df_sync_run_duration', '((0))'),
    ('audit_log', 'created_at', 'df_audit_log_created_at', '(sysutcdatetime())'),
    ('glpi_group_cache', 'synced_at', 'df_glpi_group_cache_synced_at', '(sysutcdatetime())'),
    ('glpi_user_cache', 'is_active', 'df_glpi_user_cache_is_active', '((1))'),
    ('glpi_user_cache', 'synced_at', 'df_glpi_user_cache_synced_at', '(sysutcdatetime())'),
    ('glpi_user_group_membership', 'is_manager', 'df_glpi_user_group_membership_is_manager', '((0))'),
    ('glpi_user_group_membership', 'is_delegate', 'df_glpi_user_group_membership_is_delegate', '((0))'),
    ('glpi_user_group_membership', 'is_dynamic', 'df_glpi_user_group_membership_is_dynamic', '((0))'),
    ('glpi_followup_cache', 'is_private', 'df_glpi_followup_cache_is_private', '((0))'),
    ('glpi_task_cache', 'is_private', 'df_glpi_task_cache_is_private', '((0))'),
    ('login_attempt', 'attempted_at', 'df_login_attempt_attempted_at', '(sysutcdatetime())'),
    ('login_attempt', 'success', 'df_login_attempt_success', '((0))');

    IF EXISTS (
        SELECT e.DefaultName FROM #ExpectedDefaults e
        LEFT JOIN sys.default_constraints d ON d.name = e.DefaultName
            AND d.parent_object_id = OBJECT_ID('prioglpi.' + e.TableName)
            AND REPLACE(REPLACE(d.definition, ' ', ''), '(', '') = REPLACE(REPLACE(e.Definition, ' ', ''), '(', '')
        LEFT JOIN sys.columns c ON d.parent_column_id = c.column_id AND d.parent_object_id = c.object_id AND c.name = e.ColName
        WHERE d.name IS NULL OR c.name IS NULL
    ) THROW 51014, 'Faltan restricciones DEFAULT, tienen nombre incorrecto, o su definiciÃ³n/columna no coincide.', 1;

    IF (SELECT COUNT(*) FROM sys.default_constraints d JOIN sys.schemas s ON d.schema_id = s.schema_id WHERE s.name = 'prioglpi') <> 53
        THROW 510141, 'La cantidad exacta de restricciones DEFAULT difiere de 53.', 1;

    -- 9. Validar Check constraints (exactamente 45)
    CREATE TABLE #ExpectedChecks (ChkName SYSNAME, TableName SYSNAME, Definition NVARCHAR(MAX));
    INSERT INTO #ExpectedChecks VALUES
    ('chk_app_user_role', 'app_user', '([role]=''system'' OR [role]=''referente'' OR [role]=''priorizador'' OR [role]=''coordinador_sistemas'' OR [role]=''admin'' OR [role]=''tecnico_sistemas'')'),
    ('chk_app_user_auth_source', 'app_user', '([auth_source]=''system'' OR [auth_source]=''ad'' OR [auth_source]=''local'')'),
    ('chk_app_user_glpi_user_id', 'app_user', '([glpi_user_id] IS NULL OR [glpi_user_id]>(0))'),
    ('chk_user_sector_scope_group_id', 'user_sector_scope', '([glpi_group_id] IS NULL OR [glpi_group_id]>(0))'),
    ('chk_glpi_ticket_cache_ticket_id', 'glpi_ticket_cache', '([ticket_id]>(0))'),
    ('chk_glpi_ticket_cache_req_user_id', 'glpi_ticket_cache', '([requester_user_id] IS NULL OR [requester_user_id]>(0))'),
    ('chk_glpi_ticket_cache_req_group_id', 'glpi_ticket_cache', '([requester_group_id] IS NULL OR [requester_group_id]>(0))'),
    ('chk_glpi_ticket_cache_det_group_id', 'glpi_ticket_cache', '([detected_sector_group_id] IS NULL OR [detected_sector_group_id]>(0))'),
    ('chk_ticket_ranking_ticket_id', 'ticket_ranking', '([ticket_id]>(0))'),
    ('chk_ticket_ranking_group_id', 'ticket_ranking', '([glpi_group_id]>(0))'),
    ('chk_ticket_ranking_position', 'ticket_ranking', '([rank_position]>(0))'),
    ('chk_ticket_ranking_owner_id', 'ticket_ranking', '([owner_user_id]>(0))'),
    ('chk_sector_referent_assignment_group_id', 'sector_referent_assignment', '([glpi_group_id]>(0))'),
    ('chk_ticket_coordination_ticket_id', 'ticket_coordination', '([ticket_id]>(0))'),
    ('chk_ticket_coordination_progress', 'ticket_coordination', '([progress_percent]>=(0) AND [progress_percent]<=(100))'),
    ('chk_sync_run_status', 'sync_run', '([status]=''error'' OR [status]=''success'' OR [status]=''running'')'),
    ('chk_sync_run_tickets', 'sync_run', '([tickets_fetched]>=(0))'),
    ('chk_sync_run_sistemas', 'sync_run', '([sistemas_count]>=(0))'),
    ('chk_sync_run_tecnologia', 'sync_run', '([tecnologia_count]>=(0))'),
    ('chk_sync_run_unrouted', 'sync_run', '([unrouted_count]>=(0))'),
    ('chk_sync_run_active', 'sync_run', '([active_count]>=(0))'),
    ('chk_sync_run_history', 'sync_run', '([history_count]>=(0))'),
    ('chk_sync_run_sector_source', 'sync_run', '([sector_source_count]>=(0))'),
    ('chk_sync_run_no_sector', 'sync_run', '([no_sector_count]>=(0))'),
    ('chk_sync_run_users', 'sync_run', '([users_count]>=(0))'),
    ('chk_sync_run_groups', 'sync_run', '([groups_count]>=(0))'),
    ('chk_sync_run_memberships', 'sync_run', '([memberships_count]>=(0))'),
    ('chk_sync_run_public_notes', 'sync_run', '([public_notes_count]>=(0))'),
    ('chk_sync_run_private_notes', 'sync_run', '([private_notes_count]>=(0))'),
    ('chk_sync_run_duration', 'sync_run', '([duration_ms]>=(0))'),
    ('chk_glpi_group_cache_group_id', 'glpi_group_cache', '([group_id]>(0))'),
    ('chk_glpi_group_cache_parent_id', 'glpi_group_cache', '([parent_group_id] IS NULL OR [parent_group_id]>(0))'),
    ('chk_glpi_user_cache_glpi_user_id', 'glpi_user_cache', '([glpi_user_id]>(0))'),
    ('chk_glpi_user_cache_default_group_id', 'glpi_user_cache', '([default_group_id] IS NULL OR [default_group_id]>(0))'),
    ('chk_glpi_user_group_membership_user_id', 'glpi_user_group_membership', '([user_id]>(0))'),
    ('chk_glpi_user_group_membership_group_id', 'glpi_user_group_membership', '([group_id]>(0))'),
    ('chk_glpi_ticket_group_actor_type', 'glpi_ticket_group_actor', '([actor_type]=(3) OR [actor_type]=(2) OR [actor_type]=(1))'),
    ('chk_glpi_ticket_group_actor_ticket_id', 'glpi_ticket_group_actor', '([ticket_id]>(0))'),
    ('chk_glpi_ticket_group_actor_group_id', 'glpi_ticket_group_actor', '([group_id]>(0))'),
    ('chk_glpi_ticket_user_actor_type', 'glpi_ticket_user_actor', '([actor_type]=(3) OR [actor_type]=(2) OR [actor_type]=(1))'),
    ('chk_glpi_ticket_user_actor_ticket_id', 'glpi_ticket_user_actor', '([ticket_id]>(0))'),
    ('chk_glpi_ticket_user_actor_glpi_user_id', 'glpi_ticket_user_actor', '([glpi_user_id]>(0))'),
    ('chk_glpi_followup_cache_followup_id', 'glpi_followup_cache', '([followup_id]>(0))'),
    ('chk_glpi_followup_cache_ticket_id', 'glpi_followup_cache', '([ticket_id]>(0))'),
    ('chk_glpi_task_cache_task_id', 'glpi_task_cache', '([task_id]>(0))'),
    ('chk_glpi_task_cache_ticket_id', 'glpi_task_cache', '([ticket_id]>(0))');

    IF EXISTS (
        SELECT e.ChkName FROM #ExpectedChecks e
        LEFT JOIN sys.check_constraints c ON c.name = e.ChkName
            AND c.parent_object_id = OBJECT_ID('prioglpi.' + e.TableName)
            AND c.is_disabled = 0
            AND c.is_not_trusted = 0
            AND REPLACE(REPLACE(c.definition, ' ', ''), '(', '') = REPLACE(REPLACE(e.Definition, ' ', ''), '(', '')
        WHERE c.name IS NULL
    ) THROW 51015, 'Faltan CHECK constraints, estÃ¡n deshabilitados, no son trusted, pertenecen a otra tabla o su definiciÃ³n no coincide.', 1;

    IF (SELECT COUNT(*) FROM sys.check_constraints c JOIN sys.schemas s ON c.schema_id = s.schema_id WHERE s.name = 'prioglpi') <> 45
        THROW 51016, 'La cantidad exacta de CHECK constraints difiere de 45.', 1;

    SELECT 'VALIDACION_ESQUEMA_OK' AS resultado;
END TRY
BEGIN CATCH
    THROW;
END CATCH
