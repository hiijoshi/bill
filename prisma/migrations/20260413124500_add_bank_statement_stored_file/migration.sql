CREATE TABLE "BankStatementStoredFile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batchId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileMimeType" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "bytes" BLOB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "BankStatementStoredFile_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BankStatementBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BankStatementStoredFile_batchId_key" ON "BankStatementStoredFile"("batchId");
CREATE INDEX "idx_bank_statement_stored_files_checksum" ON "BankStatementStoredFile"("checksum");
