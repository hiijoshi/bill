import type { BankStatementDocumentKind } from '../types'
import { BankStatementError } from '../errors'
import { csvStatementParser } from './csv-parser'
import { excelStatementParser } from './excel-parser'
import { imageStatementParser } from './image-ocr-parser'
import { pdfStatementParser } from './pdf-text-parser'
import type { StatementParser } from './types'

const registry: Record<BankStatementDocumentKind, StatementParser> = {
  csv: csvStatementParser,
  excel: excelStatementParser,
  pdf: pdfStatementParser,
  image: imageStatementParser
}

export function resolveStatementParser(kind: BankStatementDocumentKind): StatementParser {
  const parser = registry[kind]
  if (!parser) {
    throw new BankStatementError('UNSUPPORTED_FILE_TYPE', `Unsupported statement parser for kind "${kind}".`, {
      status: 400
    })
  }

  return parser
}
