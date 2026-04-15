import type {
  BankStatementBatchListItem,
  BankStatementLookupPayload,
  BankStatementWorkspacePayload
} from './types'

export type BankStatementApiErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'COMPANY_SCOPE_DENIED'
  | 'BANK_SCOPE_DENIED'
  | 'BATCH_NOT_FOUND'
  | 'ROW_NOT_FOUND'
  | 'CSRF_INVALID'
  | 'VALIDATION_FAILED'
  | 'FILE_INVALID'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'UPLOAD_FAILED'
  | 'INTERNAL_ERROR'

export type BankStatementApiErrorResponse = {
  ok: false
  error: {
    code: BankStatementApiErrorCode
    message: string
    retryable?: boolean
    details?: Record<string, unknown>
  }
}

export type BankStatementCreateBatchRequest = {
  companyId: string
  bankId: string
  fileName: string
  fileMimeType: string
  fileSizeBytes: number
}

export type BankStatementCreateBatchResponse = {
  ok: true
  data: {
    batch: BankStatementBatchListItem
  }
}

export type BankStatementWorkspaceResponse = {
  ok: true
  data: BankStatementWorkspacePayload
}

export type BankStatementLookupResponse = {
  ok: true
  data: BankStatementLookupPayload
}

export type BankStatementSaveDraftRequest = {
  companyId: string
  accountingHeadId?: string | null
  partyId?: string | null
  supplierId?: string | null
  voucherType?: 'cash_bank_payment' | 'cash_bank_receipt' | 'journal' | null
  paymentMode?: string | null
  remarks?: string | null
}

export type BankStatementPostRowsRequest = {
  companyId: string
  rowIds: string[]
}

export type BankStatementQuickCreateTargetRequest = {
  companyId: string
  targetType?: 'auto' | 'accounting_head' | 'party' | 'supplier'
  preferredName?: string | null
}

export type BankStatementQuickCreateTargetResponse = {
  ok: true
  data: {
    rowId: string
    targetType: 'accounting_head' | 'party' | 'supplier'
    targetId: string
    targetName: string
    created: boolean
  }
}

export type CsrfBootstrapResponse = {
  ok: true
  data: {
    csrfToken: string
    namespace: 'app' | 'super_admin'
    refreshedAt: string
  }
}
