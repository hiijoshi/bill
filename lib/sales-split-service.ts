import type { Prisma, PrismaClient } from '@prisma/client'

import { calculateTotalsBreakdown, roundCurrency } from '@/lib/billing-calculations'
import {
  listSalesAdditionalChargesByBillIds,
  replaceSalesAdditionalChargesForBill,
} from '@/lib/sales-additional-charge-store'
import {
  normalizeSalesAdditionalCharges,
  summarizeSalesAdditionalCharges,
  type SalesAdditionalChargeRecord,
} from '@/lib/sales-additional-charges'
import {
  allocateNextSplitSuffixes,
  buildSplitChildBillNo,
  getNextSplitSuffix,
  normalizeSalesBillSplitView,
  normalizeSalesSplitMethod,
  normalizeSplitPartLabel,
  normalizeSplitSuffix,
  SALES_BILL_KIND,
  SALES_BILL_SPLIT_GROUP_STATUS,
  SALES_BILL_WORKFLOW_STATUS,
  SALES_SPLIT_CHARGE_ALLOCATION_MODE,
  type SalesSplitAllocationInput,
  type SalesSplitPartInput,
  type SalesSplitRequestInput,
  type SalesSplitValidationIssue,
} from '@/lib/sales-split'

type DbClient = PrismaClient | Prisma.TransactionClient

type ParentBillQueryResult = Prisma.SalesBillGetPayload<{
  include: {
    party: {
      select: {
        id: true
        name: true
        address: true
        phone1: true
      }
    }
    salesItems: {
      include: {
        product: {
          select: {
            id: true
            name: true
          }
        }
      }
    }
    transportBills: true
    parentSalesBill: {
      select: {
        id: true
        billNo: true
      }
    }
    childSalesBills: {
      include: {
        salesItems: {
          include: {
            product: {
              select: {
                id: true
                name: true
              }
            }
          }
        }
        transportBills: true
      }
      orderBy: {
        splitSequence: 'asc'
      }
    }
    splitGroup: {
      include: {
        allocations: {
          orderBy: [
            {
              childSalesBillId: 'asc'
            },
            {
              sourceIndex: 'asc'
            }
          ]
        }
      }
    }
  }
}>

type SplitAllocationRow = NonNullable<ParentBillQueryResult['splitGroup']>['allocations'][number]

type WorkspaceSalesItem = {
  id: string
  productId: string
  productName: string
  weight: number
  bags: number
  rate: number
  amount: number
  taxableAmount: number
  gstRateSnapshot: number
  gstAmount: number
  lineTotal: number
}

type WorkspaceTransport = {
  transportName: string | null
  lorryNo: string | null
  freightPerQt: number
  freightAmount: number
  advance: number
  toPay: number
  otherAmount: number
  insuranceAmount: number
}

type WorkspacePart = {
  billId: string | null
  billNo: string
  suffix: string
  splitPartLabel: string
  notes: string | null
  transportName: string | null
  lorryNo: string | null
  workflowStatus: string
  status: string
  totalAmount: number
  receivedAmount: number
  balanceAmount: number
  subTotalAmount: number
  gstAmount: number
  totalWeight: number
  totalBags: number
  transport: WorkspaceTransport | null
  additionalCharges: Array<{
    id?: string
    chargeType: string
    amount: number
    remark: string | null
  }>
  allocations: Array<{
    id?: string
    parentSalesItemId: string
    childSalesItemId?: string | null
    productId: string
    productName: string
    weight: number
    bags: number
    rate: number
    amount: number
    taxableAmount: number
    gstAmount: number
    lineTotal: number
  }>
}

export type SalesSplitWorkspace = {
  parentBill: {
    id: string
    billNo: string
    billDate: string
    companyId: string
    party: {
      id: string
      name: string
      address: string
      phone1: string
    }
    invoiceKind: string
    workflowStatus: string
    splitMethod: string | null
    splitReason: string | null
    splitGroupId: string | null
    totalAmount: number
    receivedAmount: number
    balanceAmount: number
    status: string
    subTotalAmount: number
    gstAmount: number
    totalWeight: number
    totalBags: number
    salesItems: WorkspaceSalesItem[]
    transport: WorkspaceTransport | null
    additionalCharges: Array<{
      id?: string
      chargeType: string
      amount: number
      remark: string | null
    }>
  }
  splitGroup: {
    id: string | null
    status: string | null
    splitMethod: string | null
    reason: string | null
    notes: string | null
    finalizedAt: string | null
  }
  parts: WorkspacePart[]
  canEdit: boolean
  lockReason: string | null
  suggestedNextSuffix: string
}

export type SalesSplitSaveResult = {
  workspace: SalesSplitWorkspace
  mode: 'draft' | 'finalized' | 'merged'
  createdBillIds: string[]
}

type NormalizedParentItem = WorkspaceSalesItem & {
  dbId: string
}

type NormalizedPartAllocation = {
  parentSalesItemId: string
  weight: number
  bags: number | null
  amount: number | null
}

type NormalizedPartInput = {
  sourceBillId: string | null
  suffix: string
  splitPartLabel: string
  notes: string | null
  transportName: string | null
  lorryNo: string | null
  allocations: NormalizedPartAllocation[]
}

type PreviewPartRecord = {
  sourceBillId: string | null
  suffix: string
  billNo: string
  splitPartLabel: string
  notes: string | null
  transportName: string | null
  lorryNo: string | null
  totals: {
    subTotalAmount: number
    gstAmount: number
    totalAmount: number
    totalWeight: number
    totalBags: number
  }
  transport: WorkspaceTransport | null
  additionalCharges: Array<{
    chargeType: string
    amount: number
    remark: string | null
  }>
  allocations: Array<{
    parentSalesItemId: string
    productId: string
    productName: string
    weight: number
    bags: number
    rate: number
    amount: number
    taxableAmount: number
    gstAmount: number
    lineTotal: number
  }>
}

type PreviewComputation = {
  issues: SalesSplitValidationIssue[]
  parts: PreviewPartRecord[]
  totalAmount: number
  totalWeight: number
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, roundCurrency(parsed))
}

function toNonNegativeInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.floor(parsed))
}

function buildTransportSnapshot(
  transport: ParentBillQueryResult['transportBills'][number] | null | undefined,
  additionalCharges: Array<Pick<SalesAdditionalChargeRecord, 'chargeType' | 'amount'>>
): WorkspaceTransport | null {
  if (!transport && additionalCharges.length === 0) {
    return null
  }

  const summary = summarizeSalesAdditionalCharges(additionalCharges)
  const freightAmount = toNonNegativeNumber(transport?.freightAmount)
  const totalWeight = 0

  return {
    transportName: transport?.transportName ? String(transport.transportName) : null,
    lorryNo: transport?.lorryNo ? String(transport.lorryNo) : null,
    freightPerQt:
      freightAmount > 0 && totalWeight > 0
        ? roundCurrency(freightAmount / totalWeight)
        : toNonNegativeNumber(transport?.freightPerQt),
    freightAmount,
    advance: toNonNegativeNumber(transport?.advance),
    toPay: toNonNegativeNumber(transport?.toPay),
    otherAmount: summary.otherAmount,
    insuranceAmount: summary.insuranceAmount,
  }
}

