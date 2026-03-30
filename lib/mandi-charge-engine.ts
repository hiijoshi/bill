import { roundCurrency } from '@/lib/billing-calculations'

export const MANDI_CALCULATION_BASIS_OPTIONS = [
  { value: 'PERCENT_TOTAL', label: '% of Total' },
  { value: 'PER_WEIGHT', label: 'Per Weight' },
  { value: 'PER_BAG', label: 'Per Bag' }
] as const

export const ACCOUNT_GROUP_OPTIONS = [
  { value: 'DIRECT_EXPENSE', label: 'Direct Expense' },
  { value: 'INDIRECT_EXPENSE', label: 'Indirect Expense' },
  { value: 'LIABILITY', label: 'Liability' }
] as const

export type MandiCalculationBasis = (typeof MANDI_CALCULATION_BASIS_OPTIONS)[number]['value']
export type AccountGroupValue = (typeof ACCOUNT_GROUP_OPTIONS)[number]['value']

export type MandiChargeDefinition = {
  accountingHeadId: string
  name: string
  category: string
  mandiTypeId?: string | null
  isMandiCharge: boolean
  calculationBasis?: string | null
  defaultValue?: number | null
  accountGroup?: string | null
  sortOrder?: number | null
}

export type CalculatedMandiCharge = {
  accountingHeadId: string
  name: string
  category: string
  mandiTypeId?: string | null
  calculationBasis: MandiCalculationBasis
  basisValue: number
  chargeAmount: number
  accountGroup?: string | null
  sortOrder: number
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return parsed
}

function normalizeBasis(value: unknown): MandiCalculationBasis | null {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'PERCENT_TOTAL' || normalized === 'PER_WEIGHT' || normalized === 'PER_BAG') {
    return normalized
  }
  return null
}

function isMandiTypeMatch(configTypeId: string | null | undefined, activeTypeId: string | null | undefined) {
  if (!configTypeId) return true
  return Boolean(activeTypeId && configTypeId === activeTypeId)
}

export function calculateMandiCharges(args: {
  definitions: MandiChargeDefinition[]
  mandiTypeId?: string | null
  subTotal: number
  totalWeight: number
  totalBags: number
}) {
  const activeTypeId = String(args.mandiTypeId || '').trim() || null

  const lines = args.definitions
    .filter((definition) => definition.isMandiCharge)
    .filter((definition) => isMandiTypeMatch(definition.mandiTypeId, activeTypeId))
    .map((definition, index) => {
      const calculationBasis = normalizeBasis(definition.calculationBasis)
      const basisValue = Math.max(0, toNumber(definition.defaultValue))

      if (!calculationBasis || basisValue <= 0) {
        return null
      }

      let chargeAmount = 0
      if (calculationBasis === 'PERCENT_TOTAL') {
        chargeAmount = roundCurrency(Math.max(0, args.subTotal) * (basisValue / 100))
      } else if (calculationBasis === 'PER_WEIGHT') {
        chargeAmount = roundCurrency(Math.max(0, args.totalWeight) * basisValue)
      } else if (calculationBasis === 'PER_BAG') {
        chargeAmount = roundCurrency(Math.max(0, args.totalBags) * basisValue)
      }

      if (chargeAmount <= 0) return null

      return {
        accountingHeadId: definition.accountingHeadId,
        name: definition.name,
        category: definition.category,
        mandiTypeId: definition.mandiTypeId || null,
        calculationBasis,
        basisValue,
        chargeAmount,
        accountGroup: definition.accountGroup || null,
        sortOrder: Number.isFinite(Number(definition.sortOrder)) ? Number(definition.sortOrder) : index
      } satisfies CalculatedMandiCharge
    })
    .filter((line): line is CalculatedMandiCharge => Boolean(line))
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
      return left.name.localeCompare(right.name)
    })

  const totalChargeAmount = roundCurrency(lines.reduce((sum, line) => sum + line.chargeAmount, 0))

  return {
    lines,
    totalChargeAmount
  }
}

export function getCalculationBasisLabel(value: string | null | undefined) {
  const matched = MANDI_CALCULATION_BASIS_OPTIONS.find((option) => option.value === value)
  return matched?.label || '-'
}

export function getAccountGroupLabel(value: string | null | undefined) {
  const matched = ACCOUNT_GROUP_OPTIONS.find((option) => option.value === value)
  return matched?.label || '-'
}
