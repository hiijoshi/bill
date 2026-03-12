/*
  Warnings:

  - You are about to drop the column `qty` on the `SalesItem` table. All the data in the column will be lost.
  - You are about to drop the column `partyId` on the `PurchaseBill` table. All the data in the column will be lost.
  - You are about to drop the column `unit` on the `Product` table. All the data in the column will be lost.
  - Added the required column `weight` to the `SalesItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `farmerId` to the `PurchaseBill` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unitId` to the `Product` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Farmer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone1" TEXT,
    "phone2" TEXT,
    "ifscCode" TEXT,
    "bankName" TEXT,
    "accountNo" TEXT,
    "krashakAnubandhNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Farmer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone1" TEXT,
    "phone2" TEXT,
    "ifscCode" TEXT,
    "bankName" TEXT,
    "accountNo" TEXT,
    "gstNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "transporterName" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "vehicleType" TEXT,
    "capacity" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Unit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpecialPurchaseBill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "supplierInvoiceNo" TEXT NOT NULL,
    "billDate" DATETIME NOT NULL,
    "supplierId" TEXT NOT NULL,
    "totalAmount" REAL NOT NULL,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "balanceAmount" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpecialPurchaseBill_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpecialPurchaseBill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpecialPurchaseItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "specialPurchaseBillId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "noOfBags" INTEGER,
    "weight" REAL NOT NULL,
    "rate" REAL NOT NULL,
    "netAmount" REAL NOT NULL,
    "otherAmount" REAL,
    "grossAmount" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpecialPurchaseItem_specialPurchaseBillId_fkey" FOREIGN KEY ("specialPurchaseBillId") REFERENCES "SpecialPurchaseBill" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpecialPurchaseItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalesItemMaster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "salesItemName" TEXT NOT NULL,
    "hsnCode" TEXT,
    "gstRate" REAL,
    "sellingPrice" REAL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesItemMaster_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesItemMaster_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SalesItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "salesBillId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "weight" REAL NOT NULL,
    "bags" INTEGER,
    "rate" REAL NOT NULL,
    "amount" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesItem_salesBillId_fkey" FOREIGN KEY ("salesBillId") REFERENCES "SalesBill" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SalesItem" ("amount", "createdAt", "id", "productId", "rate", "salesBillId", "updatedAt") SELECT "amount", "createdAt", "id", "productId", "rate", "salesBillId", "updatedAt" FROM "SalesItem";
DROP TABLE "SalesItem";
ALTER TABLE "new_SalesItem" RENAME TO "SalesItem";
CREATE TABLE "new_PurchaseBill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "billNo" TEXT NOT NULL,
    "billDate" DATETIME NOT NULL,
    "farmerId" TEXT NOT NULL,
    "totalAmount" REAL NOT NULL,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "balanceAmount" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseBill_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseBill_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "Farmer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseBill" ("balanceAmount", "billDate", "billNo", "companyId", "createdAt", "createdBy", "id", "paidAmount", "status", "totalAmount", "updatedAt") SELECT "balanceAmount", "billDate", "billNo", "companyId", "createdAt", "createdBy", "id", "paidAmount", "status", "totalAmount", "updatedAt" FROM "PurchaseBill";
DROP TABLE "PurchaseBill";
ALTER TABLE "new_PurchaseBill" RENAME TO "PurchaseBill";
CREATE TABLE "new_Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "partyId" TEXT,
    "farmerId" TEXT,
    "billType" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
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
INSERT INTO "new_Payment" ("amount", "billId", "billType", "companyId", "createdAt", "id", "mode", "note", "partyId", "payDate", "txnRef", "updatedAt") SELECT "amount", "billId", "billType", "companyId", "createdAt", "id", "mode", "note", "partyId", "payDate", "txnRef", "updatedAt" FROM "Payment";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "hsnCode" TEXT,
    "gstRate" REAL,
    "sellingPrice" REAL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Product_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("companyId", "createdAt", "id", "name", "updatedAt") SELECT "companyId", "createdAt", "id", "name", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_companyId_name_key" ON "Product"("companyId", "name");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

-- CreateIndex
CREATE UNIQUE INDEX "Unit_companyId_symbol_key" ON "Unit"("companyId", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "SalesItemMaster_companyId_productId_key" ON "SalesItemMaster"("companyId", "productId");
