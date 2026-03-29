export const PURCHASE_PAYMENT_TYPE = 'purchase'
export const SALES_RECEIPT_TYPE = 'sales'
export const CASH_BANK_PAYMENT_TYPE = 'cash_bank_payment'
export const SELF_TRANSFER_PAYMENT_TYPE = 'self_transfer'

export const PAYMENT_ENTRY_TYPES = [
  PURCHASE_PAYMENT_TYPE,
  SALES_RECEIPT_TYPE,
  CASH_BANK_PAYMENT_TYPE,
  SELF_TRANSFER_PAYMENT_TYPE
] as const

export type PaymentEntryType = (typeof PAYMENT_ENTRY_TYPES)[number]

export function isPaymentEntryType(value: unknown): value is PaymentEntryType {
  return PAYMENT_ENTRY_TYPES.includes(String(value || '').trim() as PaymentEntryType)
}

export function isBillLinkedPaymentType(value: unknown): value is typeof PURCHASE_PAYMENT_TYPE | typeof SALES_RECEIPT_TYPE {
  return value === PURCHASE_PAYMENT_TYPE || value === SALES_RECEIPT_TYPE
}

export function isPurchasePaymentType(value: unknown): value is typeof PURCHASE_PAYMENT_TYPE {
  return value === PURCHASE_PAYMENT_TYPE
}

export function isSalesReceiptType(value: unknown): value is typeof SALES_RECEIPT_TYPE {
  return value === SALES_RECEIPT_TYPE
}

export function isCashBankPaymentType(value: unknown): value is typeof CASH_BANK_PAYMENT_TYPE {
  return value === CASH_BANK_PAYMENT_TYPE
}

export function isSelfTransferPaymentType(value: unknown): value is typeof SELF_TRANSFER_PAYMENT_TYPE {
  return value === SELF_TRANSFER_PAYMENT_TYPE
}

export function isOutgoingCashflowPaymentType(value: unknown): boolean {
  return isPurchasePaymentType(value) || isCashBankPaymentType(value)
}

export function isIncomingCashflowPaymentType(value: unknown): boolean {
  return isSalesReceiptType(value)
}

export function getPaymentTypeLabel(value: unknown): string {
  if (isPurchasePaymentType(value)) return 'Purchase Payment'
  if (isSalesReceiptType(value)) return 'Sales Receipt'
  if (isCashBankPaymentType(value)) return 'Cash / Bank Payment'
  if (isSelfTransferPaymentType(value)) return 'Self Transfer'
  return 'Payment'
}

export function buildCashBankPaymentReference(referenceType: string, referenceId: string): string {
  const type = String(referenceType || 'manual').trim().toLowerCase() || 'manual'
  const id = String(referenceId || 'entry').trim() || 'entry'
  return `cash-bank:${type}:${id}`
}

export function buildSelfTransferReference(fromValue: string, toValue: string): string {
  const from = String(fromValue || 'from').trim().toLowerCase() || 'from'
  const to = String(toValue || 'to').trim().toLowerCase() || 'to'
  return `self-transfer:${from}:${to}`
}
