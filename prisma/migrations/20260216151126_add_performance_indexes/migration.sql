-- CreateIndex
CREATE INDEX "idx_companies_trader_id" ON "Company"("traderId");

-- CreateIndex
CREATE INDEX "idx_companies_name" ON "Company"("name");

-- CreateIndex
CREATE INDEX "idx_payments_bill_type" ON "Payment"("billType", "billId");

-- CreateIndex
CREATE INDEX "idx_payments_company_date" ON "Payment"("companyId", "payDate");

-- CreateIndex
CREATE INDEX "idx_purchase_bills_company_date" ON "PurchaseBill"("companyId", "billDate");

-- CreateIndex
CREATE INDEX "idx_sales_bills_company_date" ON "SalesBill"("companyId", "billDate");

-- CreateIndex
CREATE INDEX "idx_stock_ledger_product_date" ON "StockLedger"("productId", "entryDate");
