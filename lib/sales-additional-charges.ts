import { roundCurrency } from '@/lib/billing-calculations'

export type SalesAdditionalChargeInput = {
  chargeType?: string | null
  amount?: unknown
  remark?: string | null
}

export type SalesAdditionalChargeRecord = {
  id: string
  companyId?: string
  salesBillId: string
  transportBillId?: string | null
  chargeType: string
  amount: number
  remark: string | null
  sortOrder: number
}

export const DEFAULT_SALES_ADDITIONAL_CHARGE_TYPES = [
  'Mandi tax %',
  'Labour',
  'Loading labour',
  'Bardan',
  'Commission',
  'Miscellaneous',
  'Other Amount',
  'Insurance',
  'Packing',
  'Loading',
  'Unloading',
  'Handling'
] as const

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeAmount(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, roundCurrency(parsed))
}

export function normalizeSalesAdditionalChargeType(value: unknown): string {
  return normalizeText(value)
}

export function normalizeSalesAdditionalChargeRemark(value: unknown): string | null {
  const normalized = normalizeText(value)
  return normalized ? normalized : null
}

export function isInsuranceChargeType(value: unknown): boolean {
  const normalized = normalizeText(value).toLowerCase()
  if (!normalized) return false
  return normalized === 'insurance' || normalized.includes('insurance')
}

export function normalizeSalesAdditionalCharges(
  entries: SalesAdditionalChargeInput[] | null | undefined
): Array<Pick<SalesAdditionalChargeRecord, 'chargeType' | 'amount' | 'remark' | 'sortOrder'>> {
  if (!Array.isArray(entries)) return []

  return entries
    .map((entry, index) => ({
      chargeType: normalizeSalesAdditionalChargeType(entry?.chargeType),
      amount: normalizeAmount(entry?.amount),
      remark: normalizeSalesAdditionalChargeRemark(entry?.remark),
      sortOrder: index,
    }))
    .filter((entry) => entry.chargeType && entry.amount > 0)
}

export function summarizeSalesAdditionalCharges(
  entries: Array<Pick<SalesAdditionalChargeRecord, 'chargeType' | 'amount'>> | null | undefined
) {
  const normalizedEntries = Array.isArray(entries) ? entries : []

  const insuranceAmount = roundCurrency(
    normalizedEntries.reduce((sum, entry) => {
      return isInsuranceChargeType(entry?.chargeType) ? sum + normalizeAmount(entry?.amount) : sum
    }, 0)
  )

  const totalAmount = roundCurrency(
    normalizedEntries.reduce((sum, entry) => sum + normalizeAmount(entry?.amount), 0)
  )

  return {
    insuranceAmount,
    otherAmount: roundCurrency(totalAmount - insuranceAmount),
    totalAmount,
  }
}
