CREATE TABLE "BankStatementBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "bankId" TEXT,
  "uploadedByUserId" TEXT,
  "fileName" TEXT NOT NULL,
  "originalFileName" TEXT,
  "fileMimeType" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "fileExtension" TEXT,
  "documentKind" TEXT NOT NULL,
  "storageDisk" TEXT NOT NULL DEFAULT 'local',
  "storageBucket" TEXT,
  "storageKey" TEXT,
  "uploadChecksum" TEXT,
  "uploadStatus" TEXT NOT NULL DEFAULT 'created',
  "batchStatus" TEXT NOT NULL DEFAULT 'uploaded',
  "parseStatus" TEXT NOT NULL DEFAULT 'pending',
  "matchStatus" TEXT NOT NULL DEFAULT 'pending',
  "finalizeStatus" TEXT NOT NULL DEFAULT 'pending',
  "duplicateBatchId" TEXT,
  "duplicateConfidence" REAL,
  "parserType" TEXT,
  "parserVersion" TEXT,
  "parserConfidence" REAL,
  "bankNameDetected" TEXT,
  "accountNumberMasked" TEXT,
  "statementDateFrom" DATETIME,
  "statementDateTo" DATETIME,
  "openingBalance" REAL,
  "closingBalance" REAL,
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "parsedRows" INTEGER NOT NULL DEFAULT 0,
  "invalidRows" INTEGER NOT NULL DEFAULT 0,
  "settledRows" INTEGER NOT NULL DEFAULT 0,
  "unsettledRows" INTEGER NOT NULL DEFAULT 0,
  "ambiguousRows" INTEGER NOT NULL DEFAULT 0,
  "failedRows" INTEGER NOT NULL DEFAULT 0,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "errorDetailsJson" TEXT,
  "sourceMetadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "uploadedAt" DATETIME,
  "parsedAt" DATETIME,
  "matchedAt" DATETIME,
  "finalizedAt" DATETIME,
  CONSTRAINT "BankStatementBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankStatementBatch_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "BankStatementBatch_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "BankStatementRow" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "uploadBatchId" TEXT NOT NULL,
  "bankId" TEXT,
  "sourceRowIndex" INTEGER NOT NULL,
  "sourcePageNumber" INTEGER,
  "sourceSheetName" TEXT,
  "transactionDate" DATETIME,
  "valueDate" DATETIME,
  "description" TEXT NOT NULL,
  "descriptionNormalized" TEXT,
  "debit" REAL,
  "credit" REAL,
  "amount" REAL NOT NULL,
  "direction" TEXT NOT NULL,
  "referenceNumber" TEXT,
  "referenceNormalized" TEXT,
  "chequeNumber" TEXT,
  "balance" REAL,
  "transactionType" TEXT,
  "rawRowJson" TEXT,
  "parserType" TEXT NOT NULL,
  "parserConfidence" REAL,
  "extractionStatus" TEXT NOT NULL DEFAULT 'parsed',
  "duplicateFingerprint" TEXT NOT NULL,
  "duplicateState" TEXT NOT NULL DEFAULT 'unique',
  "duplicateOfRowId" TEXT,
  "matchStatus" TEXT NOT NULL DEFAULT 'unsettled',
  "matchedLedgerId" TEXT,
  "matchedPaymentId" TEXT,
  "matchConfidence" REAL,
  "matchReason" TEXT,
  "matchReasonJson" TEXT,
  "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
  "reviewedByUserId" TEXT,
  "reviewedAt" DATETIME,
  "ignoredAt" DATETIME,
  "finalLinkId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "BankStatementRow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankStatementRow_uploadBatchId_fkey" FOREIGN KEY ("uploadBatchId") REFERENCES "BankStatementBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankStatementRow_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "BankStatementRow_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "BankStatementMatchCandidate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "statementRowId" TEXT NOT NULL,
  "ledgerEntryId" TEXT,
  "paymentId" TEXT,
  "candidateRank" INTEGER NOT NULL,
  "totalScore" REAL NOT NULL,
  "amountScore" REAL NOT NULL DEFAULT 0,
  "directionScore" REAL NOT NULL DEFAULT 0,
  "dateScore" REAL NOT NULL DEFAULT 0,
  "referenceScore" REAL NOT NULL DEFAULT 0,
  "narrationScore" REAL NOT NULL DEFAULT 0,
  "balanceScore" REAL NOT NULL DEFAULT 0,
  "decision" TEXT NOT NULL DEFAULT 'candidate',
  "reason" TEXT,
  "reasonJson" TEXT,
  "isReserved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "BankStatementMatchCandidate_statementRowId_fkey" FOREIGN KEY ("statementRowId") REFERENCES "BankStatementRow" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankStatementMatchCandidate_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankStatementMatchCandidate_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "BankReconciliationLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "bankId" TEXT,
  "statementBatchId" TEXT NOT NULL,
  "statementRowId" TEXT NOT NULL,
  "ledgerEntryId" TEXT,
  "paymentId" TEXT,
  "linkType" TEXT NOT NULL DEFAULT 'auto',
  "confidence" REAL,
  "reason" TEXT,
  "reasonJson" TEXT,
  "createdByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "BankReconciliationLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankReconciliationLink_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "BankReconciliationLink_statementBatchId_fkey" FOREIGN KEY ("statementBatchId") REFERENCES "BankStatementBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankReconciliationLink_statementRowId_fkey" FOREIGN KEY ("statementRowId") REFERENCES "BankStatementRow" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankReconciliationLink_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankReconciliationLink_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankReconciliationLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "BankStatementBatchEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batchId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "eventType" TEXT NOT NULL,
  "stage" TEXT,
  "payloadJson" TEXT,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankStatementBatchEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BankStatementBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankStatementBatchEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankStatementBatchEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uniq_bank_statement_rows_batch_row" ON "BankStatementRow"("uploadBatchId", "sourceRowIndex");
