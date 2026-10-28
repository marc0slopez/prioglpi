-- PRAGMA foreign_keys=OFF se ejecuta desde el script que corre la migración
-- PRAGMA foreign_keys=OFF;
-- BEGIN TRANSACTION;

CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT 1,
    "glpiUserId" INTEGER,
    "adObjectId" TEXT,
    "email" TEXT,
    "authSource" TEXT NOT NULL DEFAULT 'local',
    "directoryActive" BOOLEAN,
    "directoryStatusCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CHECK("authSource" IN ('local', 'ad', 'system'))
);

INSERT INTO "new_User" ("id", "username", "passwordHash", "displayName", "role", "isActive", "glpiUserId", "createdAt", "updatedAt")
SELECT "id", "username", "passwordHash", "displayName", "role", "isActive", "glpiUserId", "createdAt", "updatedAt" FROM "User";

DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_glpiUserId_key" ON "User"("glpiUserId");
CREATE UNIQUE INDEX "User_adObjectId_key" ON "User"("adObjectId");

UPDATE "User" SET "authSource" = 'local' WHERE "role" != 'system' AND "username" != 'system_sync';

UPDATE "User"
SET "authSource" = 'system',
    "passwordHash" = NULL,
    "adObjectId" = NULL,
    "email" = NULL,
    "directoryActive" = NULL,
    "directoryStatusCheckedAt" = NULL,
    "isActive" = 0,
    "glpiUserId" = NULL
WHERE "role" = 'system' OR "username" = 'system_sync';

DELETE FROM "UserSectorScope" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "authSource" = 'system');
DELETE FROM "SectorReferentAssignment" WHERE "referentUserId" IN (SELECT "id" FROM "User" WHERE "authSource" = 'system');

CREATE TABLE "LoginAttempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accountKeyHash" TEXT NOT NULL,
    "ipKeyHash" TEXT,
    "attemptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX "LoginAttempt_accountKeyHash_attemptedAt_idx" ON "LoginAttempt"("accountKeyHash", "attemptedAt");
CREATE INDEX "LoginAttempt_ipKeyHash_attemptedAt_idx" ON "LoginAttempt"("ipKeyHash", "attemptedAt");

-- NOTA IMPORTANTE PARA DESPLIEGUE PRODUCTIVO:
-- La migración AD se aplicará con el ejecutor protegido de QA y luego se
-- registrará mediante: prisma migrate resolve --applied 20260723_ad_auth_foundation
-- No debe ejecutarse prisma migrate deploy directamente sobre la base
-- preexistente durante esta fase para evitar inconsistencias.

-- COMMIT;
-- PRAGMA foreign_keys=ON;
