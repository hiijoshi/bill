import { parseBankStatementFile } from '@/lib/server-bank-statement'
import { adaptLegacyParsedStatementResult } from './adapt-legacy-result'
import type { StatementParser } from './types'

export const imageStatementParser: StatementParser = {
  kind: 'image',
  async extract(file, bankId) {
    const result = await parseBankStatementFile(file, bankId)
    return adaptLegacyParsedStatementResult({ kind: 'image', result })
  }
}
