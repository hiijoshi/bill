import type { Prisma } from '@prisma/client'

export const SALES_BILL_KIND = {
  REGULAR: 'regular',
  SPLIT_PARENT: 'split_parent',
  SPLIT_CHILD: 'split_child',
} as const

export const SALES_BILL_WORKFLOW_STATUS = {
  POSTED: 'posted',
  SPLIT_DRAFT: 'split_draft',
  SPLIT_FINALIZED: 'split_finalized',
  CANCELLED: 'cancelled',
  LOCKED: 'locked',
} as const

export const SALES_BILL_SPLIT_GROUP_STATUS = {
  DRAFT: 'draft',
  FINALIZED: 'finalized',
  MERGED: 'merged',
  LOCKED: 'locked',
  CANCELLED: 'cancelled',
} as const

export const SALES_SPLIT_METHODS = [
  'selected_items',
  'quantity',
  'weight',
  'amount',
  'manual',
  'dispatch',
  'party_instruction',
] as const

export const SALES_SPLIT_CHARGE_ALLOCATION_MODE = {
  PROPORTIONAL_AMOUNT: 'proportional_amount',
} as const

export type SalesBillKind = (typeof SALES_BILL_KIND)[keyof typeof SALES_BILL_KIND]
export type SalesBillWorkflowStatus = (typeof SALES_BILL_WORKFLOW_STATUS)[keyof typeof SALES_BILL_WORKFLOW_STATUS]
export type SalesBillSplitGroupStatus =
  (typeof SALES_BILL_SPLIT_GROUP_STATUS)[keyof typeof SALES_BILL_SPLIT_GROUP_STATUS]
export type SalesSplitMethod = (typeof SALES_SPLIT_METHODS)[number]

export type SalesSplitAllocationInput = {
  parentSalesItemId: string
  weight: number
  bags?: number | null
  amount?: number | null
}

export type SalesSplitPartInput = {
  billId?: string | null
  suffix?: string | null
  partLabel?: string | null
  notes?: string | null
  transportName?: string | null
  lorryNo?: string | null
  allocations: SalesSplitAllocationInput[]
}

export type SalesSplitRequestInput = {
  companyId: string
  parentBillId: string
  splitMethod: SalesSplitMethod
  reason?: string | null
  notes?: string | null
  chargeAllocationMode?: string | null
  expectedParentUpdatedAt?: string | null
  commit?: boolean
  parts: SalesSplitPartInput[]
}

export type SalesSplitValidationIssue = {
  code:
    | 'INVALID_PARENT'
    | 'LOCKED_PARENT'
    | 'INVALID_PART'
    | 'INVALID_ALLOCATION'
    | 'WEIGHT_MISMATCH'
    | 'AMOUNT_MISMATCH'
    | 'BAGS_MISMATCH'
    | 'UNASSIGNED_ITEM'
    | 'DUPLICATE_SUFFIX'
    | 'TAX_MISMATCH'
    | 'TOTAL_MISMATCH'
    | 'CONFLICT'
  message: string
  itemName?: string
  itemId?: string
  suffix?: string
}

export type SalesSplitBillSummary = {
  id: string
  billNo: string
  billDate: string
  totalAmount: number
  receivedAmount: number
  balanceAmount: number
  status: string
  invoiceKind: string
  workflowStatus: string
  splitMethod: string | null
  splitPartLabel: string | null
  splitSuffix: string | null
  parentBillId: string | null
  parentBillNo: string | null
  childCount: number
}

export function normalizeSplitSuffix(value: unknown): string {
  const normalized = String(value || '')
    .trim()
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()

  return normalized
}

export function splitSuffixFromIndex(index: number): string {
  let value = Math.max(1, Math.floor(index))
  let result = ''

  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }

  return result || 'A'
}

export function splitSuffixToIndex(suffix: string): number {
  const normalized = normalizeSplitSuffix(suffix)
  if (!normalized) return 0

  return normalized.split('').reduce((sum, character) => {
    return sum * 26 + (character.charCodeAt(0) - 64)
  }, 0)
}

export function getNextSplitSuffix(existingSuffixes: string[]): string {
  const used = new Set(existingSuffixes.map((suffix) => normalizeSplitSuffix(suffix)).filter(Boolean))
  let index = 1
  while (used.has(splitSuffixFromIndex(index))) {
    index += 1
  }
  return splitSuffixFromIndex(index)
}

