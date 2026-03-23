import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  parseBooleanParam,
  requireRoles,
  getScopedCompanyIds,
  ensureCompanyAccess,
  normalizeOptionalString,
  filterCompanyIdsByRoutePermission
} from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { buildPaginationMeta, parsePaginationParams } from '@/lib/pagination'

const paymentCreateSchema = z
  .object({
    companyId: z.string().trim().min(1, 'Company ID is required'),
    billType: z.enum(['purchase', 'sales']),
    billId: z.string().trim().min(1, 'Bill ID is required'),
    payDate: z.string().trim().min(1, 'Pay date is required'),
    amount: z.coerce.number().positive('Amount must be greater than zero'),
    mode: z.string().trim().min(1, 'Payment mode is required'),
    bankId: z.string().trim().optional().nullable(),
    cashAmount: z.coerce.number().nonnegative().optional().nullable(),
    cashPaymentDate: z.string().trim().optional().nullable(),
    onlinePayAmount: z.coerce.number().nonnegative().optional().nullable(),
    onlinePaymentDate: z.string().trim().optional().nullable(),
    ifscCode: z.string().trim().max(20).optional().nullable(),
    beneficiaryBankAccount: z.string().trim().max(64).optional().nullable(),
    bankNameSnapshot: z.string().trim().max(120).optional().nullable(),
    bankBranchSnapshot: z.string().trim().max(120).optional().nullable(),
    asFlag: z.string().trim().max(10).optional().nullable(),
    txnRef: z.string().trim().max(100).optional().nullable(),
    note: z.string().trim().max(400).optional().nullable(),
    status: z.enum(['pending', 'paid']).optional()
  })
  .passthrough()

const clampNonNegative = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

const parseOptionalDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return null
  return parsed
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const body = await request.json().catch(() => null)
    const parsed = paymentCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const data = parsed.data
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

    const bill =
      data.billType === 'purchase'
        ? await prisma.purchaseBill.findFirst({
            where: { id: data.billId, companyId: data.companyId },
            include: { farmer: true }
          })
        : await prisma.salesBill.findFirst({
            where: { id: data.billId, companyId: data.companyId },
            include: { party: true }
          })

    if (!bill) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
    }

    const totalAmount = bill.totalAmount
    const paidAmount =
      data.billType === 'purchase'
        ? 'paidAmount' in bill
          ? bill.paidAmount
          : 0
        : 'receivedAmount' in bill
          ? bill.receivedAmount
          : 0
    const outstanding = Math.max(0, totalAmount - paidAmount)

    if (data.amount > outstanding) {
      return NextResponse.json({ error: 'Payment amount cannot exceed pending balance' }, { status: 400 })
    }

    const paymentStatus = data.status || 'paid'
    const modeLower = (data.mode || '').toLowerCase()
    const isCashMode = modeLower === 'cash' || modeLower === 'c'
    const payDateValue = new Date(data.payDate)
    const normalizedIfscCode = normalizeOptionalString(data.ifscCode)?.toUpperCase() || null

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          companyId: data.companyId,
          billType: data.billType,
          billId: data.billId,
          billDate: bill.billDate,
          payDate: new Date(data.payDate),
          amount: data.amount,
          mode: data.mode,
          cashAmount: data.cashAmount ?? (isCashMode ? data.amount : null),
          cashPaymentDate: parseOptionalDate(data.cashPaymentDate) ?? (isCashMode ? payDateValue : null),
          onlinePayAmount: data.onlinePayAmount ?? (!isCashMode ? data.amount : null),
          onlinePaymentDate: parseOptionalDate(data.onlinePaymentDate) ?? (!isCashMode ? payDateValue : null),
          ifscCode: normalizedIfscCode,
          beneficiaryBankAccount: normalizeOptionalString(data.beneficiaryBankAccount),
          bankNameSnapshot: normalizeOptionalString(data.bankNameSnapshot),
          bankBranchSnapshot: normalizeOptionalString(data.bankBranchSnapshot),
          asFlag: normalizeOptionalString(data.asFlag) || 'A',
          status: paymentStatus,
          txnRef: normalizeOptionalString(data.txnRef),
          note: normalizeOptionalString(data.note),
          partyId: data.billType === 'sales' && 'partyId' in bill ? bill.partyId || null : null,
          farmerId: data.billType === 'purchase' && 'farmerId' in bill ? bill.farmerId || null : null
        }
      })

      const newPaid = paidAmount + data.amount
      const newBalance = Math.max(0, totalAmount - newPaid)
      const billStatus = newBalance === 0 ? 'paid' : newBalance === totalAmount ? 'unpaid' : 'partial'

      if (data.billType === 'purchase') {
        await tx.purchaseBill.update({
          where: { id: data.billId },
          data: {
            paidAmount: newPaid,
            balanceAmount: newBalance,
            status: billStatus
          }
        })
      } else {
        await tx.salesBill.update({
          where: { id: data.billId },
          data: {
            receivedAmount: newPaid,
            balanceAmount: newBalance,
            status: billStatus
          }
        })
      }

      return payment
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: 'CREATE',
      resourceType: 'PAYMENT',
      resourceId: result.id,
      scope: {
        traderId: authResult.auth.traderId,
        companyId: result.companyId
      },
      before: null,
      after: result,
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json({ success: true, payment: result }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const requestedCompanyId = searchParams.get('companyId')?.trim() || null
    const billType = searchParams.get('billType')
    const pagination = parsePaginationParams(searchParams, { defaultPageSize: 50, maxPageSize: 200 })
    const includeDeleted =
      authResult.auth.role === 'super_admin' && parseBooleanParam(searchParams.get('includeDeleted'))

    const scopedCompanyIds = await getScopedCompanyIds(authResult.auth, requestedCompanyId)
    const permissionScopedIds = await filterCompanyIdsByRoutePermission(
      authResult.auth,
      scopedCompanyIds,
      request.nextUrl.pathname,
      request.method
    )

    if (requestedCompanyId && permissionScopedIds.length === 0) {
      return NextResponse.json({ error: 'Missing privilege for requested company' }, { status: 403 })
    }

    if (permissionScopedIds.length === 0) {
      if (pagination.enabled) {
        return NextResponse.json({
          data: [],
          meta: buildPaginationMeta(0, pagination)
        })
      }
      return NextResponse.json([])
    }

    const where = {
      companyId: { in: permissionScopedIds },
      ...(billType === 'purchase' || billType === 'sales' ? { billType } : {}),
      ...(includeDeleted ? {} : { deletedAt: null }),
      ...(pagination.search
        ? {
            OR: [
              { txnRef: { contains: pagination.search } },
              { note: { contains: pagination.search } },
              { mode: { contains: pagination.search } },
              { status: { contains: pagination.search } },
              { billType: { contains: pagination.search } }
            ]
          }
        : {})
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        select: {
          id: true,
          companyId: true,
          billType: true,
          billId: true,
          billDate: true,
          payDate: true,
          amount: true,
          mode: true,
          status: true,
          txnRef: true,
          note: true,
          createdAt: true,
          party: {
            select: {
              name: true
            }
          },
          farmer: {
            select: {
              name: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        ...(pagination.enabled ? { skip: pagination.skip, take: pagination.pageSize } : {})
      }),
      pagination.enabled ? prisma.payment.count({ where }) : Promise.resolve(0)
    ])

    const purchaseBillIds = payments
      .filter((payment) => payment.billType === 'purchase')
      .map((payment) => payment.billId)
    const salesBillIds = payments
      .filter((payment) => payment.billType === 'sales')
      .map((payment) => payment.billId)

    const [purchaseBills, salesBills] = await Promise.all([
      purchaseBillIds.length > 0
        ? prisma.purchaseBill.findMany({
            where: { id: { in: purchaseBillIds } },
            select: { id: true, billNo: true }
          })
        : Promise.resolve([]),
      salesBillIds.length > 0
        ? prisma.salesBill.findMany({
            where: { id: { in: salesBillIds } },
            select: { id: true, billNo: true }
          })
        : Promise.resolve([])
    ])

    const purchaseBillMap = new Map(purchaseBills.map((bill) => [bill.id, bill.billNo]))
    const salesBillMap = new Map(salesBills.map((bill) => [bill.id, bill.billNo]))

    const enhancedPayments = payments.map((payment) => ({
      ...payment,
      amount: clampNonNegative(payment.amount),
      billNo:
        payment.billType === 'purchase'
          ? purchaseBillMap.get(payment.billId) || ''
          : salesBillMap.get(payment.billId) || '',
      partyName: payment.party?.name || payment.farmer?.name || ''
    }))

    if (pagination.enabled) {
      return NextResponse.json({
        data: enhancedPayments,
        meta: buildPaginationMeta(total, pagination)
      })
    }

    return NextResponse.json(enhancedPayments)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
