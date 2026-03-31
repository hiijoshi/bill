import { randomUUID } from 'crypto'

import type { PrismaClient } from '@prisma/client'

import { ensureSalesAdditionalChargeSchema } from '@/lib/sales-additional-charge-schema'
import {
  normalizeSalesAdditionalCharges,
  type SalesAdditionalChargeInput,
  type SalesAdditionalChargeRecord,
} from '@/lib/sales-additional-charges'

type SalesAdditionalChargeStoreClient = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>

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
  await ensureSalesAdditionalChargeSchema(prisma)

  const uniqueIds = Array.from(new Set(salesBillIds.map((value) => String(value || '').trim()).filter(Boolean)))
  if (uniqueIds.length === 0) {
    return new Map<string, SalesAdditionalChargeRecord[]>()
  }

  const placeholders = uniqueIds.map(() => '?').join(', ')
  const rows = await prisma.$queryRawUnsafe<RawSalesAdditionalChargeRow[]>(
    `
      SELECT
        "id",
        "companyId",
        "salesBillId",
        "transportBillId",
        "chargeType",
        "amount",
        "remark",
        "sortOrder"
      FROM "SalesAdditionalCharge"
      WHERE "salesBillId" IN (${placeholders})
      ORDER BY "salesBillId" ASC, "sortOrder" ASC, "createdAt" ASC
    `,
    ...uniqueIds
  )

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
  await ensureSalesAdditionalChargeSchema(prisma)

  const normalizedCharges = normalizeSalesAdditionalCharges(args.charges)
  await prisma.$executeRawUnsafe('DELETE FROM "SalesAdditionalCharge" WHERE "salesBillId" = ?', args.salesBillId)

  if (normalizedCharges.length === 0) {
    return []
  }

  for (const charge of normalizedCharges) {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO "SalesAdditionalCharge" (
          "id",
          "companyId",
          "salesBillId",
          "transportBillId",
          "chargeType",
          "amount",
          "remark",
          "sortOrder",
          "createdAt",
          "updatedAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      randomUUID(),
      args.companyId,
      args.salesBillId,
      args.transportBillId || null,
      charge.chargeType,
      charge.amount,
      charge.remark || null,
      charge.sortOrder
    )
  }

  return normalizedCharges
}
