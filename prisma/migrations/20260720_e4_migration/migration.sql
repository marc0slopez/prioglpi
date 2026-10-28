-- CreateTable
CREATE TABLE IF NOT EXISTS "SectorReferentAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "glpiGroupId" INTEGER NOT NULL,
    "referentUserId" INTEGER NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SectorReferentAssignment_referentUserId_fkey" FOREIGN KEY ("referentUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SectorReferentAssignment_glpiGroupId_key" ON "SectorReferentAssignment"("glpiGroupId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SectorReferentAssignment_referentUserId_idx" ON "SectorReferentAssignment"("referentUserId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_glpiUserId_key" ON "User"("glpiUserId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserSectorScope_glpiGroupId_idx" ON "UserSectorScope"("glpiGroupId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UserSectorScope_userId_glpiGroupId_key" ON "UserSectorScope"("userId", "glpiGroupId");

-- TicketRanking structural migration
ALTER TABLE "TicketRanking" ADD COLUMN "glpiGroupId" INTEGER;
UPDATE "TicketRanking" SET "glpiGroupId" = (SELECT "detectedSectorGroupId" FROM "GlpiTicketCache" WHERE "ticketId" = "TicketRanking"."ticketId");

-- Now make glpiGroupId NOT NULL by recreating the table (SQLite limitation)
CREATE TABLE "TicketRanking_new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticketId" INTEGER NOT NULL,
    "sectorName" TEXT NOT NULL,
    "glpiGroupId" INTEGER NOT NULL,
    "rankPosition" INTEGER NOT NULL,
    "createdByUserId" INTEGER NOT NULL,
    "updatedByUserId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "TicketRanking_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "GlpiTicketCache" ("ticketId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TicketRanking_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TicketRanking_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "TicketRanking_new" SELECT "id", "ticketId", "sectorName", "glpiGroupId", "rankPosition", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt", "isActive" FROM "TicketRanking";
DROP TABLE "TicketRanking";
ALTER TABLE "TicketRanking_new" RENAME TO "TicketRanking";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TicketRanking_ticketId_glpiGroupId_key" ON "TicketRanking"("ticketId", "glpiGroupId");
CREATE INDEX IF NOT EXISTS "TicketRanking_glpiGroupId_isActive_rankPosition_idx" ON "TicketRanking"("glpiGroupId", "isActive", "rankPosition");

-- E4 Backfill: Migrar scopes de referentes activos hacia SectorReferentAssignment
INSERT INTO "SectorReferentAssignment" ("glpiGroupId", "referentUserId", "updatedAt")
SELECT DISTINCT u."glpiGroupId", u."userId", CURRENT_TIMESTAMP
FROM "UserSectorScope" u
JOIN "User" usr ON u."userId" = usr."id"
WHERE usr."role" = 'referente' AND usr."isActive" = 1 AND u."glpiGroupId" IS NOT NULL;
