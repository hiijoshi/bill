-- Performance Optimization Indexes
-- Created for billing app performance improvements

-- Companies indexes
CREATE INDEX IF NOT EXISTS idx_companies_trader_id ON companies(traderId);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);

-- Transactions indexes
CREATE INDEX IF NOT EXISTS idx_purchase_bills_company_date ON purchase_bills(companyId, billDate);
CREATE INDEX IF NOT EXISTS idx_sales_bills_company_date ON sales_bills(companyId, billDate);
CREATE INDEX IF NOT EXISTS idx_payments_bill_type ON payments(billType, billId);

-- Stock indexes
CREATE INDEX IF NOT EXISTS idx_stock_ledger_product_date ON stock_ledger(productId, entryDate);

-- Party/Farmer indexes
CREATE INDEX IF NOT EXISTS idx_parties_company_type ON parties(companyId, type);
CREATE INDEX IF NOT EXISTS idx_farmers_company ON farmers(companyId);

-- Product indexes
CREATE INDEX IF NOT EXISTS idx_products_company_active ON products(companyId, isActive);

-- Payment indexes
CREATE INDEX IF NOT EXISTS idx_payments_company_date ON payments(companyId, payDate);

-- Transport indexes
CREATE INDEX IF NOT EXISTS idx_transport_bills_sales_bill ON transport_bills(salesBillId);
