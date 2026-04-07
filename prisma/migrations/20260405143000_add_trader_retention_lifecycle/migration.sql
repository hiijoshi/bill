-- Trader retention lifecycle and backup audit tables
CREATE TABLE "TraderDataLifecycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traderId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "readOnlySince" DATETIME,
    "backupRequestedAt" DATETIME,
    "backupRequestedByUserId" TEXT,
    "latestReadyBackupId" TEXT,
    "latestReadyBackupAt" DATETIME,
    "closureRequestedAt" DATETIME,
    "closureRequestedByUserId" TEXT,
    "closureRequestSource" TEXT,
    "closureNotes" TEXT,
    "retentionDays" INTEGER,
    "scheduledDeletionAt" DATETIME,
    "deletionPendingAt" DATETIME,
    "deletionMarkedByUserId" TEXT,
    "deletionApprovedAt" DATETIME,
    "deletionApprovedByUserId" TEXT,
    "deletionExecutedAt" DATETIME,
    "deletionExecutedByUserId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TraderDataLifecycle_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TraderDataBackup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traderId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "requestedByRole" TEXT,
    "requestSource" TEXT NOT NULL DEFAULT 'super_admin',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "format" TEXT NOT NULL DEFAULT 'json',
    "fileName" TEXT,
    "storagePath" TEXT,
    "fileSizeBytes" INTEGER,
    "checksum" TEXT,
    "recordCountsJson" TEXT,
    "exportedAt" DATETIME,
    "lastDownloadedAt" DATETIME,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "failedAt" DATETIME,
    "errorMessage" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TraderDataBackup_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TraderDataLifecycle_traderId_key" ON "TraderDataLifecycle"("traderId");
CREATE INDEX "idx_trader_data_lifecycle_state_schedule" ON "TraderDataLifecycle"("state", "scheduledDeletionAt");
CREATE INDEX "idx_trader_data_lifecycle_latest_backup_at" ON "TraderDataLifecycle"("latestReadyBackupAt");

CREATE INDEX "idx_trader_data_backups_trader_status_created" ON "TraderDataBackup"("traderId", "status", "createdAt");
CREATE INDEX "idx_trader_data_backups_exported_at" ON "TraderDataBackup"("exportedAt");
