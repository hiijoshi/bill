export const BANK_STATEMENT_ALLOWED_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'pdf',
  'csv',
  'xls',
  'xlsx'
] as const

export const BANK_STATEMENT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
] as const

export const BANK_STATEMENT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
export const BANK_STATEMENT_DUPLICATE_LOOKBACK_DAYS = 180

export const BANK_STATEMENT_BATCH_STATUS = [
  'uploaded',
  'parsing',
  'parsed',
  'matching',
  'ready_for_review',
  'finalized',
  'failed'
] as const

export const BANK_STATEMENT_STAGE_STATUS = [
  'pending',
  'processing',
  'completed',
  'failed'
] as const

export const BANK_STATEMENT_UPLOAD_STATUS = [
  'created',
  'uploaded',
  'failed'
] as const

export const BANK_STATEMENT_EXTRACTION_STATUS = [
  'parsed',
  'partial',
  'invalid'
] as const

export const BANK_STATEMENT_MATCH_STATUS = [
  'settled',
  'unsettled',
  'ambiguous',
  'ignored'
] as const

export const BANK_STATEMENT_REVIEW_STATUS = [
  'pending',
  'accepted',
  'rejected',
  'manually_linked',
  'ignored'
] as const

export const BANK_STATEMENT_DUPLICATE_STATE = [
  'unique',
  'same_batch_duplicate',
  'cross_batch_duplicate',
  'possible_duplicate'
] as const

export const BANK_RECONCILIATION_LINK_TYPE = [
  'auto',
  'manual'
] as const

export const BANK_STATEMENT_EVENT_TYPE = [
  'batch_created',
  'upload_completed',
  'upload_failed',
  'parse_started',
  'parse_completed',
  'parse_failed',
  'match_started',
  'match_completed',
  'match_failed',
  'row_reviewed',
  'batch_finalized',
  'batch_exported',
  'batch_reprocessed'
] as const
