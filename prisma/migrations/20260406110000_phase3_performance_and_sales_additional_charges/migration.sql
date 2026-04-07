CREATE TABLE IF NOT EXISTS "SalesAdditionalCharge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "salesBillId" TEXT NOT NULL,
  "transportBillId" TEXT,
  "chargeType" TEXT NOT NULL,
  "amount" REAL NOT NULL DEFAULT 0,
  "remark" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("salesBillId") REFERENCES "SalesBill" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("transportBillId") REFERENCES "TransportBill" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_users_trader_deleted" ON "User" ("traderId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_users_trader_company_deleted" ON "User" ("traderId", "companyId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_companies_trader_deleted_created" ON "Company" ("traderId", "deletedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_permissions_user_company" ON "UserPermission" ("userId", "companyId");
CREATE INDEX IF NOT EXISTS "idx_parties_company_name" ON "Party" ("companyId", "name");
CREATE INDEX IF NOT EXISTS "idx_parties_company_opening_balance" ON "Party" ("companyId", "openingBalance");
CREATE INDEX IF NOT EXISTS "idx_farmers_company_name" ON "Farmer" ("companyId", "name");
CREATE INDEX IF NOT EXISTS "idx_suppliers_company_name" ON "Supplier" ("companyId", "name");
CREATE INDEX IF NOT EXISTS "idx_purchase_bills_company_status_date_created" ON "PurchaseBill" ("companyId", "status", "billDate", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_purchase_items_bill_id" ON "PurchaseItem" ("purchaseBillId");
CREATE INDEX IF NOT EXISTS "idx_special_purchase_bills_company_date" ON "SpecialPurchaseBill" ("companyId", "billDate");
CREATE INDEX IF NOT EXISTS "idx_special_purchase_bills_company_status_date_created" ON "SpecialPurchaseBill" ("companyId", "status", "billDate", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_sales_bills_company_status_date_created" ON "SalesBill" ("companyId", "status", "billDate", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_sales_bills_company_party_date" ON "SalesBill" ("companyId", "partyId", "billDate");
CREATE INDEX IF NOT EXISTS "idx_sales_items_bill_id" ON "SalesItem" ("salesBillId");
CREATE INDEX IF NOT EXISTS "idx_stock_ledger_company_type_date" ON "StockLedger" ("companyId", "type", "entryDate");
CREATE INDEX IF NOT EXISTS "idx_payments_company_deleted_date_created" ON "Payment" ("companyId", "deletedAt", "payDate", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_payments_company_bill_deleted" ON "Payment" ("companyId", "billType", "billId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_payments_company_party_type_date" ON "Payment" ("companyId", "partyId", "billType", "deletedAt", "payDate");
CREATE INDEX IF NOT EXISTS "idx_payments_company_farmer_type_date" ON "Payment" ("companyId", "farmerId", "billType", "deletedAt", "payDate");
CREATE INDEX IF NOT EXISTS "idx_transport_bills_sales_bill" ON "TransportBill" ("salesBillId");
CREATE INDEX IF NOT EXISTS "idx_sales_additional_charges_company_bill" ON "SalesAdditionalCharge" ("companyId", "salesBillId");
CREATE INDEX IF NOT EXISTS "idx_sales_additional_charges_transport" ON "SalesAdditionalCharge" ("transportBillId");
CREATE INDEX IF NOT EXISTS "idx_sales_additional_charges_sort" ON "SalesAdditionalCharge" ("salesBillId", "sortOrder");
