import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import {
  ensureCompanyAccess,
  filterCompanyIdsByRoutePermission,
  getScopedCompanyIds,
  normalizeOptionalString,
  requireRoles
} from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'

const allocateSchema = z
  .object({
    companyId: z.string().trim().min(1, 'Company ID is required'),
    billType: z.literal('purchase'),
    billIds: z.array(z.string().trim().min(1)).min(2, 'At least 2 bills are required'),
    payDate: z.string().trim().min(1, 'Pay date is required'),
    amount: z.coerce.number().positive('Amount must be greater than zero'),
    mode: z.string().trim().min(1, 'Payment mode is required'),
    txnRef: z.string().trim().max(100).optional().nullable(),
    note: z.string().trim().max(400).optional().nullable(),
    rule: z.enum(['oldest', 'custom']).optional().default('oldest'),
    customOrder: z.array(z.string().trim().min(1)).optional()
  })
  .strict()

type PurchaseBillSnapshot = {
  id: string
  billNo: string
  billDate: Date
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  status: string
  farmerId: string
}

function getOutstandingAmount(bill: Pick<PurchaseBillSnapshot, 'totalAmount' | 'paidAmount'>): number {
  return Math.max(0, Number(bill.totalAmount || 0) - Number(bill.paidAmount || 0))
}

function deriveStatus(totalAmount: number, paidAmount: number): 'unpaid' | 'partial' | 'paid' {
  const safeTotal = Math.max(0, Number(totalAmount || 0))
  const safePaid = Math.max(0, Number(paidAmount || 0))
  const balance = Math.max(0, safeTotal - safePaid)

  if (balance === 0) return 'paid'
  if (safePaid <= 0) return 'unpaid'
  return 'partial'
}

function sortOldestFirst(bills: PurchaseBillSnapshot[]): PurchaseBillSnapshot[] {
  return bills.slice().sort((a, b) => {
    const dateDifference = new Date(a.billDate).getTime() - new Date(b.billDate).getTime()
    if (dateDifference !== 0) return dateDifference

    return getOutstandingAmount(a) - getOutstandingAmount(b)
  })
}

