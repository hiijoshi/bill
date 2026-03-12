/*
  Warnings:

  - You are about to drop the column `description` on the `Transport` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `Transport` table. All the data in the column will be lost.
  - You are about to drop the column `vehicleType` on the `Transport` table. All the data in the column will be lost.
  - You are about to alter the column `capacity` on the `Transport` table. The data in that column could be lost. The data in that column will be cast from `String` to `Float`.
  - Made the column `transporterName` on table `Transport` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `billDate` to the `Payment` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "TransportBill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "salesBillId" TEXT NOT NULL,
    "transportName" TEXT,
    "lorryNo" TEXT,
    "freightPerQt" REAL,
    "freightAmount" REAL,
    "advance" REAL DEFAULT 0,
    "toPay" REAL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransportBill_salesBillId_fkey" FOREIGN KEY ("salesBillId") REFERENCES "SalesBill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "transporterName" TEXT NOT NULL,
    "vehicleNumber" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "capacity" REAL,
    "freightRate" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Transport" ("capacity", "companyId", "createdAt", "driverName", "driverPhone", "id", "transporterName", "updatedAt", "vehicleNumber") SELECT "capacity", "companyId", "createdAt", "driverName", "driverPhone", "id", "transporterName", "updatedAt", "vehicleNumber" FROM "Transport";
DROP TABLE "Transport";
ALTER TABLE "new_Transport" RENAME TO "Transport";
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traderId" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Company_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Company" ("address", "createdAt", "id", "name", "phone", "traderId", "updatedAt") SELECT "address", "createdAt", "id", "name", "phone", "traderId", "updatedAt" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
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
    "txnRef" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "Farmer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Payment" ("amount", "billId", "billType", "companyId", "createdAt", "farmerId", "id", "mode", "note", "partyId", "payDate", "txnRef", "updatedAt") SELECT "amount", "billId", "billType", "companyId", "createdAt", "farmerId", "id", "mode", "note", "partyId", "payDate", "txnRef", "updatedAt" FROM "Payment";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
