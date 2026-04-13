ALTER TABLE "BankStatementRow" ADD COLUMN "draftAccountingHeadId" TEXT;
ALTER TABLE "BankStatementRow" ADD COLUMN "draftPartyId" TEXT;
ALTER TABLE "BankStatementRow" ADD COLUMN "draftSupplierId" TEXT;
ALTER TABLE "BankStatementRow" ADD COLUMN "draftVoucherType" TEXT;
ALTER TABLE "BankStatementRow" ADD COLUMN "draftPaymentMode" TEXT;
ALTER TABLE "BankStatementRow" ADD COLUMN "draftRemarks" TEXT;
ALTER TABLE "BankStatementRow" ADD COLUMN "postedPaymentId" TEXT;
ALTER TABLE "BankStatementRow" ADD COLUMN "postedLedgerEntryId" TEXT;
ALTER TABLE "BankStatementRow" ADD COLUMN "postedAt" DATETIME;

CREATE INDEX "idx_bank_statement_rows_draft_head" ON "BankStatementRow"("draftAccountingHeadId");
CREATE INDEX "idx_bank_statement_rows_draft_party" ON "BankStatementRow"("draftPartyId");
CREATE INDEX "idx_bank_statement_rows_draft_supplier" ON "BankStatementRow"("draftSupplierId");
CREATE INDEX "idx_bank_statement_rows_posted_payment" ON "BankStatementRow"("postedPaymentId");
CREATE INDEX "idx_bank_statement_rows_posted_ledger" ON "BankStatementRow"("postedLedgerEntryId");
