import { parseBankStatementFile } from '@/lib/server-bank-statement'
import { adaptLegacyParsedStatementResult } from './adapt-legacy-result'
import type { StatementParser } from './types'

export const csvStatementParser: StatementParser = {
  kind: 'csv',
  async extract(file, bankId) {
    const result = await parseBankStatementFile(file, bankId)
    return adaptLegacyParsedStatementResult({ kind: 'csv', result })
  }
}
