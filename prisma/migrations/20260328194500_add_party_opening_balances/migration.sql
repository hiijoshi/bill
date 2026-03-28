ALTER TABLE "Party" ADD COLUMN "openingBalance" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Party" ADD COLUMN "openingBalanceType" TEXT NOT NULL DEFAULT 'receivable';
ALTER TABLE "Party" ADD COLUMN "openingBalanceDate" DATETIME;
