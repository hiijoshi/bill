export type PaymentModeOption = {
  id: string
  name: string
  code: string
  isActive: boolean
}

const CASH_KEYWORDS = ['cash', 'nakad', 'naqad']
const BANK_KEYWORDS = ['bank', 'cheque', 'check', 'dd', 'neft', 'rtgs', 'imps', 'wire', 'transfer']

function normalizeModeText(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function hasAnyKeyword(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value === keyword || value.includes(keyword))
}

export function isCashPaymentMode(modeCode: unknown, modeName?: unknown): boolean {
  const code = normalizeModeText(modeCode)
  const name = normalizeModeText(modeName)
  return code === 'c' || hasAnyKeyword(code, CASH_KEYWORDS) || hasAnyKeyword(name, CASH_KEYWORDS)
}

export function isBankPaymentMode(modeCode: unknown, modeName?: unknown): boolean {
  if (isCashPaymentMode(modeCode, modeName)) return false
  const code = normalizeModeText(modeCode)
  const name = normalizeModeText(modeName)
  return hasAnyKeyword(code, BANK_KEYWORDS) || hasAnyKeyword(name, BANK_KEYWORDS)
}

export const DEFAULT_PAYMENT_MODES: PaymentModeOption[] = [
  { id: 'cash', name: 'Cash', code: 'cash', isActive: true },
  { id: 'online', name: 'Online', code: 'online', isActive: true },
  { id: 'bank', name: 'Bank Transfer', code: 'bank', isActive: true }
]
