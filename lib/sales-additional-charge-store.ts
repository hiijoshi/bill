import { randomUUID } from 'crypto'

import type { Prisma, PrismaClient } from '@prisma/client'
import {
  normalizeSalesAdditionalCharges,
  type SalesAdditionalChargeInput,
  type SalesAdditionalChargeRecord,
} from '@/lib/sales-additional-charges'

type SalesAdditionalChargeStoreClient = PrismaClient | Prisma.TransactionClient

type RawSalesAdditionalChargeRow = {
  id?: unknown
  companyId?: unknown
  salesBillId?: unknown
  transportBillId?: unknown
  chargeType?: unknown
  amount?: unknown
  remark?: unknown
  sortOrder?: unknown
}

function normalizeRow(row: RawSalesAdditionalChargeRow): SalesAdditionalChargeRecord {
  const parsedAmount = Number(row?.amount)
  const parsedSortOrder = Number(row?.sortOrder)

  return {
    id: String(row?.id || ''),
    companyId: String(row?.companyId || ''),
    salesBillId: String(row?.salesBillId || ''),
    transportBillId: row?.transportBillId == null ? null : String(row.transportBillId),
    chargeType: String(row?.chargeType || '').trim(),
    amount: Number.isFinite(parsedAmount) ? Math.max(0, Number(parsedAmount.toFixed(2))) : 0,
    remark: row?.remark == null ? null : String(row.remark).trim() || null,
    sortOrder: Number.isFinite(parsedSortOrder) ? Math.max(0, Math.floor(parsedSortOrder)) : 0,
  }
}

export async function listSalesAdditionalChargesByBillIds(
  prisma: SalesAdditionalChargeStoreClient,
  salesBillIds: string[]
) {
  const uniqueIds = Array.from(new Set(salesBillIds.map((value) => String(value || '').trim()).filter(Boolean)))
  if (uniqueIds.length === 0) {
    return new Map<string, SalesAdditionalChargeRecord[]>()
  }

  const rows = await prisma.salesAdditionalCharge.findMany({
    where: {
      salesBillId: {
        in: uniqueIds
      }
    },
    select: {
      id: true,
      companyId: true,
      salesBillId: true,
      transportBillId: true,
      chargeType: true,
      amount: true,
      remark: true,
      sortOrder: true
    },
    orderBy: [{ salesBillId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }]
  })

  const grouped = new Map<string, SalesAdditionalChargeRecord[]>()
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeRow(row)
    if (!normalized.salesBillId || !normalized.chargeType) continue
    const existing = grouped.get(normalized.salesBillId) || []
    existing.push(normalized)
    grouped.set(normalized.salesBillId, existing)
  }

  return grouped
}

export async function replaceSalesAdditionalChargesForBill(
  prisma: SalesAdditionalChargeStoreClient,
  args: {
    companyId: string
    salesBillId: string
    transportBillId?: string | null
    charges?: SalesAdditionalChargeInput[] | null
  }
) {
  const normalizedCharges = normalizeSalesAdditionalCharges(args.charges)
  await prisma.salesAdditionalCharge.deleteMany({
    where: {
      salesBillId: args.salesBillId
    }
  })

  if (normalizedCharges.length === 0) {
    return []
  }

  await prisma.salesAdditionalCharge.createMany({
    data: normalizedCharges.map((charge) => ({
      id: randomUUID(),
      companyId: args.companyId,
      salesBillId: args.salesBillId,
      transportBillId: args.transportBillId || null,
      chargeType: charge.chargeType,
      amount: charge.amount,
      remark: charge.remark || null,
      sortOrder: charge.sortOrder
    }))
  })

  return normalizedCharges
}