function normalizeWorkspaceSalesItems(items: ParentBillQueryResult['salesItems']): NormalizedParentItem[] {
  return items.map((item) => ({
    dbId: item.id,
    id: item.id,
    productId: item.productId,
    productName: String(item.product?.name || 'Item'),
    weight: toNonNegativeNumber(item.weight),
    bags: toNonNegativeInteger(item.bags),
    rate: toNonNegativeNumber(item.rate),
    amount: toNonNegativeNumber(item.amount),
    taxableAmount: toNonNegativeNumber(item.taxableAmount ?? item.amount),
    gstRateSnapshot: toNonNegativeNumber(item.gstRateSnapshot),
    gstAmount: toNonNegativeNumber(item.gstAmount),
    lineTotal: toNonNegativeNumber(item.lineTotal ?? item.amount),
  }))
}

function allocateIntegerByRatio(total: number, bases: number[]): number[] {
  const safeTotal = Math.max(0, Math.floor(total))
  if (safeTotal === 0 || bases.length === 0) {
    return bases.map(() => 0)
  }

  const normalizedBases = bases.map((value) => Math.max(0, Number(value || 0)))
  const totalBase = normalizedBases.reduce((sum, value) => sum + value, 0)

  if (totalBase <= 0) {
    const rows = bases.map(() => 0)
    rows[0] = safeTotal
    return rows
  }

  const raw = normalizedBases.map((base) => (safeTotal * base) / totalBase)
  const floors = raw.map((value) => Math.floor(value))
  let remaining = safeTotal - floors.reduce((sum, value) => sum + value, 0)

  const ranked = raw
    .map((value, index) => ({
      index,
      fraction: value - Math.floor(value),
    }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)

  for (const entry of ranked) {
    if (remaining <= 0) break
    floors[entry.index] += 1
    remaining -= 1
  }

  return floors
}

function allocateAmountByRatio(total: number, bases: number[]): number[] {
  const cents = allocateIntegerByRatio(Math.round(toNonNegativeNumber(total) * 100), bases)
  return cents.map((value) => roundCurrency(value / 100))
}

function buildChargeShareBases(parts: Array<{ totalWeight: number; subTotalAmount: number }>): number[] {
  const amountBases = parts.map((part) => toNonNegativeNumber(part.subTotalAmount))
  const amountTotal = amountBases.reduce((sum, value) => sum + value, 0)
  if (amountTotal > 0) {
    return amountBases
  }
  return parts.map((part) => toNonNegativeNumber(part.totalWeight))
}

function normalizePartInputs(
  parentBillNo: string,
  existingSuffixMap: Map<string, string>,
  inputParts: SalesSplitPartInput[],
  issues: SalesSplitValidationIssue[]
): NormalizedPartInput[] {
  const usedSuffixes = new Set<string>()
  const pendingSuffixIndexes: number[] = []
  const parts = inputParts.map((part, index) => {
    const sourceBillId = String(part.billId || '').trim() || null
    const fromExisting = sourceBillId ? normalizeSplitSuffix(existingSuffixMap.get(sourceBillId) || '') : ''
    const requestedSuffix = normalizeSplitSuffix(part.suffix)
    const suffix = requestedSuffix || fromExisting

    if (!suffix) {
      pendingSuffixIndexes.push(index)
    } else if (usedSuffixes.has(suffix)) {
      issues.push({
        code: 'DUPLICATE_SUFFIX',
        suffix,
        message: `Split suffix ${suffix} is already used in this request.`,
      })
    } else {
      usedSuffixes.add(suffix)
    }

    return {
      sourceBillId,
      suffix,
      splitPartLabel: normalizeSplitPartLabel(part.partLabel, suffix || `P${index + 1}`),
      notes: String(part.notes || '').trim() || null,
      transportName: String(part.transportName || '').trim() || null,
      lorryNo: String(part.lorryNo || '').trim() || null,
      allocations: Array.isArray(part.allocations)
        ? part.allocations.map((allocation) => ({
            parentSalesItemId: String(allocation.parentSalesItemId || '').trim(),
            weight: toNonNegativeNumber(allocation.weight),
            bags: allocation.bags == null ? null : toNonNegativeInteger(allocation.bags),
            amount: allocation.amount == null ? null : toNonNegativeNumber(allocation.amount),
          }))
        : [],
    }
  })

  if (pendingSuffixIndexes.length > 0) {
    const nextSuffixes = allocateNextSplitSuffixes(Array.from(usedSuffixes), pendingSuffixIndexes.length)
    for (const [offset, index] of pendingSuffixIndexes.entries()) {
      const suffix = nextSuffixes[offset]
      parts[index].suffix = suffix
      parts[index].splitPartLabel = normalizeSplitPartLabel(parts[index].splitPartLabel, suffix)
      usedSuffixes.add(suffix)
    }
  }

  const duplicateBillNos = new Set<string>()
  for (const part of parts) {
    const childBillNo = buildSplitChildBillNo(parentBillNo, part.suffix)
    if (duplicateBillNos.has(childBillNo)) {
      issues.push({
        code: 'DUPLICATE_SUFFIX',
        suffix: part.suffix,
        message: `Split invoice number ${childBillNo} is duplicated in this request.`,
      })
    }
    duplicateBillNos.add(childBillNo)
  }

  return parts
}

function loadPartCharges(
  amounts: number[],
  parentCharges: Array<{
    chargeType: string
    amount: number
    remark: string | null
  }>
): Array<Array<{ chargeType: string; amount: number; remark: string | null }>> {
  if (parentCharges.length === 0 || amounts.length === 0) {
    return amounts.map(() => [])
  }

  const result = amounts.map(() => [] as Array<{ chargeType: string; amount: number; remark: string | null }>)
  const shareBases = amounts.map((value) => Math.max(0, value))

  parentCharges.forEach((charge) => {
    const distributed = allocateAmountByRatio(charge.amount, shareBases)
    distributed.forEach((amount, index) => {
      if (amount <= 0) return
      result[index].push({
        chargeType: charge.chargeType,
        amount,
        remark: charge.remark,
      })
    })
  })

  return result
}

function computeSplitPreview(
  parentBill: ParentBillQueryResult,
  parentCharges: Array<{
    id?: string
    chargeType: string
    amount: number
    remark: string | null
  }>,
  requestInput: SalesSplitRequestInput,
  existingSuffixMap: Map<string, string>
): PreviewComputation {
  const issues: SalesSplitValidationIssue[] = []
  const parentItems = normalizeWorkspaceSalesItems(parentBill.salesItems)
  const itemMap = new Map(parentItems.map((item) => [item.id, item]))
  const parts = normalizePartInputs(parentBill.billNo, existingSuffixMap, requestInput.parts, issues)

  if (parts.length < 2) {
    issues.push({
      code: 'INVALID_PART',
      message: 'At least 2 split parts are required.',
    })
  }

  const allocationsByItem = new Map<string, Array<{ partIndex: number; allocation: NormalizedPartAllocation }>>()
  parts.forEach((part, partIndex) => {
    if (part.allocations.length === 0) {
      issues.push({
        code: 'INVALID_PART',
        suffix: part.suffix,
        message: `Split part ${buildSplitChildBillNo(parentBill.billNo, part.suffix)} has no assigned items.`,
      })
      return
    }

    part.allocations.forEach((allocation) => {
      const parentItem = itemMap.get(allocation.parentSalesItemId)
      if (!parentItem) {
        issues.push({
          code: 'INVALID_ALLOCATION',
          suffix: part.suffix,
          message: `Part ${buildSplitChildBillNo(parentBill.billNo, part.suffix)} references an unknown source item.`,
        })
        return
      }

      if (allocation.weight <= 0) {
        issues.push({
          code: 'INVALID_ALLOCATION',
          suffix: part.suffix,
          itemId: parentItem.id,
          itemName: parentItem.productName,
          message: `Allocation weight must be greater than 0 for ${parentItem.productName}.`,
        })
        return
      }

      const current = allocationsByItem.get(parentItem.id) || []
      current.push({
        partIndex,
        allocation,
      })
      allocationsByItem.set(parentItem.id, current)
    })
  })

  type PartAccumulator = {
    allocations: PreviewPartRecord['allocations']
    subTotalAmount: number
    gstAmount: number
    totalWeight: number
    totalBags: number
  }

  const partAccumulators: PartAccumulator[] = parts.map(() => ({
    allocations: [],
    subTotalAmount: 0,
    gstAmount: 0,
    totalWeight: 0,
    totalBags: 0,
  }))

  for (const parentItem of parentItems) {
    const itemAllocations = allocationsByItem.get(parentItem.id) || []
    if (itemAllocations.length === 0) {
      issues.push({
        code: 'UNASSIGNED_ITEM',
        itemId: parentItem.id,
        itemName: parentItem.productName,
        message: `Unassigned quantity remains for item ${parentItem.productName}.`,
      })
      continue
    }

    const totalAllocatedWeight = roundCurrency(
      itemAllocations.reduce((sum, entry) => sum + entry.allocation.weight, 0)
    )
    if (Math.abs(totalAllocatedWeight - parentItem.weight) > 0.01) {
      issues.push({
        code: 'WEIGHT_MISMATCH',
        itemId: parentItem.id,
        itemName: parentItem.productName,
        message: `Total quantity mismatch for item ${parentItem.productName}.`,
      })
    }

    const providedBags = itemAllocations.map((entry) => entry.allocation.bags)
    let distributedBags = itemAllocations.map(() => 0)
    if (parentItem.bags > 0) {
      const everyBagProvided = providedBags.every((value) => value != null)
      const noBagProvided = providedBags.every((value) => value == null)

      if (everyBagProvided) {
        distributedBags = providedBags.map((value) => toNonNegativeInteger(value))
      } else if (noBagProvided) {
        distributedBags = allocateIntegerByRatio(
          parentItem.bags,
          itemAllocations.map((entry) => entry.allocation.weight)
        )
      } else {
        issues.push({
          code: 'BAGS_MISMATCH',
          itemId: parentItem.id,
          itemName: parentItem.productName,
          message: `Bag allocation for item ${parentItem.productName} must be fully provided or fully blank.`,
        })
      }

      const totalAllocatedBags = distributedBags.reduce((sum, value) => sum + value, 0)
      if (totalAllocatedBags !== parentItem.bags) {
        issues.push({
          code: 'BAGS_MISMATCH',
          itemId: parentItem.id,
          itemName: parentItem.productName,
          message: `Bag total mismatch for item ${parentItem.productName}.`,
        })
      }
    }

    const providedAmounts = itemAllocations.map((entry) => entry.allocation.amount)
    const providedAmountCount = providedAmounts.filter((value) => value != null).length
    let distributedAmounts: number[]

    if (providedAmountCount === 0) {
      distributedAmounts = allocateAmountByRatio(
        parentItem.taxableAmount,
        itemAllocations.map((entry) => entry.allocation.weight)
      )
    } else if (providedAmountCount === itemAllocations.length) {
      distributedAmounts = providedAmounts.map((value) => toNonNegativeNumber(value))
    } else {
      const remainingAmount = roundCurrency(
        parentItem.taxableAmount -
          providedAmounts.reduce<number>((sum, value) => sum + toNonNegativeNumber(value), 0)
      )
      const missingWeightBases = itemAllocations.map((entry) =>
        entry.allocation.amount == null ? entry.allocation.weight : 0
      )
      const missingDistributed = allocateAmountByRatio(remainingAmount, missingWeightBases)
      distributedAmounts = itemAllocations.map((entry, index) =>
        entry.allocation.amount == null ? missingDistributed[index] : toNonNegativeNumber(entry.allocation.amount)
      )
    }

    const totalAllocatedAmount = roundCurrency(distributedAmounts.reduce((sum, value) => sum + value, 0))
    if (Math.abs(totalAllocatedAmount - parentItem.taxableAmount) > 0.01) {
      issues.push({
        code: 'AMOUNT_MISMATCH',
        itemId: parentItem.id,
        itemName: parentItem.productName,
        message: `Total amount mismatch for item ${parentItem.productName}.`,
      })
    }

    const distributedGstAmounts = allocateAmountByRatio(parentItem.gstAmount, distributedAmounts)
    const totalAllocatedGst = roundCurrency(distributedGstAmounts.reduce((sum, value) => sum + value, 0))
    if (Math.abs(totalAllocatedGst - parentItem.gstAmount) > 0.01) {
      issues.push({
        code: 'TAX_MISMATCH',
        itemId: parentItem.id,
        itemName: parentItem.productName,
        message: `Tax mismatch detected while distributing ${parentItem.productName}.`,
      })
    }

    itemAllocations.forEach((entry, allocationIndex) => {
      const amount = distributedAmounts[allocationIndex]
      const gstAmount = distributedGstAmounts[allocationIndex]
      const bags = parentItem.bags > 0 ? distributedBags[allocationIndex] : 0
      const rate = entry.allocation.weight > 0 ? roundCurrency(amount / entry.allocation.weight) : parentItem.rate
      const lineTotal = roundCurrency(amount + gstAmount)
      const partAccumulator = partAccumulators[entry.partIndex]

      partAccumulator.allocations.push({
        parentSalesItemId: parentItem.id,
        productId: parentItem.productId,
        productName: parentItem.productName,
        weight: roundCurrency(entry.allocation.weight),
        bags,
        rate,
        amount,
        taxableAmount: amount,
        gstAmount,
        lineTotal,
      })
      partAccumulator.subTotalAmount = roundCurrency(partAccumulator.subTotalAmount + amount)
      partAccumulator.gstAmount = roundCurrency(partAccumulator.gstAmount + gstAmount)
      partAccumulator.totalWeight = roundCurrency(partAccumulator.totalWeight + entry.allocation.weight)
      partAccumulator.totalBags += bags
    })
  }

  const parentTransport = parentBill.transportBills[0] || null
  const chargeShareBases = buildChargeShareBases(
    partAccumulators.map((part) => ({
      totalWeight: part.totalWeight,
      subTotalAmount: part.subTotalAmount,
    }))
  )
  const distributedFreightAmounts = allocateAmountByRatio(parentTransport?.freightAmount || 0, chargeShareBases)
  const distributedAdvances = allocateAmountByRatio(parentTransport?.advance || 0, chargeShareBases)
  const distributedToPay = allocateAmountByRatio(parentTransport?.toPay || 0, chargeShareBases)
  const distributedChargeRows = loadPartCharges(
    chargeShareBases,
    parentCharges.map((charge) => ({
      chargeType: charge.chargeType,
      amount: charge.amount,
      remark: charge.remark,
    }))
  )

  const previewParts = parts.map((part, index): PreviewPartRecord => {
    const accumulator = partAccumulators[index]
    const charges = normalizeSalesAdditionalCharges(distributedChargeRows[index])
    const chargeSummary = summarizeSalesAdditionalCharges(charges)
    const freightAmount = distributedFreightAmounts[index] || 0
    const totalAmount = calculateTotalsBreakdown({
      taxableAmounts: accumulator.allocations.map((allocation) => allocation.taxableAmount),
      gstAmounts: accumulator.allocations.map((allocation) => allocation.gstAmount),
      freightAmount,
      otherAmount: chargeSummary.otherAmount,
      insuranceAmount: chargeSummary.insuranceAmount,
    }).grandTotal
    const totalWeight = accumulator.totalWeight

    return {
      sourceBillId: part.sourceBillId,
      suffix: part.suffix,
      billNo: buildSplitChildBillNo(parentBill.billNo, part.suffix),
      splitPartLabel: part.splitPartLabel,
      notes: part.notes,
      transportName: part.transportName || (parentTransport?.transportName ? String(parentTransport.transportName) : null),
      lorryNo: part.lorryNo || (parentTransport?.lorryNo ? String(parentTransport.lorryNo) : null),
      totals: {
        subTotalAmount: accumulator.subTotalAmount,
        gstAmount: accumulator.gstAmount,
        totalAmount,
        totalWeight,
        totalBags: accumulator.totalBags,
      },
      transport:
        freightAmount > 0 ||
        distributedAdvances[index] > 0 ||
        distributedToPay[index] > 0 ||
        chargeSummary.totalAmount > 0 ||
        Boolean(part.transportName || part.lorryNo || parentTransport?.transportName || parentTransport?.lorryNo)
          ? {
              transportName:
                part.transportName || (parentTransport?.transportName ? String(parentTransport.transportName) : null),
              lorryNo: part.lorryNo || (parentTransport?.lorryNo ? String(parentTransport.lorryNo) : null),
              freightPerQt: totalWeight > 0 ? roundCurrency(freightAmount / totalWeight) : 0,
              freightAmount,
              advance: distributedAdvances[index] || 0,
              toPay: distributedToPay[index] || 0,
              otherAmount: chargeSummary.otherAmount,
              insuranceAmount: chargeSummary.insuranceAmount,
            }
          : null,
      additionalCharges: charges.map((charge) => ({
        chargeType: charge.chargeType,
        amount: charge.amount,
        remark: charge.remark || null,
      })),
      allocations: accumulator.allocations,
    }
  })

  const previewTotalAmount = roundCurrency(previewParts.reduce((sum, part) => sum + part.totals.totalAmount, 0))
  if (Math.abs(previewTotalAmount - toNonNegativeNumber(parentBill.totalAmount)) > 0.01) {
    issues.push({
      code: 'TOTAL_MISMATCH',
      message: 'Combined child invoice total does not match the parent invoice total.',
    })
  }

  return {
    issues,
    parts: previewParts,
    totalAmount: previewTotalAmount,
    totalWeight: roundCurrency(previewParts.reduce((sum, part) => sum + part.totals.totalWeight, 0)),
  }
}

async function getParentBillRecord(db: DbClient, companyId: string, billId: string): Promise<ParentBillQueryResult | null> {
  const selected = await db.salesBill.findFirst({
    where: {
      id: billId,
      companyId,
    },
    select: {
      id: true,
      parentSalesBillId: true,
      invoiceKind: true,
    },
  })

  if (!selected) return null

  const parentBillId =
    selected.invoiceKind === SALES_BILL_KIND.SPLIT_CHILD && selected.parentSalesBillId
      ? selected.parentSalesBillId
      : selected.id

  return db.salesBill.findFirst({
    where: {
      id: parentBillId,
      companyId,
    },
    include: {
      party: {
        select: {
          id: true,
          name: true,
          address: true,
          phone1: true,
        },
      },
      salesItems: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      transportBills: true,
      parentSalesBill: {
        select: {
          id: true,
          billNo: true,
        },
      },
      childSalesBills: {
        include: {
          salesItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          transportBills: true,
        },
        orderBy: {
          splitSequence: 'asc',
        },
      },
      splitGroup: {
        include: {
          allocations: {
            orderBy: [
              {
                childSalesBillId: 'asc',
              },
              {
                sourceIndex: 'asc',
              },
            ],
          },
        },
      },
    },
  })
}

function buildLockReason(
  parentBill: ParentBillQueryResult,
  paymentCount: number
): string | null {
  if (!parentBill) return 'Parent invoice not found.'
  if (String(parentBill.status || '').toLowerCase() === 'cancelled') {
    return 'Cannot split cancelled invoice.'
  }
  if (parentBill.invoiceKind === SALES_BILL_KIND.SPLIT_CHILD) {
    return 'Split child invoice must be managed from its parent invoice.'
  }
  if (paymentCount > 0) {
    return 'Invoice split is locked because payment or receipt already exists against this hierarchy.'
  }
  if (toNonNegativeNumber(parentBill.receivedAmount) > 0) {
    return 'Invoice split is locked because receipt is already recorded.'
  }
  return null
}

async function countHierarchyPayments(db: DbClient, companyId: string, parentBill: ParentBillQueryResult): Promise<number> {
  const billIds = [parentBill.id, ...parentBill.childSalesBills.map((bill) => bill.id)]
  return db.payment.count({
    where: {
      companyId,
      billType: 'sales',
      billId: {
        in: billIds,
      },
      deletedAt: null,
    },
  })
}

function mapWorkspacePart(
  bill: ParentBillQueryResult['childSalesBills'][number],
  charges: Array<{
    id?: string
    chargeType: string
    amount: number
    remark: string | null
  }>,
  allocations: SplitAllocationRow[]
): WorkspacePart {
  const transport = bill.transportBills[0] || null
  const chargeSummary = summarizeSalesAdditionalCharges(charges)
  const itemAllocations = Array.isArray(allocations)
    ? allocations
        .filter((allocation) => allocation.childSalesBillId === bill.id)
        .map((allocation) => {
          const childItem = bill.salesItems.find((item) => item.id === allocation.childSalesItemId) || null
          return {
            id: allocation.id,
            parentSalesItemId: allocation.parentSalesItemId,
            childSalesItemId: allocation.childSalesItemId,
            productId: childItem?.productId || '',
            productName: String(childItem?.product?.name || 'Item'),
            weight: toNonNegativeNumber(allocation.weight),
            bags: toNonNegativeInteger(allocation.bags),
            rate: toNonNegativeNumber(allocation.rate),
            amount: toNonNegativeNumber(allocation.amount),
            taxableAmount: toNonNegativeNumber(allocation.taxableAmount || allocation.amount),
            gstAmount: toNonNegativeNumber(allocation.gstAmount),
            lineTotal: toNonNegativeNumber(allocation.lineTotal),
          }
        })
    : []

  return {
    billId: bill.id,
    billNo: bill.billNo,
    suffix: normalizeSplitSuffix(bill.splitSuffix),
    splitPartLabel: normalizeSplitPartLabel(bill.splitPartLabel, bill.splitSuffix || ''),
    notes: bill.splitReason || null,
    transportName: transport?.transportName ? String(transport.transportName) : null,
    lorryNo: transport?.lorryNo ? String(transport.lorryNo) : null,
    workflowStatus: String(bill.workflowStatus || ''),
    status: String(bill.status || ''),
    totalAmount: toNonNegativeNumber(bill.totalAmount),
    receivedAmount: toNonNegativeNumber(bill.receivedAmount),
    balanceAmount: toNonNegativeNumber(bill.balanceAmount),
    subTotalAmount: toNonNegativeNumber(bill.subTotalAmount),
    gstAmount: toNonNegativeNumber(bill.gstAmount),
    totalWeight: roundCurrency(bill.salesItems.reduce((sum, item) => sum + toNonNegativeNumber(item.weight), 0)),
    totalBags: bill.salesItems.reduce((sum, item) => sum + toNonNegativeInteger(item.bags), 0),
    transport:
      transport || charges.length > 0
        ? {
            transportName: transport?.transportName ? String(transport.transportName) : null,
            lorryNo: transport?.lorryNo ? String(transport.lorryNo) : null,
            freightPerQt: toNonNegativeNumber(transport?.freightPerQt),
            freightAmount: toNonNegativeNumber(transport?.freightAmount),
            advance: toNonNegativeNumber(transport?.advance),
            toPay: toNonNegativeNumber(transport?.toPay),
            otherAmount: chargeSummary.otherAmount,
            insuranceAmount: chargeSummary.insuranceAmount,
          }
        : null,
    additionalCharges: charges.map((charge) => ({
      id: charge.id,
      chargeType: charge.chargeType,
      amount: charge.amount,
      remark: charge.remark,
    })),
    allocations: itemAllocations,
  }
}

function buildWorkspaceFromParent(
  parentBill: ParentBillQueryResult,
  chargesMap: Map<string, SalesAdditionalChargeRecord[]>,
  paymentCount: number
): SalesSplitWorkspace {
  const parentCharges = (chargesMap.get(parentBill.id) || []).map((charge) => ({
    id: charge.id,
    chargeType: charge.chargeType,
    amount: charge.amount,
    remark: charge.remark,
  }))
  const parentTransport = parentBill.transportBills[0] || null
  const parentChargeSummary = summarizeSalesAdditionalCharges(parentCharges)
  const lockReason = buildLockReason(parentBill, paymentCount)
  const childParts = parentBill.childSalesBills
    .filter((bill) => bill.invoiceKind === SALES_BILL_KIND.SPLIT_CHILD)
    .map((bill) =>
      mapWorkspacePart(
        bill,
        (chargesMap.get(bill.id) || []).map((charge) => ({
          id: charge.id,
          chargeType: charge.chargeType,
          amount: charge.amount,
          remark: charge.remark,
        })),
        (parentBill.splitGroup?.allocations || []) as SplitAllocationRow[]
      )
    )

  return {
    parentBill: {
      id: parentBill.id,
      billNo: parentBill.billNo,
      billDate: parentBill.billDate.toISOString(),
      companyId: parentBill.companyId,
      party: {
        id: parentBill.party.id,
        name: parentBill.party.name,
        address: parentBill.party.address || '',
        phone1: parentBill.party.phone1 || '',
      },
      invoiceKind: parentBill.invoiceKind,
      workflowStatus: parentBill.workflowStatus,
      splitMethod: parentBill.splitMethod || parentBill.splitGroup?.splitMethod || null,
      splitReason: parentBill.splitReason || parentBill.splitGroup?.reason || null,
      splitGroupId: parentBill.splitGroup?.id || null,
      totalAmount: toNonNegativeNumber(parentBill.totalAmount),
      receivedAmount:
        parentBill.invoiceKind === SALES_BILL_KIND.SPLIT_PARENT
          ? roundCurrency(childParts.reduce((sum, part) => sum + part.receivedAmount, 0))
          : toNonNegativeNumber(parentBill.receivedAmount),
      balanceAmount:
        parentBill.invoiceKind === SALES_BILL_KIND.SPLIT_PARENT
          ? roundCurrency(childParts.reduce((sum, part) => sum + part.balanceAmount, 0))
          : toNonNegativeNumber(parentBill.balanceAmount),
      status:
        parentBill.invoiceKind === SALES_BILL_KIND.SPLIT_PARENT
          ? roundCurrency(childParts.reduce((sum, part) => sum + part.balanceAmount, 0)) <= 0
            ? 'paid'
            : roundCurrency(childParts.reduce((sum, part) => sum + part.receivedAmount, 0)) > 0
              ? 'partial'
              : 'unpaid'
          : String(parentBill.status || 'unpaid'),
      subTotalAmount: toNonNegativeNumber(parentBill.subTotalAmount),
      gstAmount: toNonNegativeNumber(parentBill.gstAmount),
      totalWeight: roundCurrency(parentBill.salesItems.reduce((sum, item) => sum + toNonNegativeNumber(item.weight), 0)),
      totalBags: parentBill.salesItems.reduce((sum, item) => sum + toNonNegativeInteger(item.bags), 0),
      salesItems: normalizeWorkspaceSalesItems(parentBill.salesItems),
      transport:
        parentTransport || parentCharges.length > 0
          ? {
              transportName: parentTransport?.transportName ? String(parentTransport.transportName) : null,
              lorryNo: parentTransport?.lorryNo ? String(parentTransport.lorryNo) : null,
              freightPerQt: toNonNegativeNumber(parentTransport?.freightPerQt),
              freightAmount: toNonNegativeNumber(parentTransport?.freightAmount),
              advance: toNonNegativeNumber(parentTransport?.advance),
              toPay: toNonNegativeNumber(parentTransport?.toPay),
              otherAmount: parentChargeSummary.otherAmount,
              insuranceAmount: parentChargeSummary.insuranceAmount,
            }
          : null,
      additionalCharges: parentCharges,
    },
    splitGroup: {
      id: parentBill.splitGroup?.id || null,
      status: parentBill.splitGroup?.status || null,
      splitMethod: parentBill.splitGroup?.splitMethod || null,
      reason: parentBill.splitGroup?.reason || null,
      notes: parentBill.splitGroup?.notes || null,
      finalizedAt: parentBill.splitGroup?.finalizedAt?.toISOString() || null,
    },
    parts: childParts,
    canEdit: !lockReason,
    lockReason,
    suggestedNextSuffix: getNextSplitSuffix(childParts.map((part) => part.suffix)),
  }
}

async function deleteChildBills(
  tx: Prisma.TransactionClient,
  companyId: string,
  childBills: ParentBillQueryResult['childSalesBills']
) {
  const childBillIds = childBills.map((bill) => bill.id)
  if (childBillIds.length === 0) return

  await tx.stockLedger.deleteMany({
    where: {
      companyId,
      refTable: 'sales_bills',
      refId: {
        in: childBillIds,
      },
    },
  })

  await tx.salesBill.deleteMany({
    where: {
      id: {
        in: childBillIds,
      },
    },
  })
}

async function restoreParentStockEntries(
  tx: Prisma.TransactionClient,
  parentBill: ParentBillQueryResult
) {
  await tx.stockLedger.deleteMany({
    where: {
      companyId: parentBill.companyId,
      refTable: 'sales_bills',
      refId: parentBill.id,
    },
  })

  if (String(parentBill.status || '').toLowerCase() === 'cancelled') {
    return
  }

  for (const item of parentBill.salesItems) {
    await tx.stockLedger.create({
      data: {
        companyId: parentBill.companyId,
        entryDate: parentBill.billDate,
        productId: item.productId,
        type: 'sales',
        qtyOut: toNonNegativeNumber(item.weight),
        refTable: 'sales_bills',
        refId: parentBill.id,
      },
    })
  }
}

async function createChildBillsFromPreview(
  tx: Prisma.TransactionClient,
  parentBill: ParentBillQueryResult,
  splitGroupId: string,
  preview: PreviewComputation,
  requestInput: SalesSplitRequestInput,
  workflowStatus: string
): Promise<string[]> {
  const createdBillIds: string[] = []

  for (const [partIndex, part] of preview.parts.entries()) {
    const createdBill = await tx.salesBill.create({
      data: {
        companyId: parentBill.companyId,
        billNo: part.billNo,
        billDate: parentBill.billDate,
        partyId: parentBill.partyId,
        subTotalAmount: part.totals.subTotalAmount,
        gstAmount: part.totals.gstAmount,
        totalAmount: part.totals.totalAmount,
        receivedAmount: 0,
        balanceAmount: part.totals.totalAmount,
        status: 'unpaid',
        invoiceKind: SALES_BILL_KIND.SPLIT_CHILD,
        workflowStatus,
        parentSalesBillId: parentBill.id,
        splitGroupId,
        splitSuffix: part.suffix,
        splitSequence: partIndex + 1,
        splitMethod: requestInput.splitMethod,
        splitReason: requestInput.reason || part.notes || null,
        splitPartLabel: part.splitPartLabel,
        createdBy: parentBill.createdBy || null,
      },
    })

    createdBillIds.push(createdBill.id)
    const createdItemIdMap = new Map<string, string>()

    for (const [allocationIndex, allocation] of part.allocations.entries()) {
      const createdItem = await tx.salesItem.create({
        data: {
          salesBillId: createdBill.id,
          productId: allocation.productId,
          weight: allocation.weight,
          bags: allocation.bags > 0 ? allocation.bags : null,
          rate: allocation.rate,
          taxableAmount: allocation.taxableAmount,
          gstRateSnapshot:
            parentBill.salesItems.find((item) => item.id === allocation.parentSalesItemId)?.gstRateSnapshot || 0,
          gstAmount: allocation.gstAmount,
          lineTotal: allocation.lineTotal,
          amount: allocation.amount,
        },
      })

      createdItemIdMap.set(`${allocation.parentSalesItemId}:${allocationIndex}`, createdItem.id)

      if (workflowStatus === SALES_BILL_WORKFLOW_STATUS.POSTED) {
        await tx.stockLedger.create({
          data: {
            companyId: parentBill.companyId,
            entryDate: parentBill.billDate,
            productId: allocation.productId,
            type: 'sales',
            qtyOut: allocation.weight,
            refTable: 'sales_bills',
            refId: createdBill.id,
          },
        })
      }
    }

    let transportBillId: string | null = null
    if (part.transport) {
      const createdTransportBill = await tx.transportBill.create({
        data: {
          salesBillId: createdBill.id,
          transportName: part.transport.transportName,
          lorryNo: part.transport.lorryNo,
          freightPerQt: part.transport.freightPerQt,
          freightAmount: part.transport.freightAmount,
          advance: part.transport.advance,
          toPay: part.transport.toPay,
          otherAmount: part.transport.otherAmount,
          insuranceAmount: part.transport.insuranceAmount,
        },
      })
      transportBillId = createdTransportBill.id
    }

    await replaceSalesAdditionalChargesForBill(tx, {
      companyId: parentBill.companyId,
      salesBillId: createdBill.id,
      transportBillId,
      charges: part.additionalCharges,
    })

    for (const [allocationIndex, allocation] of part.allocations.entries()) {
      await tx.salesBillSplitAllocation.create({
        data: {
          splitGroupId,
          parentSalesItemId: allocation.parentSalesItemId,
          childSalesBillId: createdBill.id,
          childSalesItemId: createdItemIdMap.get(`${allocation.parentSalesItemId}:${allocationIndex}`) || null,
          allocationMode: requestInput.splitMethod,
          sourceIndex: allocationIndex,
          weight: allocation.weight,
          bags: allocation.bags > 0 ? allocation.bags : null,
          rate: allocation.rate,
          amount: allocation.amount,
          taxableAmount: allocation.taxableAmount,
          gstAmount: allocation.gstAmount,
          lineTotal: allocation.lineTotal,
        },
      })
    }
  }

  return createdBillIds
}

export async function loadSalesBillSplitWorkspace(
  db: DbClient,
  companyId: string,
  billId: string
): Promise<SalesSplitWorkspace | null> {
  const parentBill = await getParentBillRecord(db, companyId, billId)
  if (!parentBill) return null

  const billIds = [parentBill.id, ...parentBill.childSalesBills.map((bill) => bill.id)]
  const [chargesMap, paymentCount] = await Promise.all([
    listSalesAdditionalChargesByBillIds(db, billIds),
    countHierarchyPayments(db, companyId, parentBill),
  ])

  return buildWorkspaceFromParent(parentBill, chargesMap, paymentCount)
}

export async function previewSalesBillSplit(
  db: DbClient,
  input: SalesSplitRequestInput
): Promise<{
  workspace: SalesSplitWorkspace
  preview: PreviewComputation
}> {
  const parentBill = await getParentBillRecord(db, input.companyId, input.parentBillId)
  if (!parentBill) {
    throw new Error('Parent sales invoice not found.')
  }

  const billIds = [parentBill.id, ...parentBill.childSalesBills.map((bill) => bill.id)]
  const [chargesMap, paymentCount] = await Promise.all([
    listSalesAdditionalChargesByBillIds(db, billIds),
    countHierarchyPayments(db, input.companyId, parentBill),
  ])
  const workspace = buildWorkspaceFromParent(parentBill, chargesMap, paymentCount)
  const existingSuffixMap = new Map(
    parentBill.childSalesBills.map((bill) => [bill.id, String(bill.splitSuffix || '')] as const)
  )
  const preview = computeSplitPreview(
    parentBill,
    workspace.parentBill.additionalCharges,
    {
      ...input,
      splitMethod: normalizeSalesSplitMethod(input.splitMethod),
      chargeAllocationMode:
        String(input.chargeAllocationMode || '').trim() || SALES_SPLIT_CHARGE_ALLOCATION_MODE.PROPORTIONAL_AMOUNT,
    },
    existingSuffixMap
  )

  return {
    workspace,
    preview,
  }
}

export async function saveSalesBillSplit(
  db: PrismaClient,
  input: SalesSplitRequestInput
): Promise<SalesSplitSaveResult> {
  const normalizedMethod = normalizeSalesSplitMethod(input.splitMethod)
  const commit = input.commit === true

  return db.$transaction(async (tx) => {
    const parentBill = await getParentBillRecord(tx, input.companyId, input.parentBillId)
    if (!parentBill) {
      throw new Error('Parent sales invoice not found.')
    }

    const paymentCount = await countHierarchyPayments(tx, input.companyId, parentBill)
    const lockReason = buildLockReason(parentBill, paymentCount)
    if (lockReason) {
      throw new Error(lockReason)
    }

    if (input.expectedParentUpdatedAt) {
      const expected = new Date(String(input.expectedParentUpdatedAt))
      if (
        Number.isFinite(expected.getTime()) &&
        expected.toISOString() !== parentBill.updatedAt.toISOString()
      ) {
        throw new Error('Invoice changed while you were editing the split. Please reload and retry.')
      }
    }

    const chargesMap = await listSalesAdditionalChargesByBillIds(tx, [parentBill.id])
    const parentCharges = (chargesMap.get(parentBill.id) || []).map((charge) => ({
      id: charge.id,
      chargeType: charge.chargeType,
      amount: charge.amount,
      remark: charge.remark,
    }))
    const existingSuffixMap = new Map(
      parentBill.childSalesBills.map((bill) => [bill.id, String(bill.splitSuffix || '')] as const)
    )
    const preview = computeSplitPreview(
      parentBill,
      parentCharges,
      {
        ...input,
        splitMethod: normalizedMethod,
      },
      existingSuffixMap
    )

    if (preview.issues.length > 0) {
      const [firstIssue] = preview.issues
      throw new Error(firstIssue?.message || 'Split validation failed.')
    }

    const candidateBillNos = preview.parts.map((part) => part.billNo)
    const duplicateBill = await tx.salesBill.findFirst({
      where: {
        companyId: input.companyId,
        billNo: {
          in: candidateBillNos,
        },
        id: {
          notIn: parentBill.childSalesBills.map((bill) => bill.id),
        },
      },
      select: {
        id: true,
        billNo: true,
      },
    })

    if (duplicateBill) {
      throw new Error(`Split suffix already exists because invoice ${duplicateBill.billNo} is already present.`)
    }

    let splitGroupId = parentBill.splitGroup?.id || null
    if (!splitGroupId) {
      const createdGroup = await tx.salesBillSplitGroup.create({
        data: {
          companyId: input.companyId,
          parentSalesBillId: parentBill.id,
          status: commit ? SALES_BILL_SPLIT_GROUP_STATUS.FINALIZED : SALES_BILL_SPLIT_GROUP_STATUS.DRAFT,
          splitMethod: normalizedMethod,
          chargeAllocationMode:
            String(input.chargeAllocationMode || '').trim() || SALES_SPLIT_CHARGE_ALLOCATION_MODE.PROPORTIONAL_AMOUNT,
          reason: String(input.reason || '').trim() || null,
          notes: String(input.notes || '').trim() || null,
          sourceBillSnapshot: JSON.stringify({
            billNo: parentBill.billNo,
            totalAmount: parentBill.totalAmount,
            subTotalAmount: parentBill.subTotalAmount,
            gstAmount: parentBill.gstAmount,
          }),
          validationSnapshot: JSON.stringify({
            issues: preview.issues,
            previewTotalAmount: preview.totalAmount,
            previewTotalWeight: preview.totalWeight,
          }),
          createdBy: parentBill.createdBy || null,
          updatedBy: parentBill.createdBy || null,
          finalizedAt: commit ? new Date() : null,
        },
      })
      splitGroupId = createdGroup.id
    } else {
      await tx.salesBillSplitGroup.update({
        where: {
          id: splitGroupId,
        },
        data: {
          status: commit ? SALES_BILL_SPLIT_GROUP_STATUS.FINALIZED : SALES_BILL_SPLIT_GROUP_STATUS.DRAFT,
          splitMethod: normalizedMethod,
          chargeAllocationMode:
            String(input.chargeAllocationMode || '').trim() || SALES_SPLIT_CHARGE_ALLOCATION_MODE.PROPORTIONAL_AMOUNT,
          reason: String(input.reason || '').trim() || null,
          notes: String(input.notes || '').trim() || null,
          validationSnapshot: JSON.stringify({
            issues: preview.issues,
            previewTotalAmount: preview.totalAmount,
            previewTotalWeight: preview.totalWeight,
          }),
          finalizedAt: commit ? new Date() : null,
        },
      })
    }

    await deleteChildBills(tx, input.companyId, parentBill.childSalesBills)
    await tx.salesBillSplitAllocation.deleteMany({
      where: {
        splitGroupId,
      },
    })

    if (commit) {
      await tx.stockLedger.deleteMany({
        where: {
          companyId: input.companyId,
          refTable: 'sales_bills',
          refId: parentBill.id,
        },
      })
    }

    const createdBillIds = await createChildBillsFromPreview(
      tx,
      parentBill,
      splitGroupId,
      preview,
      input,
      commit ? SALES_BILL_WORKFLOW_STATUS.POSTED : SALES_BILL_WORKFLOW_STATUS.SPLIT_DRAFT
    )

    await tx.salesBill.update({
      where: {
        id: parentBill.id,
      },
      data: commit
        ? {
            invoiceKind: SALES_BILL_KIND.SPLIT_PARENT,
            workflowStatus: SALES_BILL_WORKFLOW_STATUS.SPLIT_FINALIZED,
            splitGroupId,
            splitMethod: normalizedMethod,
            splitReason: String(input.reason || '').trim() || null,
            splitFinalizedAt: new Date(),
          }
        : {
            splitGroupId,
            splitMethod: normalizedMethod,
            splitReason: String(input.reason || '').trim() || null,
          },
    })

    const workspace = await loadSalesBillSplitWorkspace(tx, input.companyId, parentBill.id)
    if (!workspace) {
      throw new Error('Failed to reload saved split workspace.')
    }

    return {
      workspace,
      mode: commit ? 'finalized' : 'draft',
      createdBillIds,
    }
  })
}

export async function mergeSalesBillSplit(
  db: PrismaClient,
  companyId: string,
  parentBillId: string
): Promise<SalesSplitSaveResult> {
  return db.$transaction(async (tx) => {
    const parentBill = await getParentBillRecord(tx, companyId, parentBillId)
    if (!parentBill) {
      throw new Error('Parent sales invoice not found.')
    }

    if (!parentBill.splitGroup) {
      throw new Error('No invoice split exists for this sales bill.')
    }

    const paymentCount = await countHierarchyPayments(tx, companyId, parentBill)
    const lockReason = buildLockReason(parentBill, paymentCount)
    if (lockReason) {
      throw new Error(lockReason)
    }

    await deleteChildBills(tx, companyId, parentBill.childSalesBills)
    await tx.salesBillSplitAllocation.deleteMany({
      where: {
        splitGroupId: parentBill.splitGroup.id,
      },
    })
    await tx.salesBillSplitGroup.delete({
      where: {
        id: parentBill.splitGroup.id,
      },
    })

    await tx.salesBill.update({
      where: {
        id: parentBill.id,
      },
      data: {
        invoiceKind: SALES_BILL_KIND.REGULAR,
        workflowStatus: SALES_BILL_WORKFLOW_STATUS.POSTED,
        splitGroupId: null,
        splitMethod: null,
        splitReason: null,
        splitSuffix: null,
        splitSequence: null,
        splitPartLabel: null,
        splitFinalizedAt: null,
      },
    })

    await restoreParentStockEntries(tx, parentBill)

    const workspace = await loadSalesBillSplitWorkspace(tx, companyId, parentBill.id)
    if (!workspace) {
      throw new Error('Failed to reload merged sales bill.')
    }

    return {
      workspace,
      mode: 'merged',
      createdBillIds: [],
    }
  })
}

export function buildSalesBillSplitSummary(
  bill: {
    id: string
    billNo: string
    billDate: Date | string
    totalAmount: number
    receivedAmount: number
    balanceAmount: number
    status: string
    invoiceKind?: string | null
    workflowStatus?: string | null
    splitMethod?: string | null
    splitPartLabel?: string | null
    splitSuffix?: string | null
    parentSalesBill?: { id?: string | null; billNo?: string | null } | null
    childSalesBills?: Array<{
      id: string
      totalAmount: number
      receivedAmount: number
      balanceAmount: number
      workflowStatus?: string | null
      invoiceKind?: string | null
    }>
  }
) {
  const invoiceKind = String(bill.invoiceKind || SALES_BILL_KIND.REGULAR)
  const childSalesBills = Array.isArray(bill.childSalesBills)
    ? bill.childSalesBills.filter((child) => String(child.invoiceKind || '') === SALES_BILL_KIND.SPLIT_CHILD)
    : []
  const isSplitParent = invoiceKind === SALES_BILL_KIND.SPLIT_PARENT
  const totalAmount = isSplitParent
    ? roundCurrency(childSalesBills.reduce((sum, child) => sum + toNonNegativeNumber(child.totalAmount), 0))
    : toNonNegativeNumber(bill.totalAmount)
  const receivedAmount = isSplitParent
    ? roundCurrency(childSalesBills.reduce((sum, child) => sum + toNonNegativeNumber(child.receivedAmount), 0))
    : toNonNegativeNumber(bill.receivedAmount)
  const balanceAmount = isSplitParent
    ? roundCurrency(childSalesBills.reduce((sum, child) => sum + toNonNegativeNumber(child.balanceAmount), 0))
    : toNonNegativeNumber(bill.balanceAmount)

  return {
    id: String(bill.id || ''),
    billNo: String(bill.billNo || ''),
    billDate: bill.billDate instanceof Date ? bill.billDate.toISOString() : String(bill.billDate || ''),
    totalAmount,
    receivedAmount,
    balanceAmount,
    status:
      isSplitParent
        ? balanceAmount <= 0
          ? 'paid'
          : receivedAmount > 0
            ? 'partial'
            : 'unpaid'
        : String(bill.status || 'unpaid'),
    invoiceKind,
    workflowStatus: String(bill.workflowStatus || SALES_BILL_WORKFLOW_STATUS.POSTED),
    splitMethod: bill.splitMethod ? String(bill.splitMethod) : null,
    splitPartLabel: bill.splitPartLabel ? String(bill.splitPartLabel) : null,
    splitSuffix: bill.splitSuffix ? String(bill.splitSuffix) : null,
    parentBillId: bill.parentSalesBill?.id ? String(bill.parentSalesBill.id) : null,
    parentBillNo: bill.parentSalesBill?.billNo ? String(bill.parentSalesBill.billNo) : null,
    childCount: childSalesBills.length,
  }
}

export { normalizeSalesBillSplitView }
