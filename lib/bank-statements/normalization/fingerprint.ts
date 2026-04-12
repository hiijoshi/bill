import { createHash } from 'crypto'

export function normalizeCompact(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export function buildStatementFingerprint(input: {
  bankId: string | null
  transactionDate: string | null
  valueDate: string | null
  amount: number
  direction: 'debit' | 'credit'
  referenceNumber: string | null
  description: string
}) {
  return createHash('sha256')
    .update([
      input.bankId || '',
      input.transactionDate || '',
      input.valueDate || '',
      input.amount.toFixed(2),
      input.direction,
      normalizeCompact(input.referenceNumber),
      normalizeCompact(input.description)
    ].join('|'))
    .digest('hex')
}
