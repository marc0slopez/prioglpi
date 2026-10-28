-- =========================================================================
-- Script de Migración E6: Actualización de Roles
-- Fecha: 2026
-- Objetivo: Renombrar roles en la tabla operativa [prioglpi].[app_user]
-- y actualizar usuarios de prueba de acuerdo con la nueva semántica.
--
-- ORDEN CRÍTICO:
-- 1. 'referente' -> 'priorizador'
-- 2. 'supervisor' -> 'referente'
-- =========================================================================

BEGIN TRANSACTION;
BEGIN TRY

    PRINT '--- Iniciando Migración E6 ---';

    -- 1. Actualizar roles en la tabla operativa
    PRINT '1.1. Actualizando rol: referente -> priorizador';
    UPDATE [prioglpi].[app_user]
    SET [role] = 'priorizador'
    WHERE [role] = 'referente';
    PRINT 'Filas afectadas: ' + CAST(@@ROWCOUNT AS VARCHAR);

    PRINT '1.2. Actualizando rol: supervisor -> referente';
    UPDATE [prioglpi].[app_user]
    SET [role] = 'referente'
    WHERE [role] = 'supervisor';
    PRINT 'Filas afectadas: ' + CAST(@@ROWCOUNT AS VARCHAR);


    -- 2. Actualizar usuarios de prueba (Fake Users) si existen
    -- referente_test -> priorizador_test
    -- supervisor_test -> referente_test
    PRINT '2.1. Actualizando usuario de prueba: referente_test -> priorizador_test';
    UPDATE [prioglpi].[app_user]
    SET [username] = 'priorizador_test',
        [displayName] = 'Priorizador (Test)'
    WHERE [username] = 'referente_test';
    PRINT 'Filas afectadas: ' + CAST(@@ROWCOUNT AS VARCHAR);

    PRINT '2.2. Actualizando usuario de prueba: supervisor_test -> referente_test';
    UPDATE [prioglpi].[app_user]
    SET [username] = 'referente_test',
        [displayName] = 'Referente (Test)'
    WHERE [username] = 'supervisor_test';
    PRINT 'Filas afectadas: ' + CAST(@@ROWCOUNT AS VARCHAR);

    COMMIT TRANSACTION;
    PRINT '--- Migración E6 Finalizada con Éxito ---';

END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    PRINT '--- ERROR DURANTE LA MIGRACIÓN ---';
    PRINT ERROR_MESSAGE();
END CATCH;
GO
