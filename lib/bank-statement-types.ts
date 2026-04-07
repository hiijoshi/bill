export type StatementDirection = 'in' | 'out'
export type StatementStatus = 'settled' | 'unsettled' | 'invalid' | 'imported'
export type StatementDocumentKind = 'csv' | 'excel' | 'pdf' | 'image' | 'text'
export type StatementTargetType = 'accounting-head' | 'party' | 'supplier'
export type StatementSuggestionConfidence = 'high' | 'medium' | 'low'

export type StatementTargetSelection = {
  targetType: StatementTargetType
  targetId: string
  targetLabel: string
  reason?: string | null
  confidence?: StatementSuggestionConfidence | null
}

export type StatementDocumentMeta = {
  kind: StatementDocumentKind
  parser: string
  fileName: string
  recognitionMode?: 'structured' | 'text' | 'ocr'
  pageCount?: number | null
  note?: string | null
}

export type StatementPreviewRow = {
  rowNo: number
  postedAt: string
  amount: number
  direction: StatementDirection
  description: string
  reference: string | null
  externalId: string
  status: StatementStatus
  matchedPaymentId?: string
  matchedTypeLabel?: string
  matchedTargetLabel?: string
  reason?: string
  suggestedTarget?: StatementTargetSelection | null
  selectedTarget?: StatementTargetSelection | null
}

export type StatementSummary = {
  total: number
  settled: number
  unsettled: number
  imported: number
  errors: number
}
