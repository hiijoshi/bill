export type TaxBreakdown = {
  taxableAmount: number
  gstRate: number
  gstAmount: number
  lineTotal: number
  isTaxExempt: boolean
}

export type TotalsBreakdown = {
  subTotalAmount: number
  gstAmount: number
  freightAmount: number
  otherAmount: number
  insuranceAmount: number
  grandTotal: number
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return parsed
}

export function roundCurrency(value: number): number {
  return Number(toFiniteNumber(value).toFixed(2))
}

export function normalizeNonNegative(value: unknown): number {
  return Math.max(0, toFiniteNumber(value))
}

export function normalizeGstRate(value: unknown): number {
  return Math.max(0, roundCurrency(toFiniteNumber(value)))
}

export function calculateTaxBreakdown(taxableAmount: unknown, gstRate: unknown): TaxBreakdown {
  const safeTaxableAmount = roundCurrency(normalizeNonNegative(taxableAmount))
  const safeGstRate = normalizeGstRate(gstRate)
  const gstAmount = roundCurrency((safeTaxableAmount * safeGstRate) / 100)

  return {
    taxableAmount: safeTaxableAmount,
    gstRate: safeGstRate,
    gstAmount,
    lineTotal: roundCurrency(safeTaxableAmount + gstAmount),
    isTaxExempt: safeGstRate <= 0
  }
}

export function calculateTotalsBreakdown(input: {
  taxableAmounts: number[]
  gstAmounts: number[]
  freightAmount?: unknown
  otherAmount?: unknown
  insuranceAmount?: unknown
}): TotalsBreakdown {
  const subTotalAmount = roundCurrency(
    input.taxableAmounts.reduce((sum, value) => sum + normalizeNonNegative(value), 0)
  )
  const gstAmount = roundCurrency(
    input.gstAmounts.reduce((sum, value) => sum + normalizeNonNegative(value), 0)
  )
  const freightAmount = roundCurrency(normalizeNonNegative(input.freightAmount))
  const otherAmount = roundCurrency(normalizeNonNegative(input.otherAmount))
  const insuranceAmount = roundCurrency(normalizeNonNegative(input.insuranceAmount))

  return {
    subTotalAmount,
    gstAmount,
    freightAmount,
    otherAmount,
    insuranceAmount,
    grandTotal: roundCurrency(subTotalAmount + gstAmount + freightAmount + otherAmount + insuranceAmount)
  }
}