export function allocateNextSplitSuffixes(existingSuffixes: string[], count: number): string[] {
  const used = new Set(existingSuffixes.map((suffix) => normalizeSplitSuffix(suffix)).filter(Boolean))
  const next: string[] = []
  let index = 1

  while (next.length < Math.max(0, Math.floor(count))) {
    const suffix = splitSuffixFromIndex(index)
    if (!used.has(suffix)) {
      used.add(suffix)
      next.push(suffix)
    }
    index += 1
  }

  return next
}

export function buildOperationalSalesBillWhere(
  baseWhere: Prisma.SalesBillWhereInput = {}
): Prisma.SalesBillWhereInput {
  return {
    AND: [
      baseWhere,
      {
        OR: [
          {
            invoiceKind: SALES_BILL_KIND.REGULAR,
            workflowStatus: SALES_BILL_WORKFLOW_STATUS.POSTED,
          },
          {
            invoiceKind: SALES_BILL_KIND.SPLIT_CHILD,
            workflowStatus: SALES_BILL_WORKFLOW_STATUS.POSTED,
          },
        ],
      },
    ],
  }
}

export function buildGroupedSalesBillWhere(
  baseWhere: Prisma.SalesBillWhereInput = {}
): Prisma.SalesBillWhereInput {
  return {
    AND: [
      baseWhere,
      {
        OR: [
          {
            invoiceKind: SALES_BILL_KIND.REGULAR,
            workflowStatus: SALES_BILL_WORKFLOW_STATUS.POSTED,
          },
          {
            invoiceKind: SALES_BILL_KIND.SPLIT_PARENT,
            workflowStatus: SALES_BILL_WORKFLOW_STATUS.SPLIT_FINALIZED,
          },
        ],
      },
    ],
  }
}

export function buildChildSalesBillWhere(
  baseWhere: Prisma.SalesBillWhereInput = {}
): Prisma.SalesBillWhereInput {
  return {
    AND: [
      baseWhere,
      {
        invoiceKind: SALES_BILL_KIND.SPLIT_CHILD,
        workflowStatus: SALES_BILL_WORKFLOW_STATUS.POSTED,
      },
    ],
  }
}

export function buildVisibleSalesBillWhere(
  baseWhere: Prisma.SalesBillWhereInput = {},
  splitView: 'grouped' | 'children' | 'all' = 'grouped'
): Prisma.SalesBillWhereInput {
  if (splitView === 'children') {
    return buildChildSalesBillWhere(baseWhere)
  }

  if (splitView === 'all') {
    return {
      AND: [
        baseWhere,
        {
          OR: [
            {
              invoiceKind: SALES_BILL_KIND.REGULAR,
              workflowStatus: SALES_BILL_WORKFLOW_STATUS.POSTED,
            },
            {
              invoiceKind: SALES_BILL_KIND.SPLIT_PARENT,
              workflowStatus: SALES_BILL_WORKFLOW_STATUS.SPLIT_FINALIZED,
            },
            {
              invoiceKind: SALES_BILL_KIND.SPLIT_CHILD,
              workflowStatus: SALES_BILL_WORKFLOW_STATUS.POSTED,
            },
          ],
        },
      ],
    }
  }

  return buildGroupedSalesBillWhere(baseWhere)
}

export function normalizeSalesSplitMethod(value: unknown): SalesSplitMethod {
  const normalized = String(value || '').trim().toLowerCase()
  if ((SALES_SPLIT_METHODS as readonly string[]).includes(normalized)) {
    return normalized as SalesSplitMethod
  }
  return 'manual'
}

export function buildSplitChildBillNo(parentBillNo: string, suffix: string): string {
  const normalizedParent = String(parentBillNo || '').trim()
  const normalizedSuffix = normalizeSplitSuffix(suffix)
  if (!normalizedParent || !normalizedSuffix) {
    return normalizedParent
  }
  return `${normalizedParent}(${normalizedSuffix})`
}

export function normalizeSplitPartLabel(partLabel: unknown, suffix: string): string {
  const normalized = String(partLabel || '').trim()
  if (normalized) return normalized
  const safeSuffix = normalizeSplitSuffix(suffix)
  return safeSuffix ? `Part ${safeSuffix}` : 'Split Part'
}

export function normalizeSalesBillSplitView(value: unknown): 'grouped' | 'children' | 'all' {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'children' || normalized === 'all') return normalized
  return 'grouped'
}
