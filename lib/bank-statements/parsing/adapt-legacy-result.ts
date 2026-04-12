import type { ParsedStatementResult } from '@/lib/server-bank-statement'
import type { ExtractedStatementDocument, ParsedStatementSourceRow } from './types'

function isParsedStatementSourceRow(value: ParsedStatementResult): value is ParsedStatementSourceRow {
  return (
    typeof (value as ParsedStatementSourceRow).postedAt === 'string' &&
    typeof (value as ParsedStatementSourceRow).description === 'string' &&
    typeof (value as ParsedStatementSourceRow).amount === 'number'
  )
}

export function adaptLegacyParsedStatementResult(input: {
  kind: ExtractedStatementDocument['document']['kind']
  result: Awaited<ReturnType<typeof import('@/lib/server-bank-statement').parseBankStatementFile>>
}): ExtractedStatementDocument {
  return {
    document: {
      kind: input.kind,
      parser: input.result.document.parser,
      fileName: input.result.document.fileName,
      recognitionMode: input.result.document.recognitionMode,
      pageCount: input.result.document.pageCount ?? null,
      note: input.result.document.note ?? null
    },
    entries: input.result.entries.filter(isParsedStatementSourceRow)
  }
}
