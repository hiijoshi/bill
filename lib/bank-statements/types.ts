import type {
  BANK_RECONCILIATION_LINK_TYPE,
  BANK_STATEMENT_BATCH_STATUS,
  BANK_STATEMENT_DUPLICATE_STATE,
  BANK_STATEMENT_EVENT_TYPE,
  BANK_STATEMENT_EXTRACTION_STATUS,
  BANK_STATEMENT_MATCH_STATUS,
  BANK_STATEMENT_REVIEW_STATUS,
  BANK_STATEMENT_STAGE_STATUS,
  BANK_STATEMENT_UPLOAD_STATUS
} from './constants'

export type BankStatementDocumentKind = 'csv' | 'excel' | 'pdf' | 'image'
export type BankStatementBatchStatus = (typeof BANK_STATEMENT_BATCH_STATUS)[number]
export type BankStatementStageStatus = (typeof BANK_STATEMENT_STAGE_STATUS)[number]
export type BankStatementUploadStatus = (typeof BANK_STATEMENT_UPLOAD_STATUS)[number]
export type BankStatementExtractionStatus = (typeof BANK_STATEMENT_EXTRACTION_STATUS)[number]
export type BankStatementMatchStatus = (typeof BANK_STATEMENT_MATCH_STATUS)[number]
export type BankStatementReviewStatus = (typeof BANK_STATEMENT_REVIEW_STATUS)[number]
export type BankStatementDuplicateState = (typeof BANK_STATEMENT_DUPLICATE_STATE)[number]
export type BankReconciliationLinkType = (typeof BANK_RECONCILIATION_LINK_TYPE)[number]
export type BankStatementEventType = (typeof BANK_STATEMENT_EVENT_TYPE)[number]

export type BankStatementDirection = 'debit' | 'credit'
export type BankStatementDecision = 'candidate' | 'selected' | 'rejected' | 'ambiguous_candidate'

export type BankStatementDetectedMetadata = {
  bankNameDetected: string | null
  accountNumberMasked: string | null
  statementDateFrom: string | null
  statementDateTo: string | null
  openingBalance: number | null
  closingBalance: number | null
}

export type BankStatementSummary = {
  totalRows: number
  parsedRows: number
  invalidRows: number
  settledRows: number
  unsettledRows: number
  ambiguousRows: number
  failedRows: number
  warningCount: number
}

export type NormalizedStatementTransaction = {
  id: string
  companyId: string
  uploadBatchId: string
  bankId: string | null
  sourceRowIndex: number
  sourcePageNumber: number | null
  sourceSheetName: string | null
  transactionDate: string | null
  valueDate: string | null
  description: string
  descriptionNormalized: string | null
  debit: number | null
  credit: number | null
  amount: number
  direction: BankStatementDirection
  referenceNumber: string | null
  referenceNormalized: string | null
  chequeNumber: string | null
  balance: number | null
  transactionType: string | null
  rawRow: Record<string, unknown> | null
  parserType: string
  parserConfidence: number | null
  extractionStatus: BankStatementExtractionStatus
  duplicateFingerprint: string
  duplicateState: BankStatementDuplicateState
  duplicateOfRowId: string | null
  matchStatus: BankStatementMatchStatus
  matchedLedgerId: string | null
  matchedPaymentId: string | null
  matchConfidence: number | null
  matchReason: string | null
  matchReasonJson: string | null
  reviewStatus: BankStatementReviewStatus
  reviewedByUserId: string | null
  reviewedAt: string | null
}

export type BankStatementMatchCandidate = {
  id: string
  statementRowId: string
  ledgerEntryId: string
  paymentId: string
  candidateRank: number
  totalScore: number
  amountScore: number
  directionScore: number
  dateScore: number
  referenceScore: number
  narrationScore: number
  balanceScore: number
  decision: BankStatementDecision
  reason: string | null
  reasonJson: string | null
  isReserved: boolean
}

export type BankStatementBatchListItem = {
  id: string
  companyId: string
  bankId: string | null
  fileName: string
  originalFileName: string | null
  documentKind: BankStatementDocumentKind
  batchStatus: BankStatementBatchStatus
  parseStatus: BankStatementStageStatus
  matchStatus: BankStatementStageStatus
  finalizeStatus: BankStatementStageStatus
  uploadStatus: BankStatementUploadStatus
  createdAt: string
  updatedAt: string
  uploadedAt: string | null
  parsedAt: string | null
  matchedAt: string | null
  finalizedAt: string | null
  metadata: BankStatementDetectedMetadata
  summary: BankStatementSummary
}

export type BankStatementWorkspaceBank = {
  id: string
  name: string
  branch: string | null
  ifscCode: string | null
  accountNumber: string | null
}

export type BankStatementWorkspacePayload = {
  companyId: string
  banks: BankStatementWorkspaceBank[]
  recentBatches: BankStatementBatchListItem[]
}
