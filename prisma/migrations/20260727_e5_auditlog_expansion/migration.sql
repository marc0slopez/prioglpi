-- RedefineTables
CREATE TABLE "new_AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorName" TEXT,
    "actorUsername" TEXT,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AuditLog" ("id", "userId", "action", "entityType", "entityId", "beforeJson", "afterJson", "createdAt") SELECT "id", "userId", "action", "entityType", "entityId", "beforeJson", "afterJson", "createdAt" FROM "AuditLog";
UPDATE "new_AuditLog"
SET
  "actorName" = (SELECT "displayName" FROM "User" WHERE "User"."id" = "new_AuditLog"."userId"),
  "actorUsername" = (SELECT "username" FROM "User" WHERE "User"."id" = "new_AuditLog"."userId")
WHERE "userId" IS NOT NULL;
DROP TABLE "AuditLog";
ALTER TABLE "new_AuditLog" RENAME TO "AuditLog";
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX "AuditLog_actorUsername_idx" ON "AuditLog"("actorUsername");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
