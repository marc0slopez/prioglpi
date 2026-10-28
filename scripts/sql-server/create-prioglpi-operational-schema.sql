-- Ejecutar conectado a la base de datos destino de PrioGLPI.
-- No presupone ninguna base de datos de cliente.
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'prioglpi')
    BEGIN
        EXEC('CREATE SCHEMA [prioglpi]');
    END

    IF EXISTS (
        SELECT 1 FROM sys.schemas s
        WHERE s.name = 'prioglpi' AND (
            EXISTS (SELECT 1 FROM sys.objects o WHERE o.schema_id = s.schema_id) OR
            EXISTS (SELECT 1 FROM sys.types t WHERE t.schema_id = s.schema_id AND t.is_user_defined = 1) OR
            EXISTS (SELECT 1 FROM sys.xml_schema_collections x WHERE x.schema_id = s.schema_id) OR
            EXISTS (SELECT 1 FROM sys.sequences sq WHERE sq.schema_id = s.schema_id)
        )
    )
    BEGIN
        THROW 51000, 'InstalaciÃ³n previa detectada: el esquema prioglpi no estÃ¡ vacÃ­o (contiene tablas, tipos, secuencias u otros objetos). Abortando sin modificar nada.', 1;
    END


    CREATE TABLE [prioglpi].[app_user] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [username] NVARCHAR(255) NOT NULL,
        [password_hash] NVARCHAR(255) NULL,
        [display_name] NVARCHAR(255) NOT NULL,
        [role] NVARCHAR(50) NOT NULL,
        [is_active] BIT NOT NULL CONSTRAINT [df_app_user_is_active] DEFAULT 1,
        [glpi_user_id] INT NULL,
        [ad_object_id] NVARCHAR(255) NULL,
        [email] NVARCHAR(255) NULL,
        [auth_source] NVARCHAR(50) NOT NULL CONSTRAINT [df_app_user_auth_source] DEFAULT 'local',
        [directory_active] BIT NULL,
        [directory_status_checked_at] DATETIME2(3) NULL,
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [df_app_user_created_at] DEFAULT SYSUTCDATETIME(),
        [updated_at] DATETIME2(3) NOT NULL,

        CONSTRAINT [pk_app_user] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [uq_app_user_username] UNIQUE NONCLUSTERED ([username]),
        CONSTRAINT [chk_app_user_role] CHECK ([role] IN ('admin', 'coordinador_sistemas', 'priorizador', 'referente', 'system', 'tecnico_sistemas')),
        CONSTRAINT [chk_app_user_auth_source] CHECK ([auth_source] IN ('local', 'ad', 'system')),
        CONSTRAINT [chk_app_user_glpi_user_id] CHECK ([glpi_user_id] IS NULL OR [glpi_user_id] > 0)
    );

    CREATE UNIQUE NONCLUSTERED INDEX [idx_app_user_glpi_user_id] ON [prioglpi].[app_user]([glpi_user_id]) WHERE [glpi_user_id] IS NOT NULL;
    CREATE UNIQUE NONCLUSTERED INDEX [idx_app_user_ad_object_id] ON [prioglpi].[app_user]([ad_object_id]) WHERE [ad_object_id] IS NOT NULL;

    CREATE TABLE [prioglpi].[user_sector_scope] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [user_id] INT NOT NULL,
        [sector_name] NVARCHAR(255) NOT NULL,
        [glpi_group_id] INT NULL,

        CONSTRAINT [pk_user_sector_scope] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [fk_user_sector_scope_user] FOREIGN KEY ([user_id]) REFERENCES [prioglpi].[app_user]([id]) ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT [uq_user_sector_scope_user_sector] UNIQUE NONCLUSTERED ([user_id], [sector_name]),
        CONSTRAINT [chk_user_sector_scope_group_id] CHECK ([glpi_group_id] IS NULL OR [glpi_group_id] > 0)
    );
    -- NOTA: Se emplea ON UPDATE NO ACTION intencionalmente por SQL Server, ya que los IDs primarios son inmutables
    -- y mÃºltiples rutas de cascada hacia tablas compuestas (como ticket_ranking) podrÃ­an ser incompatibles con el motor.

    CREATE UNIQUE NONCLUSTERED INDEX [idx_user_sector_scope_user_group] ON [prioglpi].[user_sector_scope]([user_id], [glpi_group_id]) WHERE [glpi_group_id] IS NOT NULL;
    CREATE NONCLUSTERED INDEX [idx_user_sector_scope_group_id] ON [prioglpi].[user_sector_scope]([glpi_group_id]);

    CREATE TABLE [prioglpi].[glpi_ticket_cache] (
        [ticket_id] INT NOT NULL,
        [title] NVARCHAR(1000) NOT NULL,
        [content_plain] NVARCHAR(MAX) NOT NULL CONSTRAINT [df_glpi_ticket_cache_content_plain] DEFAULT '',
        [status] INT NOT NULL,
        [status_label] NVARCHAR(255) NOT NULL CONSTRAINT [df_glpi_ticket_cache_status_label] DEFAULT '',
        [type] INT NOT NULL CONSTRAINT [df_glpi_ticket_cache_type] DEFAULT 1,
        [type_label] NVARCHAR(255) NOT NULL CONSTRAINT [df_glpi_ticket_cache_type_label] DEFAULT '',
        [priority] INT NOT NULL CONSTRAINT [df_glpi_ticket_cache_priority] DEFAULT 3,
        [priority_label] NVARCHAR(255) NOT NULL CONSTRAINT [df_glpi_ticket_cache_priority_label] DEFAULT '',
        [opened_at] NVARCHAR(50) NOT NULL CONSTRAINT [df_glpi_ticket_cache_opened_at] DEFAULT '',
        [updated_at_glpi] NVARCHAR(50) NOT NULL CONSTRAINT [df_glpi_ticket_cache_updated_at_glpi] DEFAULT '',
        [solved_at] NVARCHAR(50) NULL,
        [closed_at] NVARCHAR(50) NULL,
        [requester_name] NVARCHAR(255) NOT NULL CONSTRAINT [df_glpi_ticket_cache_requester_name] DEFAULT '',
        [requester_group] NVARCHAR(255) NOT NULL CONSTRAINT [df_glpi_ticket_cache_requester_group] DEFAULT '',
        [assigned_technician] NVARCHAR(255) NOT NULL CONSTRAINT [df_glpi_ticket_cache_assigned_technician] DEFAULT '',
        [assigned_group_ids] NVARCHAR(MAX) NOT NULL CONSTRAINT [df_glpi_ticket_cache_assigned_group_ids] DEFAULT '',
        [assigned_group_names] NVARCHAR(MAX) NOT NULL CONSTRAINT [df_glpi_ticket_cache_assigned_group_names] DEFAULT '',
        [detected_sector] NVARCHAR(255) NOT NULL CONSTRAINT [df_glpi_ticket_cache_detected_sector] DEFAULT 'Sin sector',
        [is_sistemas_scope] BIT NOT NULL CONSTRAINT [df_glpi_ticket_cache_is_sistemas_scope] DEFAULT 0,
        [is_tecnologia_scope] BIT NOT NULL CONSTRAINT [df_glpi_ticket_cache_is_tecnologia_scope] DEFAULT 0,
        [web_url] NVARCHAR(1000) NOT NULL CONSTRAINT [df_glpi_ticket_cache_web_url] DEFAULT '',
        [synced_at] DATETIME2(3) NOT NULL CONSTRAINT [df_glpi_ticket_cache_synced_at] DEFAULT SYSUTCDATETIME(),
        [requester_user_id] INT NULL,
        [requester_group_id] INT NULL,
        [detected_sector_group_id] INT NULL,
        [detected_sector_name] NVARCHAR(255) NULL,
        [sector_source] NVARCHAR(255) NULL,
        [category_id] INT NULL,
        [entity_id] INT NULL,
        [location_id] INT NULL,
        [request_type_id] INT NULL,
        [urgency] INT NULL,
        [impact] INT NULL,
        [glpi_priority] INT NULL,

        CONSTRAINT [pk_glpi_ticket_cache] PRIMARY KEY CLUSTERED ([ticket_id]),
        CONSTRAINT [chk_glpi_ticket_cache_ticket_id] CHECK ([ticket_id] > 0),
        CONSTRAINT [chk_glpi_ticket_cache_req_user_id] CHECK ([requester_user_id] IS NULL OR [requester_user_id] > 0),
        CONSTRAINT [chk_glpi_ticket_cache_req_group_id] CHECK ([requester_group_id] IS NULL OR [requester_group_id] > 0),
        CONSTRAINT [chk_glpi_ticket_cache_det_group_id] CHECK ([detected_sector_group_id] IS NULL OR [detected_sector_group_id] > 0)
    );

    CREATE TABLE [prioglpi].[ticket_ranking] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [ticket_id] INT NOT NULL,
        [sector_name] NVARCHAR(255) NOT NULL,
        [glpi_group_id] INT NOT NULL,
        [rank_position] INT NOT NULL,
        [owner_user_id] INT NOT NULL,
        [created_by_user_id] INT NOT NULL,
        [updated_by_user_id] INT NOT NULL,
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [df_ticket_ranking_created_at] DEFAULT SYSUTCDATETIME(),
        [updated_at] DATETIME2(3) NOT NULL,
        [is_active] BIT NOT NULL CONSTRAINT [df_ticket_ranking_is_active] DEFAULT 1,

        CONSTRAINT [pk_ticket_ranking] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [fk_ticket_ranking_ticket] FOREIGN KEY ([ticket_id]) REFERENCES [prioglpi].[glpi_ticket_cache]([ticket_id]) ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT [fk_ticket_ranking_owner] FOREIGN KEY ([owner_user_id]) REFERENCES [prioglpi].[app_user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT [fk_ticket_ranking_created_by] FOREIGN KEY ([created_by_user_id]) REFERENCES [prioglpi].[app_user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT [fk_ticket_ranking_updated_by] FOREIGN KEY ([updated_by_user_id]) REFERENCES [prioglpi].[app_user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT [uq_ticket_ranking_owner_ticket] UNIQUE NONCLUSTERED ([owner_user_id], [ticket_id]),
        CONSTRAINT [chk_ticket_ranking_ticket_id] CHECK ([ticket_id] > 0),
        CONSTRAINT [chk_ticket_ranking_group_id] CHECK ([glpi_group_id] > 0),
        CONSTRAINT [chk_ticket_ranking_position] CHECK ([rank_position] > 0),
        CONSTRAINT [chk_ticket_ranking_owner_id] CHECK ([owner_user_id] > 0)
    );

    CREATE NONCLUSTERED INDEX [idx_ticket_ranking_owner_active_rank] ON [prioglpi].[ticket_ranking]([owner_user_id], [is_active], [rank_position]);

    CREATE TABLE [prioglpi].[sector_referent_assignment] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [glpi_group_id] INT NOT NULL,
        [referent_user_id] INT NOT NULL,
        [assigned_at] DATETIME2(3) NOT NULL CONSTRAINT [df_sector_referent_assignment_assigned_at] DEFAULT SYSUTCDATETIME(),
        [updated_at] DATETIME2(3) NOT NULL,

        CONSTRAINT [pk_sector_referent_assignment] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [fk_sector_referent_assignment_referent] FOREIGN KEY ([referent_user_id]) REFERENCES [prioglpi].[app_user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT [uq_sector_referent_assignment_group] UNIQUE NONCLUSTERED ([glpi_group_id]),
        CONSTRAINT [chk_sector_referent_assignment_group_id] CHECK ([glpi_group_id] > 0)
    );

    CREATE NONCLUSTERED INDEX [idx_sector_referent_assignment_referent] ON [prioglpi].[sector_referent_assignment]([referent_user_id]);

    CREATE TABLE [prioglpi].[ticket_coordination] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [ticket_id] INT NOT NULL,
        [progress_percent] INT NOT NULL CONSTRAINT [df_ticket_coordination_progress] DEFAULT 0,
        [coordinator_comment] NVARCHAR(MAX) NOT NULL CONSTRAINT [df_ticket_coordination_comment] DEFAULT '',
        [estimated_delivery_date] NVARCHAR(50) NULL,
        [updated_by_user_id] INT NOT NULL,
        [updated_at] DATETIME2(3) NOT NULL,

        CONSTRAINT [pk_ticket_coordination] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [fk_ticket_coordination_ticket] FOREIGN KEY ([ticket_id]) REFERENCES [prioglpi].[glpi_ticket_cache]([ticket_id]) ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT [fk_ticket_coordination_updated_by] FOREIGN KEY ([updated_by_user_id]) REFERENCES [prioglpi].[app_user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT [uq_ticket_coordination_ticket] UNIQUE NONCLUSTERED ([ticket_id]),
        CONSTRAINT [chk_ticket_coordination_ticket_id] CHECK ([ticket_id] > 0),
        CONSTRAINT [chk_ticket_coordination_progress] CHECK ([progress_percent] >= 0 AND [progress_percent] <= 100)
    );

    CREATE TABLE [prioglpi].[sync_run] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [started_at] DATETIME2(3) NOT NULL CONSTRAINT [df_sync_run_started_at] DEFAULT SYSUTCDATETIME(),
        [finished_at] DATETIME2(3) NULL,
        [status] NVARCHAR(50) NOT NULL CONSTRAINT [df_sync_run_status] DEFAULT 'running',
        [tickets_fetched] INT NOT NULL CONSTRAINT [df_sync_run_tickets] DEFAULT 0,
        [error_message] NVARCHAR(MAX) NULL,
        [sistemas_count] INT NOT NULL CONSTRAINT [df_sync_run_sistemas] DEFAULT 0,
        [tecnologia_count] INT NOT NULL CONSTRAINT [df_sync_run_tecnologia] DEFAULT 0,
        [unrouted_count] INT NOT NULL CONSTRAINT [df_sync_run_unrouted] DEFAULT 0,
        [active_count] INT NOT NULL CONSTRAINT [df_sync_run_active] DEFAULT 0,
        [history_count] INT NOT NULL CONSTRAINT [df_sync_run_history] DEFAULT 0,
        [sector_source_count] INT NOT NULL CONSTRAINT [df_sync_run_sector_source] DEFAULT 0,
        [no_sector_count] INT NOT NULL CONSTRAINT [df_sync_run_no_sector] DEFAULT 0,
        [users_count] INT NOT NULL CONSTRAINT [df_sync_run_users] DEFAULT 0,
        [groups_count] INT NOT NULL CONSTRAINT [df_sync_run_groups] DEFAULT 0,
        [memberships_count] INT NOT NULL CONSTRAINT [df_sync_run_memberships] DEFAULT 0,
        [public_notes_count] INT NOT NULL CONSTRAINT [df_sync_run_public_notes] DEFAULT 0,
        [private_notes_count] INT NOT NULL CONSTRAINT [df_sync_run_private_notes] DEFAULT 0,
        [duration_ms] INT NOT NULL CONSTRAINT [df_sync_run_duration] DEFAULT 0,

        CONSTRAINT [pk_sync_run] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [chk_sync_run_status] CHECK ([status] IN ('running', 'success', 'error')),
        CONSTRAINT [chk_sync_run_tickets] CHECK ([tickets_fetched] >= 0),
        CONSTRAINT [chk_sync_run_sistemas] CHECK ([sistemas_count] >= 0),
        CONSTRAINT [chk_sync_run_tecnologia] CHECK ([tecnologia_count] >= 0),
        CONSTRAINT [chk_sync_run_unrouted] CHECK ([unrouted_count] >= 0),
        CONSTRAINT [chk_sync_run_active] CHECK ([active_count] >= 0),
        CONSTRAINT [chk_sync_run_history] CHECK ([history_count] >= 0),
        CONSTRAINT [chk_sync_run_sector_source] CHECK ([sector_source_count] >= 0),
        CONSTRAINT [chk_sync_run_no_sector] CHECK ([no_sector_count] >= 0),
        CONSTRAINT [chk_sync_run_users] CHECK ([users_count] >= 0),
        CONSTRAINT [chk_sync_run_groups] CHECK ([groups_count] >= 0),
        CONSTRAINT [chk_sync_run_memberships] CHECK ([memberships_count] >= 0),
        CONSTRAINT [chk_sync_run_public_notes] CHECK ([public_notes_count] >= 0),
        CONSTRAINT [chk_sync_run_private_notes] CHECK ([private_notes_count] >= 0),
        CONSTRAINT [chk_sync_run_duration] CHECK ([duration_ms] >= 0)
    );

    CREATE TABLE [prioglpi].[audit_log] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [user_id] INT NULL,
        [action] NVARCHAR(255) NOT NULL,
        [entity_type] NVARCHAR(255) NOT NULL,
        [entity_id] NVARCHAR(255) NOT NULL,
        [before_json] NVARCHAR(MAX) NULL,
        [after_json] NVARCHAR(MAX) NULL,
        [created_at] DATETIME2(3) NOT NULL CONSTRAINT [df_audit_log_created_at] DEFAULT SYSUTCDATETIME(),
        [actor_name] NVARCHAR(255) NULL,
        [actor_username] NVARCHAR(255) NULL,

        CONSTRAINT [pk_audit_log] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [fk_audit_log_user] FOREIGN KEY ([user_id]) REFERENCES [prioglpi].[app_user]([id]) ON DELETE SET NULL ON UPDATE NO ACTION
    );

    CREATE NONCLUSTERED INDEX [idx_audit_log_entity] ON [prioglpi].[audit_log]([entity_type], [entity_id]);
    CREATE NONCLUSTERED INDEX [idx_audit_log_created_at] ON [prioglpi].[audit_log]([created_at]);
    CREATE NONCLUSTERED INDEX [idx_audit_log_user_id] ON [prioglpi].[audit_log]([user_id]);
    CREATE NONCLUSTERED INDEX [idx_audit_log_actor_username] ON [prioglpi].[audit_log]([actor_username]);
    CREATE NONCLUSTERED INDEX [idx_audit_log_action] ON [prioglpi].[audit_log]([action]);

    CREATE TABLE [prioglpi].[glpi_group_cache] (
        [group_id] INT NOT NULL,
        [name] NVARCHAR(255) NOT NULL,
        [complete_name] NVARCHAR(1000) NOT NULL,
        [parent_group_id] INT NULL,
        [flags] NVARCHAR(255) NULL,
        [synced_at] DATETIME2(3) NOT NULL CONSTRAINT [df_glpi_group_cache_synced_at] DEFAULT SYSUTCDATETIME(),

        CONSTRAINT [pk_glpi_group_cache] PRIMARY KEY CLUSTERED ([group_id]),
        CONSTRAINT [chk_glpi_group_cache_group_id] CHECK ([group_id] > 0),
        CONSTRAINT [chk_glpi_group_cache_parent_id] CHECK ([parent_group_id] IS NULL OR [parent_group_id] > 0)
    );

    CREATE TABLE [prioglpi].[glpi_user_cache] (
        [glpi_user_id] INT NOT NULL,
        [username] NVARCHAR(255) NOT NULL,
        [nombres] NVARCHAR(255) NOT NULL,
        [display_name] NVARCHAR(255) NOT NULL,
        [default_group_id] INT NULL,
        [is_active] BIT NOT NULL CONSTRAINT [df_glpi_user_cache_is_active] DEFAULT 1,
        [synced_at] DATETIME2(3) NOT NULL CONSTRAINT [df_glpi_user_cache_synced_at] DEFAULT SYSUTCDATETIME(),

        CONSTRAINT [pk_glpi_user_cache] PRIMARY KEY CLUSTERED ([glpi_user_id]),
        CONSTRAINT [chk_glpi_user_cache_glpi_user_id] CHECK ([glpi_user_id] > 0),
        CONSTRAINT [chk_glpi_user_cache_default_group_id] CHECK ([default_group_id] IS NULL OR [default_group_id] > 0)
    );

    CREATE TABLE [prioglpi].[glpi_user_group_membership] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [user_id] INT NOT NULL,
        [group_id] INT NOT NULL,
        [is_manager] BIT NOT NULL CONSTRAINT [df_glpi_user_group_membership_is_manager] DEFAULT 0,
        [is_delegate] BIT NOT NULL CONSTRAINT [df_glpi_user_group_membership_is_delegate] DEFAULT 0,
        [is_dynamic] BIT NOT NULL CONSTRAINT [df_glpi_user_group_membership_is_dynamic] DEFAULT 0,

        CONSTRAINT [pk_glpi_user_group_membership] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [uq_glpi_user_group_membership_user_group] UNIQUE NONCLUSTERED ([user_id], [group_id]),
        CONSTRAINT [chk_glpi_user_group_membership_user_id] CHECK ([user_id] > 0),
        CONSTRAINT [chk_glpi_user_group_membership_group_id] CHECK ([group_id] > 0)
    );

    CREATE TABLE [prioglpi].[glpi_ticket_group_actor] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [ticket_id] INT NOT NULL,
        [group_id] INT NOT NULL,
        [actor_type] INT NOT NULL,

        CONSTRAINT [pk_glpi_ticket_group_actor] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [chk_glpi_ticket_group_actor_type] CHECK ([actor_type] IN (1, 2, 3)),
        CONSTRAINT [chk_glpi_ticket_group_actor_ticket_id] CHECK ([ticket_id] > 0),
        CONSTRAINT [chk_glpi_ticket_group_actor_group_id] CHECK ([group_id] > 0)
    );

    CREATE NONCLUSTERED INDEX [idx_glpi_ticket_group_actor_t_g_a] ON [prioglpi].[glpi_ticket_group_actor]([ticket_id], [group_id], [actor_type]);
    CREATE NONCLUSTERED INDEX [idx_glpi_ticket_group_actor_group] ON [prioglpi].[glpi_ticket_group_actor]([group_id]);

    CREATE TABLE [prioglpi].[glpi_ticket_user_actor] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [ticket_id] INT NOT NULL,
        [glpi_user_id] INT NOT NULL,
        [actor_type] INT NOT NULL,

        CONSTRAINT [pk_glpi_ticket_user_actor] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [chk_glpi_ticket_user_actor_type] CHECK ([actor_type] IN (1, 2, 3)),
        CONSTRAINT [chk_glpi_ticket_user_actor_ticket_id] CHECK ([ticket_id] > 0),
        CONSTRAINT [chk_glpi_ticket_user_actor_glpi_user_id] CHECK ([glpi_user_id] > 0)
    );

    CREATE NONCLUSTERED INDEX [idx_glpi_ticket_user_actor_t_u_a] ON [prioglpi].[glpi_ticket_user_actor]([ticket_id], [glpi_user_id], [actor_type]);
    CREATE NONCLUSTERED INDEX [idx_glpi_ticket_user_actor_user] ON [prioglpi].[glpi_ticket_user_actor]([glpi_user_id]);

    CREATE TABLE [prioglpi].[glpi_followup_cache] (
        [followup_id] INT NOT NULL,
        [ticket_id] INT NOT NULL,
        [author] NVARCHAR(255) NULL,
        [content_plain] NVARCHAR(MAX) NOT NULL,
        [is_private] BIT NOT NULL CONSTRAINT [df_glpi_followup_cache_is_private] DEFAULT 0,
        [created_at] DATETIME2(3) NOT NULL,
        [updated_at] DATETIME2(3) NOT NULL,

        CONSTRAINT [pk_glpi_followup_cache] PRIMARY KEY CLUSTERED ([followup_id]),
        CONSTRAINT [chk_glpi_followup_cache_followup_id] CHECK ([followup_id] > 0),
        CONSTRAINT [chk_glpi_followup_cache_ticket_id] CHECK ([ticket_id] > 0)
    );

    CREATE NONCLUSTERED INDEX [idx_glpi_followup_cache_ticket] ON [prioglpi].[glpi_followup_cache]([ticket_id]);

    CREATE TABLE [prioglpi].[glpi_task_cache] (
        [task_id] INT NOT NULL,
        [ticket_id] INT NOT NULL,
        [author] NVARCHAR(255) NULL,
        [technician] NVARCHAR(255) NULL,
        [tech_group] NVARCHAR(255) NULL,
        [content_plain] NVARCHAR(MAX) NOT NULL,
        [is_private] BIT NOT NULL CONSTRAINT [df_glpi_task_cache_is_private] DEFAULT 0,
        [state] INT NOT NULL,
        [created_at] DATETIME2(3) NOT NULL,
        [updated_at] DATETIME2(3) NOT NULL,

        CONSTRAINT [pk_glpi_task_cache] PRIMARY KEY CLUSTERED ([task_id]),
        CONSTRAINT [chk_glpi_task_cache_task_id] CHECK ([task_id] > 0),
        CONSTRAINT [chk_glpi_task_cache_ticket_id] CHECK ([ticket_id] > 0)
    );

    CREATE NONCLUSTERED INDEX [idx_glpi_task_cache_ticket] ON [prioglpi].[glpi_task_cache]([ticket_id]);

    CREATE TABLE [prioglpi].[login_attempt] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [account_key_hash] NVARCHAR(255) NOT NULL,
        [ip_key_hash] NVARCHAR(255) NULL,
        [attempted_at] DATETIME2(3) NOT NULL CONSTRAINT [df_login_attempt_attempted_at] DEFAULT SYSUTCDATETIME(),
        [success] BIT NOT NULL CONSTRAINT [df_login_attempt_success] DEFAULT 0,

        CONSTRAINT [pk_login_attempt] PRIMARY KEY CLUSTERED ([id])
    );

    CREATE NONCLUSTERED INDEX [idx_login_attempt_account_time] ON [prioglpi].[login_attempt]([account_key_hash], [attempted_at]);
    CREATE NONCLUSTERED INDEX [idx_login_attempt_ip_time] ON [prioglpi].[login_attempt]([ip_key_hash], [attempted_at]);

    COMMIT TRANSACTION;
    SELECT 'CREATE_OK' AS resultado;

END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    ;THROW;
END CATCH;
