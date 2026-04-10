ALTER TABLE "SalesBill" ADD COLUMN "invoiceKind" TEXT NOT NULL DEFAULT 'regular';
ALTER TABLE "SalesBill" ADD COLUMN "workflowStatus" TEXT NOT NULL DEFAULT 'posted';
ALTER TABLE "SalesBill" ADD COLUMN "parentSalesBillId" TEXT;
ALTER TABLE "SalesBill" ADD COLUMN "splitGroupId" TEXT;
ALTER TABLE "SalesBill" ADD COLUMN "splitSuffix" TEXT;
ALTER TABLE "SalesBill" ADD COLUMN "splitSequence" INTEGER;
ALTER TABLE "SalesBill" ADD COLUMN "splitMethod" TEXT;
ALTER TABLE "SalesBill" ADD COLUMN "splitReason" TEXT;
ALTER TABLE "SalesBill" ADD COLUMN "splitPartLabel" TEXT;
ALTER TABLE "SalesBill" ADD COLUMN "lockedAt" DATETIME;
ALTER TABLE "SalesBill" ADD COLUMN "splitFinalizedAt" DATETIME;

CREATE TABLE "SalesBillSplitGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "parentSalesBillId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "splitMethod" TEXT NOT NULL,
    "chargeAllocationMode" TEXT NOT NULL DEFAULT 'proportional_amount',
    "reason" TEXT,
    "notes" TEXT,
    "sourceBillSnapshot" TEXT,
    "validationSnapshot" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "finalizedAt" DATETIME,
    "mergedAt" DATETIME,
    "lockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesBillSplitGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesBillSplitGroup_parentSalesBillId_fkey" FOREIGN KEY ("parentSalesBillId") REFERENCES "SalesBill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SalesBillSplitAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "splitGroupId" TEXT NOT NULL,
    "parentSalesItemId" TEXT NOT NULL,
    "childSalesBillId" TEXT NOT NULL,
    "childSalesItemId" TEXT,
    "allocationMode" TEXT,
    "sourceIndex" INTEGER NOT NULL DEFAULT 0,
    "weight" REAL NOT NULL DEFAULT 0,
    "bags" INTEGER,
    "rate" REAL NOT NULL DEFAULT 0,
    "amount" REAL NOT NULL DEFAULT 0,
    "taxableAmount" REAL NOT NULL DEFAULT 0,
    "gstAmount" REAL NOT NULL DEFAULT 0,
    "lineTotal" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesBillSplitAllocation_splitGroupId_fkey" FOREIGN KEY ("splitGroupId") REFERENCES "SalesBillSplitGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesBillSplitAllocation_parentSalesItemId_fkey" FOREIGN KEY ("parentSalesItemId") REFERENCES "SalesItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesBillSplitAllocation_childSalesBillId_fkey" FOREIGN KEY ("childSalesBillId") REFERENCES "SalesBill" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesBillSplitAllocation_childSalesItemId_fkey" FOREIGN KEY ("childSalesItemId") REFERENCES "SalesItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uniq_sales_bills_parent_suffix" ON "SalesBill"("parentSalesBillId", "splitSuffix");
CREATE INDEX "idx_sales_bills_company_kind_workflow_date_created" ON "SalesBill"("companyId", "invoiceKind", "workflowStatus", "billDate", "createdAt");
CREATE INDEX "idx_sales_bills_parent_sequence" ON "SalesBill"("parentSalesBillId", "splitSequence");
CREATE INDEX "idx_sales_bills_split_group" ON "SalesBill"("splitGroupId");

CREATE UNIQUE INDEX "SalesBillSplitGroup_parentSalesBillId_key" ON "SalesBillSplitGroup"("parentSalesBillId");
CREATE INDEX "idx_sales_split_groups_company_status_created" ON "SalesBillSplitGroup"("companyId", "status", "createdAt");
CREATE INDEX "idx_sales_split_groups_company_method" ON "SalesBillSplitGroup"("companyId", "splitMethod");

CREATE UNIQUE INDEX "uniq_sales_split_allocations_group_item_bill_index"
ON "SalesBillSplitAllocation"("splitGroupId", "parentSalesItemId", "childSalesBillId", "sourceIndex");
CREATE INDEX "idx_sales_split_allocations_group_child_bill" ON "SalesBillSplitAllocation"("splitGroupId", "childSalesBillId");
CREATE INDEX "idx_sales_split_allocations_parent_item" ON "SalesBillSplitAllocation"("parentSalesItemId");
CREATE INDEX "idx_sales_split_allocations_child_item" ON "SalesBillSplitAllocation"("childSalesItemId");