function getCustomOrder(
  billIds: string[],
  customOrder: string[] | undefined,
  bills: PurchaseBillSnapshot[]
): string[] | null {
  if (!customOrder || customOrder.length === 0) {
    return null
  }

  const uniqueCustomOrder = [...new Set(customOrder)]
  if (uniqueCustomOrder.length !== billIds.length) {
    return null
  }

  const allowedIds = new Set(billIds)
  for (const id of uniqueCustomOrder) {
    if (!allowedIds.has(id)) return null
  }

  const billMap = new Map(bills.map((bill) => [bill.id, bill]))
  return uniqueCustomOrder.filter((id) => billMap.has(id))
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const body = await request.json().catch(() => null)
    const parsed = allocateSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        },
        { status: 400 }
      )
    }

    const data = parsed.data
    const uniqueBillIds = [...new Set(data.billIds)]

    if (uniqueBillIds.length < 2) {
      return NextResponse.json({ error: 'At least 2 unique bills are required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, data.companyId)
    if (denied) return denied

    const scopedCompanyIds = await getScopedCompanyIds(authResult.auth, data.companyId)
    const permissionScopedIds = await filterCompanyIdsByRoutePermission(
      authResult.auth,
      scopedCompanyIds,
      request.nextUrl.pathname,
      request.method
    )

    if (!permissionScopedIds.includes(data.companyId)) {
      return NextResponse.json({ error: 'Company access denied' }, { status: 403 })
    }

    const payDate = new Date(data.payDate)
    if (!Number.isFinite(payDate.getTime())) {
      return NextResponse.json({ error: 'Invalid pay date' }, { status: 400 })
    }

    const requestedBills = await prisma.purchaseBill.findMany({
      where: {
        id: { in: uniqueBillIds },
        companyId: data.companyId
      },
      select: {
        id: true,
        billNo: true,
        billDate: true,
        totalAmount: true,
        paidAmount: true,
        balanceAmount: true,
        status: true,
        farmerId: true
      }
    })

    if (requestedBills.length !== uniqueBillIds.length) {
      return NextResponse.json({ error: 'One or more selected bills were not found' }, { status: 404 })
    }

    const farmerIds = new Set(requestedBills.map((bill) => bill.farmerId))
    if (farmerIds.size !== 1) {
      return NextResponse.json({ error: 'All selected bills must belong to the same party' }, { status: 400 })
    }

    const ineligibleBill = requestedBills.find((bill) => getOutstandingAmount(bill) <= 0)
    if (ineligibleBill) {
      return NextResponse.json({ error: `Bill ${ineligibleBill.billNo} is already fully paid` }, { status: 400 })
    }

    const totalOutstanding = requestedBills.reduce((sum, bill) => sum + getOutstandingAmount(bill), 0)
    if (data.amount > totalOutstanding) {
      return NextResponse.json(
        { error: `Amount cannot exceed selected pending total (${totalOutstanding.toFixed(2)})` },
        { status: 400 }
      )
    }

    const sortedOldest = sortOldestFirst(requestedBills)
    const orderedIds =
      data.rule === 'custom'
        ? getCustomOrder(uniqueBillIds, data.customOrder, requestedBills)
        : sortedOldest.map((bill) => bill.id)

    if (!orderedIds || orderedIds.length !== uniqueBillIds.length) {
      return NextResponse.json({ error: 'Invalid custom order for selected bills' }, { status: 400 })
    }

    const transactionResult = await prisma.$transaction(async (tx) => {
      const txBills = await tx.purchaseBill.findMany({
        where: {
          id: { in: uniqueBillIds },
          companyId: data.companyId
        },
        select: {
          id: true,
          billNo: true,
          billDate: true,
          totalAmount: true,
          paidAmount: true,
          balanceAmount: true,
          status: true,
          farmerId: true
        }
      })

      if (txBills.length !== uniqueBillIds.length) {
        throw new Error('Selected bills changed during allocation. Please retry.')
      }

      const txFarmerIds = new Set(txBills.map((bill) => bill.farmerId))
      if (txFarmerIds.size !== 1) {
        throw new Error('All selected bills must belong to the same party')
      }

      const billMap = new Map(txBills.map((bill) => [bill.id, bill]))
      const orderedBills = orderedIds
        .map((id) => billMap.get(id))
        .filter((bill): bill is PurchaseBillSnapshot => !!bill)

      let remainingAmount = data.amount
      const allocations: Array<{ billId: string; billNo: string; amount: number; remainingBalance: number; paymentId: string }> = []

      for (const bill of orderedBills) {
        if (remainingAmount <= 0) break

        const outstanding = getOutstandingAmount(bill)
        if (outstanding <= 0) continue

        const allocationAmount = Math.min(remainingAmount, outstanding)
        if (allocationAmount <= 0) continue

        const payment = await tx.payment.create({
          data: {
            companyId: data.companyId,
            billType: data.billType,
            billId: bill.id,
            billDate: bill.billDate,
            payDate,
            amount: allocationAmount,
            mode: data.mode,
            status: 'paid',
            txnRef: normalizeOptionalString(data.txnRef),
            note: normalizeOptionalString(data.note),
            farmerId: bill.farmerId,
            partyId: null
          }
        })

        const newPaid = Number(bill.paidAmount || 0) + allocationAmount
        const newBalance = Math.max(0, Number(bill.totalAmount || 0) - newPaid)

        await tx.purchaseBill.update({
          where: { id: bill.id },
          data: {
            paidAmount: newPaid,
            balanceAmount: newBalance,
            status: deriveStatus(bill.totalAmount, newPaid)
          }
        })

        allocations.push({
          billId: bill.id,
          billNo: bill.billNo,
          amount: allocationAmount,
          remainingBalance: newBalance,
          paymentId: payment.id
        })

        remainingAmount -= allocationAmount
      }

      if (allocations.length === 0) {
        throw new Error('No allocation could be performed for selected bills')
      }

      return {
        allocations,
        paymentIds: allocations.map((allocation) => allocation.paymentId),
        totalAllocated: data.amount - remainingAmount,
        remainingAmount
      }
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: 'CREATE',
      resourceType: 'PAYMENT_BATCH',
      resourceId: transactionResult.paymentIds[0] || `batch-${Date.now()}`,
      scope: {
        traderId: authResult.auth.traderId,
        companyId: data.companyId
      },
      before: null,
      after: {
        billType: data.billType,
        billIds: uniqueBillIds,
        paymentIds: transactionResult.paymentIds,
        totalAllocated: transactionResult.totalAllocated,
        rule: data.rule
      },
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json(
      {
        success: true,
        paymentCount: transactionResult.paymentIds.length,
        totalAllocated: transactionResult.totalAllocated,
        remainingAmount: transactionResult.remainingAmount,
        allocations: transactionResult.allocations
      },
      { status: 201 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    const normalizedMessage = message.toLowerCase()

    if (
      normalizedMessage.includes('selected bills') ||
      normalizedMessage.includes('must belong') ||
      normalizedMessage.includes('no allocation')
    ) {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
