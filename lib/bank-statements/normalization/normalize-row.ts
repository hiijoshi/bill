import type { ParsedStatementSourceRow } from '../parsing/types'
import { normalizeStatementDate } from './date-normalizer'
import { buildStatementFingerprint, normalizeCompact } from './fingerprint'
import { extractChequeNumber, extractReferenceNumber } from './reference-extractor'

function normalizeDescription(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function normalizeStatementRow(input: {
  bankId: string | null
  row: ParsedStatementSourceRow
}) {
  const description = normalizeDescription(input.row.description)
  const transactionDate = normalizeStatementDate(input.row.postedAt)
  const referenceNumber = extractReferenceNumber({
    reference: input.row.reference,
    description
  })
  const chequeNumber = extractChequeNumber(description)
  const amount = Math.abs(Number(input.row.amount || 0))
  const direction = input.row.direction === 'in' ? 'credit' : 'debit'
  const debit = direction === 'debit' ? amount : null
  const credit = direction === 'credit' ? amount : null
  const extractionStatus =
    amount > 0 && transactionDate
      ? 'parsed'
      : amount > 0 || Boolean(description)
        ? 'partial'
        : 'invalid'

  const transactionDateIso = transactionDate ? transactionDate.toISOString() : null
  const fingerprint = buildStatementFingerprint({
    bankId: input.bankId,
    transactionDate: transactionDateIso,
    valueDate: null,
    amount,
    direction,
    referenceNumber,
    description
  })

  return {
    sourceRowIndex: input.row.rowNo,
    transactionDate,
    valueDate: null,
    description,
    descriptionNormalized: normalizeCompact(description),
    debit,
    credit,
    amount,
    direction,
    referenceNumber,
    referenceNormalized: normalizeCompact(referenceNumber),
    chequeNumber,
    balance: null,
    transactionType: null,
    rawRowJson: JSON.stringify(input.row),
    parserConfidence: extractionStatus === 'parsed' ? 0.92 : extractionStatus === 'partial' ? 0.68 : 0.2,
    extractionStatus,
    duplicateFingerprint: fingerprint
  }
}
