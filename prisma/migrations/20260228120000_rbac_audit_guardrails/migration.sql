-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorIp" TEXT,
    "actorUserAgent" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "scope" TEXT,
    "before" TEXT,
    "after" TEXT,
    "diff" TEXT,
    "requestId" TEXT,
    "notes" TEXT
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traderId" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Company_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Company" ("address", "createdAt", "id", "name", "phone", "traderId", "updatedAt") SELECT "address", "createdAt", "id", "name", "phone", "traderId", "updatedAt" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE INDEX "idx_companies_trader_id" ON "Company"("traderId");
CREATE INDEX "idx_companies_name" ON "Company"("name");
CREATE INDEX "idx_companies_deleted_at" ON "Company"("deletedAt");
CREATE TABLE "new_Trader" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Trader" ("createdAt", "id", "name", "updatedAt") SELECT "createdAt", "id", "name", "updatedAt" FROM "Trader";
DROP TABLE "Trader";
ALTER TABLE "new_Trader" RENAME TO "Trader";
CREATE INDEX "idx_traders_deleted_at" ON "Trader"("deletedAt");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traderId" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "id", "name", "password", "role", "traderId", "updatedAt", "userId") SELECT "createdAt", "id", "name", "password", "role", "traderId", "updatedAt", "userId" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE INDEX "idx_users_company_id" ON "User"("companyId");
CREATE INDEX "idx_users_deleted_at" ON "User"("deletedAt");
CREATE UNIQUE INDEX "User_traderId_userId_key" ON "User"("traderId", "userId");
CREATE TABLE "new_Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "partyId" TEXT,
    "farmerId" TEXT,
    "billType" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "billDate" DATETIME NOT NULL,
    "payDate" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "txnRef" TEXT,
    "note" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "Farmer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Payment" ("amount", "billDate", "billId", "billType", "companyId", "createdAt", "farmerId", "id", "mode", "note", "partyId", "payDate", "txnRef", "updatedAt") SELECT "amount", "billDate", "billId", "billType", "companyId", "createdAt", "farmerId", "id", "mode", "note", "partyId", "payDate", "txnRef", "updatedAt" FROM "Payment";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
CREATE INDEX "idx_payments_bill_type" ON "Payment"("billType", "billId");
CREATE INDEX "idx_payments_company_date" ON "Payment"("companyId", "payDate");
CREATE INDEX "idx_payments_deleted_at" ON "Payment"("deletedAt");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

-- CreateIndex
CREATE INDEX "idx_audit_logs_created_at" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "idx_audit_logs_actor_id" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "idx_audit_logs_resource" ON "AuditLog"("resourceType", "resourceId");

