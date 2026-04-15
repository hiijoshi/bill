import { z } from 'zod'
import {
  BANK_STATEMENT_ALLOWED_EXTENSIONS,
  BANK_STATEMENT_ALLOWED_MIME_TYPES,
  BANK_STATEMENT_BATCH_STATUS,
  BANK_STATEMENT_DUPLICATE_STATE,
  BANK_STATEMENT_EVENT_TYPE,
  BANK_STATEMENT_EXTRACTION_STATUS,
  BANK_STATEMENT_MATCH_STATUS,
  BANK_STATEMENT_MAX_FILE_SIZE_BYTES,
  BANK_STATEMENT_REVIEW_STATUS,
  BANK_STATEMENT_STAGE_STATUS,
  BANK_STATEMENT_UPLOAD_STATUS,
  BANK_RECONCILIATION_LINK_TYPE
} from './constants'

export const bankStatementDocumentKindSchema = z.enum(['csv', 'excel', 'pdf', 'image'])
export const bankStatementDirectionSchema = z.enum(['debit', 'credit'])
export const bankStatementBatchStatusSchema = z.enum(BANK_STATEMENT_BATCH_STATUS)
export const bankStatementStageStatusSchema = z.enum(BANK_STATEMENT_STAGE_STATUS)
export const bankStatementUploadStatusSchema = z.enum(BANK_STATEMENT_UPLOAD_STATUS)
export const bankStatementExtractionStatusSchema = z.enum(BANK_STATEMENT_EXTRACTION_STATUS)
export const bankStatementMatchStatusSchema = z.enum(BANK_STATEMENT_MATCH_STATUS)
export const bankStatementReviewStatusSchema = z.enum(BANK_STATEMENT_REVIEW_STATUS)
export const bankStatementDuplicateStateSchema = z.enum(BANK_STATEMENT_DUPLICATE_STATE)
export const bankReconciliationLinkTypeSchema = z.enum(BANK_RECONCILIATION_LINK_TYPE)
export const bankStatementEventTypeSchema = z.enum(BANK_STATEMENT_EVENT_TYPE)

export const createBankStatementBatchSchema = z.object({
  companyId: z.string().trim().min(1),
  bankId: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255),
  fileMimeType: z.string().trim().min(1).max(255),
  fileSizeBytes: z.number().int().min(1).max(BANK_STATEMENT_MAX_FILE_SIZE_BYTES)
})

export const uploadBankStatementFileSchema = z.object({
  batchId: z.string().trim().min(1)
})

export const getBankStatementWorkspaceSchema = z.object({
  companyId: z.string().trim().min(1)
})

export const reviewBankStatementRowSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('manual_link'),
    paymentId: z.string().trim().min(1)
  }),
  z.object({
    action: z.literal('mark_unsettled')
  }),
  z.object({
    action: z.literal('ignore')
  }),
  z.object({
    action: z.literal('accept_match')
  })
])

export const saveBankStatementDraftSchema = z.object({
  companyId: z.string().trim().min(1),
  accountingHeadId: z.string().trim().optional().nullable(),
  partyId: z.string().trim().optional().nullable(),
  supplierId: z.string().trim().optional().nullable(),
  voucherType: z.enum(['cash_bank_payment', 'cash_bank_receipt', 'journal']).optional().nullable(),
  paymentMode: z.string().trim().optional().nullable(),
  remarks: z.string().trim().max(400).optional().nullable()
}).superRefine((value, ctx) => {
  if (!value.accountingHeadId && !value.partyId && !value.supplierId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['accountingHeadId'],
      message: 'Select an accounting head, party, or supplier.'
    })
  }
})

export const postBankStatementRowsSchema = z.object({
  companyId: z.string().trim().min(1),
  rowIds: z.array(z.string().trim().min(1)).min(1).max(500)
})

export const quickCreateBankStatementTargetSchema = z.object({
  companyId: z.string().trim().min(1),
  targetType: z.enum(['auto', 'accounting_head', 'party', 'supplier']).optional(),
  preferredName: z.string().trim().min(2).max(120).optional().nullable()
})

export const finalizeBankStatementBatchSchema = z.object({
  confirm: z.literal(true)
})

export const bankStatementUploadFileInfoSchema = z.object({
  fileName: z.string().trim().min(1),
  fileMimeType: z.string().trim().min(1),
  fileExtension: z.string().trim().min(1),
  fileSizeBytes: z.number().int().min(1).max(BANK_STATEMENT_MAX_FILE_SIZE_BYTES)
})
  .superRefine((value, ctx) => {
    const extension = value.fileExtension.toLowerCase()
    const mimeType = value.fileMimeType.toLowerCase()

    if (!BANK_STATEMENT_ALLOWED_EXTENSIONS.includes(extension as (typeof BANK_STATEMENT_ALLOWED_EXTENSIONS)[number])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fileExtension'],
        message: 'Unsupported file extension'
      })
    }

    const allowedByMime = BANK_STATEMENT_ALLOWED_MIME_TYPES.some((allowed) => mimeType === allowed || mimeType.startsWith(`${allowed};`))
    const allowedByBrowserAlias =
      mimeType === 'application/octet-stream' ||
      mimeType === 'application/csv' ||
      mimeType === 'application/x-csv'

    if (!allowedByMime && !allowedByBrowserAlias) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fileMimeType'],
        message: 'Unsupported file mime type'
      })
    }
  })