CREATE UNIQUE INDEX "BankStatementRow_finalLinkId_key" ON "BankStatementRow"("finalLinkId");
CREATE UNIQUE INDEX "uniq_bank_statement_candidates_row_target" ON "BankStatementMatchCandidate"("statementRowId", "ledgerEntryId", "paymentId");
CREATE UNIQUE INDEX "BankReconciliationLink_statementRowId_key" ON "BankReconciliationLink"("statementRowId");
CREATE UNIQUE INDEX "BankReconciliationLink_ledgerEntryId_key" ON "BankReconciliationLink"("ledgerEntryId");
CREATE UNIQUE INDEX "BankReconciliationLink_paymentId_key" ON "BankReconciliationLink"("paymentId");

CREATE INDEX "idx_bank_statement_batches_company_created" ON "BankStatementBatch"("companyId", "createdAt");
CREATE INDEX "idx_bank_statement_batches_company_bank_created" ON "BankStatementBatch"("companyId", "bankId", "createdAt");
CREATE INDEX "idx_bank_statement_batches_company_status_created" ON "BankStatementBatch"("companyId", "batchStatus", "createdAt");
CREATE INDEX "idx_bank_statement_batches_checksum" ON "BankStatementBatch"("uploadChecksum");
CREATE INDEX "idx_bank_statement_batches_duplicate" ON "BankStatementBatch"("duplicateBatchId");

CREATE INDEX "idx_bank_statement_rows_company_batch_match" ON "BankStatementRow"("companyId", "uploadBatchId", "matchStatus");
CREATE INDEX "idx_bank_statement_rows_company_bank_date_amount_direction" ON "BankStatementRow"("companyId", "bankId", "transactionDate", "amount", "direction");
CREATE INDEX "idx_bank_statement_rows_fingerprint" ON "BankStatementRow"("duplicateFingerprint");
CREATE INDEX "idx_bank_statement_rows_matched_ledger" ON "BankStatementRow"("matchedLedgerId");
CREATE INDEX "idx_bank_statement_rows_review_match" ON "BankStatementRow"("reviewStatus", "matchStatus");

CREATE INDEX "idx_bank_statement_candidates_row_rank" ON "BankStatementMatchCandidate"("statementRowId", "candidateRank");
CREATE INDEX "idx_bank_statement_candidates_ledger_decision" ON "BankStatementMatchCandidate"("ledgerEntryId", "decision");
CREATE INDEX "idx_bank_statement_candidates_payment_decision" ON "BankStatementMatchCandidate"("paymentId", "decision");

CREATE INDEX "idx_bank_reconciliation_links_company_bank_created" ON "BankReconciliationLink"("companyId", "bankId", "createdAt");
CREATE INDEX "idx_bank_reconciliation_links_batch" ON "BankReconciliationLink"("statementBatchId");

CREATE INDEX "idx_bank_statement_batch_events_batch_created" ON "BankStatementBatchEvent"("batchId", "createdAt");
CREATE INDEX "idx_bank_statement_batch_events_company_event_created" ON "BankStatementBatchEvent"("companyId", "eventType", "createdAt");
