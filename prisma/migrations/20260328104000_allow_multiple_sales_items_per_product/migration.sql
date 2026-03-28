DROP INDEX IF EXISTS "SalesItemMaster_companyId_productId_key";
CREATE INDEX IF NOT EXISTS "idx_sales_item_master_company_product"
ON "SalesItemMaster"("companyId", "productId");
