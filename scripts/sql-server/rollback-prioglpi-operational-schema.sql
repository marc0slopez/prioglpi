-- Ejecutar conectado a la base de datos destino de PrioGLPI.

SET NOCOUNT ON;
SET XACT_ABORT ON;

-- ============================================================================
-- ATENCION: Este script ELIMINARA TODAS las tablas creadas en el esquema prioglpi.
-- Para confirmar la ejecuciÃ³n, cambie el valor de @ConfirmRollback a 1.
-- ============================================================================
DECLARE @ConfirmRollback BIT = 0;

IF @ConfirmRollback = 0
BEGIN
    PRINT 'Rollback abortado por seguridad. Cambie @ConfirmRollback = 1 para confirmar.';
    RETURN;
END

BEGIN TRY
    BEGIN TRANSACTION;

    -- 1. Verificar existencia exacta de las 16 tablas
    DECLARE @ExpectedTables TABLE (TableName SYSNAME);
    INSERT INTO @ExpectedTables VALUES
        ('app_user'), ('user_sector_scope'), ('glpi_ticket_cache'), ('ticket_ranking'),
        ('sector_referent_assignment'), ('ticket_coordination'), ('sync_run'), ('audit_log'),
        ('glpi_group_cache'), ('glpi_user_cache'), ('glpi_user_group_membership'),
        ('glpi_ticket_group_actor'), ('glpi_ticket_user_actor'), ('glpi_followup_cache'),
        ('glpi_task_cache'), ('login_attempt');

    IF EXISTS (
        SELECT TableName FROM @ExpectedTables
        WHERE TableName NOT IN (SELECT t.name FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE s.name = 'prioglpi')
    ) THROW 51001, 'Abortado: Faltan tablas esperadas en el schema prioglpi.', 1;

    -- 2. Abortar si existen objetos adicionales (tablas inesperadas, vistas, sp, tipos de usuario, etc)
    IF EXISTS (
        SELECT 1 FROM sys.schemas s WHERE s.name = 'prioglpi' AND (
            EXISTS (SELECT 1 FROM sys.objects o WHERE o.schema_id = s.schema_id AND (o.type NOT IN ('U', 'PK', 'F', 'UQ', 'C', 'D') OR (o.type = 'U' AND o.name NOT IN (SELECT TableName FROM @ExpectedTables)))) OR
            EXISTS (SELECT 1 FROM sys.types t WHERE t.schema_id = s.schema_id AND t.is_user_defined = 1) OR
            EXISTS (SELECT 1 FROM sys.xml_schema_collections x WHERE x.schema_id = s.schema_id) OR
            EXISTS (SELECT 1 FROM sys.sequences sq WHERE sq.schema_id = s.schema_id)
        )
    ) THROW 51002, 'Abortado: Existen objetos adicionales o inesperados dentro del schema prioglpi (tablas ajenas, tipos, vistas, etc).', 1;

    -- 3. Abortar si cualquiera de las tablas contiene filas (bloqueando las tablas para prevenir inserciones)
    IF EXISTS (SELECT 1 FROM [prioglpi].[app_user] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla app_user. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[user_sector_scope] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla user_sector_scope. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[glpi_ticket_cache] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla glpi_ticket_cache. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[ticket_ranking] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla ticket_ranking. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[sector_referent_assignment] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla sector_referent_assignment. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[ticket_coordination] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla ticket_coordination. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[sync_run] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla sync_run. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[audit_log] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla audit_log. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[glpi_group_cache] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla glpi_group_cache. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[glpi_user_cache] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla glpi_user_cache. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[glpi_user_group_membership] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla glpi_user_group_membership. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[glpi_ticket_group_actor] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla glpi_ticket_group_actor. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[glpi_ticket_user_actor] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla glpi_ticket_user_actor. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[glpi_followup_cache] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla glpi_followup_cache. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[glpi_task_cache] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla glpi_task_cache. No se puede hacer rollback de forma segura.', 1;
    IF EXISTS (SELECT 1 FROM [prioglpi].[login_attempt] WITH (TABLOCKX, HOLDLOCK))
        THROW 51003, 'Abortado: Existen datos en la tabla login_attempt. No se puede hacer rollback de forma segura.', 1;


    -- 4. Detectar foreign keys externas que apunten a objetos del schema
    IF EXISTS (
        SELECT 1 FROM sys.foreign_keys fk
        JOIN sys.tables tp ON fk.referenced_object_id = tp.object_id
        JOIN sys.schemas sp ON tp.schema_id = sp.schema_id
        JOIN sys.tables tc ON fk.parent_object_id = tc.object_id
        JOIN sys.schemas sc ON tc.schema_id = sc.schema_id
        WHERE sp.name = 'prioglpi' AND sc.name <> 'prioglpi'
    ) THROW 51004, 'Abortado: Existen Foreign Keys externas apuntando a las tablas de prioglpi.', 1;

    -- 5. Detectar dependencias externas (vistas, procs, etc) referenciando objetos de prioglpi
    IF EXISTS (
        SELECT 1 FROM sys.sql_expression_dependencies ed
        JOIN sys.objects referencing ON ed.referencing_id = referencing.object_id
        JOIN sys.schemas referencing_schema ON referencing.schema_id = referencing_schema.schema_id
        LEFT JOIN sys.objects referenced_obj ON ed.referenced_id = referenced_obj.object_id
        LEFT JOIN sys.schemas referenced_schema ON referenced_obj.schema_id = referenced_schema.schema_id
        WHERE referencing_schema.name <> 'prioglpi'
          AND (
            ed.referenced_schema_name = 'prioglpi' OR
            referenced_schema.name = 'prioglpi'
          )
    ) THROW 51005, 'Abortado: Existen dependencias (vistas, procedimientos, funciones, etc) externas que referencian al schema prioglpi.', 1;

    -- 6. Detectar sinÃ³nimos externos apuntando a prioglpi
    IF EXISTS (
        SELECT 1 FROM sys.synonyms syn
        JOIN sys.schemas s ON syn.schema_id = s.schema_id
        WHERE s.name <> 'prioglpi'
          AND (
              LOWER(REPLACE(REPLACE(syn.base_object_name, '[', ''), ']', '')) LIKE '%prioglpi.%'
          )
    ) THROW 51006, 'Abortado: Existen sinÃ³nimos externos que apuntan a objetos del schema prioglpi.', 1;

    -- Eliminar tablas en orden inverso a su creaciÃ³n
    DROP TABLE [prioglpi].[login_attempt];
    DROP TABLE [prioglpi].[glpi_task_cache];
    DROP TABLE [prioglpi].[glpi_followup_cache];
    DROP TABLE [prioglpi].[glpi_ticket_user_actor];
    DROP TABLE [prioglpi].[glpi_ticket_group_actor];
    DROP TABLE [prioglpi].[glpi_user_group_membership];
    DROP TABLE [prioglpi].[glpi_user_cache];
    DROP TABLE [prioglpi].[glpi_group_cache];
    DROP TABLE [prioglpi].[audit_log];
    DROP TABLE [prioglpi].[sync_run];
    DROP TABLE [prioglpi].[ticket_coordination];
    DROP TABLE [prioglpi].[sector_referent_assignment];
    DROP TABLE [prioglpi].[ticket_ranking];
    DROP TABLE [prioglpi].[glpi_ticket_cache];
    DROP TABLE [prioglpi].[user_sector_scope];
    DROP TABLE [prioglpi].[app_user];

    -- Eliminar esquema
    DROP SCHEMA [prioglpi];

    COMMIT;
    SELECT 'ROLLBACK_OK' AS resultado;

END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK;
    THROW;
END CATCH
