-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_stock_ledger_company_date" ON "StockLedger"("companyId", "entryDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_stock_ledger_company_product_date" ON "StockLedger"("companyId", "productId", "entryDate");
