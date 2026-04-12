import type { BankStatementBatch, Bank } from '@prisma/client'
import type { BankStatementBatchListItem, BankStatementWorkspaceBank, BankStatementWorkspacePayload } from './types'

function toIsoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export function serializeBankStatementBatch(batch: BankStatementBatch): BankStatementBatchListItem {
  return {
    id: batch.id,
    companyId: batch.companyId,
    bankId: batch.bankId || null,
    fileName: batch.fileName,
    originalFileName: batch.originalFileName || null,
    documentKind: batch.documentKind as BankStatementBatchListItem['documentKind'],
    batchStatus: batch.batchStatus as BankStatementBatchListItem['batchStatus'],
    parseStatus: batch.parseStatus as BankStatementBatchListItem['parseStatus'],
    matchStatus: batch.matchStatus as BankStatementBatchListItem['matchStatus'],
    finalizeStatus: batch.finalizeStatus as BankStatementBatchListItem['finalizeStatus'],
    uploadStatus: batch.uploadStatus as BankStatementBatchListItem['uploadStatus'],
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    uploadedAt: toIsoOrNull(batch.uploadedAt),
    parsedAt: toIsoOrNull(batch.parsedAt),
    matchedAt: toIsoOrNull(batch.matchedAt),
    finalizedAt: toIsoOrNull(batch.finalizedAt),
    metadata: {
      bankNameDetected: batch.bankNameDetected || null,
      accountNumberMasked: batch.accountNumberMasked || null,
      statementDateFrom: toIsoOrNull(batch.statementDateFrom),
      statementDateTo: toIsoOrNull(batch.statementDateTo),
      openingBalance: batch.openingBalance ?? null,
      closingBalance: batch.closingBalance ?? null
    },
    summary: {
      totalRows: batch.totalRows,
      parsedRows: batch.parsedRows,
      invalidRows: batch.invalidRows,
      settledRows: batch.settledRows,
      unsettledRows: batch.unsettledRows,
      ambiguousRows: batch.ambiguousRows,
      failedRows: batch.failedRows,
      warningCount: batch.warningCount
    }
  }
}

export function serializeWorkspaceBank(bank: Bank): BankStatementWorkspaceBank {
  return {
    id: bank.id,
    name: bank.name,
    branch: bank.branch || null,
    ifscCode: bank.ifscCode || null,
    accountNumber: bank.accountNumber || null
  }
}

export function buildWorkspacePayload(input: {
  companyId: string
  banks: Bank[]
  recentBatches: BankStatementBatch[]
}): BankStatementWorkspacePayload {
  return {
    companyId: input.companyId,
    banks: input.banks.map(serializeWorkspaceBank),
    recentBatches: input.recentBatches.map(serializeBankStatementBatch)
  }
}
