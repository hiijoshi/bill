import type { BankStatementDocumentKind } from '../types'

export type ParsedStatementSourceRow = {
  rowNo: number
  postedAt: string
  amount: number
  direction: 'in' | 'out'
  description: string
  reference: string | null
  externalId: string
}

export type ExtractedStatementDocument = {
  document: {
    kind: BankStatementDocumentKind
    parser: string
    fileName: string
    recognitionMode?: 'structured' | 'text' | 'ocr'
    pageCount?: number | null
    note?: string | null
  }
  entries: ParsedStatementSourceRow[]
}

export type StatementParser = {
  kind: BankStatementDocumentKind
  extract: (file: File, bankId: string) => Promise<ExtractedStatementDocument>
}
