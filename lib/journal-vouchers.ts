export const JOURNAL_VOUCHER_BILL_TYPE = 'journal_voucher'

export const JOURNAL_LEDGER_TYPE_OPTIONS = [
  { value: 'ACCOUNT_HEAD', label: 'Account Head' },
  { value: 'PARTY', label: 'Party' },
  { value: 'FARMER', label: 'Farmer' },
  { value: 'BANK', label: 'Bank' },
  { value: 'CASH', label: 'Cash' }
] as const

export type JournalLedgerType = (typeof JOURNAL_LEDGER_TYPE_OPTIONS)[number]['value']

const JOURNAL_VOUCHER_NUMBER_PATTERN = /^JV-(\d+)$/

export function parseJournalVoucherSequence(value: unknown): number {
  const normalized = String(value || '').trim().toUpperCase()
  const match = JOURNAL_VOUCHER_NUMBER_PATTERN.exec(normalized)
  if (!match) return 0

  const sequence = Number(match[1])
  return Number.isFinite(sequence) && sequence > 0 ? sequence : 0
}

export function formatJournalVoucherNumber(sequence: number): string {
  const safeSequence = Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 1
  return `JV-${String(safeSequence).padStart(6, '0')}`
}

export function getNextJournalVoucherNumber(existingVoucherNumbers: string[]): string {
  const nextSequence =
    existingVoucherNumbers.reduce((maxSequence, voucherNo) => {
      return Math.max(maxSequence, parseJournalVoucherSequence(voucherNo))
    }, 0) + 1

  return formatJournalVoucherNumber(nextSequence)
}

export function normalizeJournalLedgerType(value: unknown): JournalLedgerType {
  const normalized = String(value || '').trim().toUpperCase()
  return JOURNAL_LEDGER_TYPE_OPTIONS.some((option) => option.value === normalized)
    ? (normalized as JournalLedgerType)
    : 'ACCOUNT_HEAD'
}
