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
import { roundCurrency } from '@/lib/billing-calculations'
import {
  getPartyOpeningBalanceReference,
  getSignedPartyOpeningBalance,
  isPartyOpeningBalanceReference
} from '@/lib/party-opening-balance'
import {
  findPurchasePaymentTarget,
  type PurchasePaymentTarget,
  updatePurchasePaymentTargetTotals
} from '@/lib/purchase-payment-sync'
import {
  isBillLinkedPaymentType,
  isCashBankPaymentType,
  isPurchasePaymentType,
  isSalesReceiptType,
  PAYMENT_ENTRY_TYPES,
  SALES_RECEIPT_TYPE
} from '@/lib/payment-entry-types'
import { isCashPaymentMode } from '@/lib/payment-mode-utils'
import { loadPaymentsListData, normalizePaymentListView } from '@/lib/server-payment-workspace'
import {
  assertFinancialYearOpenForDate,
  FinancialYearValidationError,
  getFinancialYearDateFilter
} from '@/lib/financial-years'

const paymentCreateSchema = z
  .object({
    companyId: z.string().trim().min(1, 'Company ID is required'),
    billType: z.enum(PAYMENT_ENTRY_TYPES),
    billId: z.string().trim().min(1, 'Bill ID is required'),
    partyId: z.string().trim().optional().nullable(),
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

async function findCompanyPaymentMode(companyId: string, mode: string) {
  const normalizedMode = String(mode || '').trim()
  if (!normalizedMode) {
    return null
  }

  const exactMatch = await prisma.paymentMode.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [{ code: normalizedMode }, { name: normalizedMode }]
    },
    select: {
      name: true,
      code: true
    }
  })

  if (exactMatch) {
    return exactMatch
  }

  const lowerMode = normalizedMode.toLowerCase()
  const candidates = await prisma.paymentMode.findMany({
    where: {
      companyId,
      isActive: true
    },
    select: {
      name: true,
      code: true
    }
  })

  return candidates.find((paymentMode) => {
    const code = String(paymentMode.code || '').trim().toLowerCase()
    const name = String(paymentMode.name || '').trim().toLowerCase()
    return code === lowerMode || name === lowerMode
  }) || null
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

    const isOpeningBalancePayment = data.billType === SALES_RECEIPT_TYPE && isPartyOpeningBalanceReference(data.billId)
    const isBillLinkedPayment = isBillLinkedPaymentType(data.billType)
    let totalAmount = 0
    let paidAmount = 0
    let outstanding = 0
    let billDateValue = new Date(data.payDate)
    let salesPartyId: string | null = null
    let farmerId: string | null = null
    let purchaseTarget: PurchasePaymentTarget | null = null

    if (isOpeningBalancePayment) {
      const openingPartyId =
        (typeof data.partyId === 'string' && data.partyId.trim()) ||
        data.billId.replace(getPartyOpeningBalanceReference(''), '').trim()

      if (!openingPartyId) {
        return NextResponse.json({ error: 'Party ID is required for opening balance receipts' }, { status: 400 })
      }

      const party = await prisma.party.findFirst({
        where: { id: openingPartyId, companyId: data.companyId },
        select: {
          id: true,
          openingBalance: true,
          openingBalanceType: true,
          openingBalanceDate: true
        }
      })

      if (!party) {
        return NextResponse.json({ error: 'Party not found' }, { status: 404 })
      }

      const openingSignedBalance = getSignedPartyOpeningBalance(party.openingBalance, party.openingBalanceType)
      if (openingSignedBalance <= 0) {
        return NextResponse.json({ error: 'This party does not have a receivable opening balance to settle' }, { status: 400 })
      }

      const openingPaymentsAggregate = await prisma.payment.aggregate({
        where: {
          companyId: data.companyId,
          billType: 'sales',
          partyId: party.id,
          billId: getPartyOpeningBalanceReference(party.id),
          deletedAt: null
        },
        _sum: {
          amount: true
        }
      })

      totalAmount = roundCurrency(openingSignedBalance)
      paidAmount = clampNonNegative(openingPaymentsAggregate._sum.amount)
      outstanding = Math.max(0, totalAmount - paidAmount)
      billDateValue = party.openingBalanceDate || billDateValue
      salesPartyId = party.id
    } else if (isBillLinkedPayment) {
      if (isPurchasePaymentType(data.billType)) {
        purchaseTarget = await findPurchasePaymentTarget(prisma, data.companyId, data.billId)

        if (!purchaseTarget) {
          return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
        }

        totalAmount = purchaseTarget.totalAmount
        paidAmount = purchaseTarget.paidAmount
        outstanding = Math.max(0, totalAmount - paidAmount)
        billDateValue = purchaseTarget.billDate
        farmerId = purchaseTarget.farmerId
      } else {
        const bill = await prisma.salesBill.findFirst({
          where: { id: data.billId, companyId: data.companyId },
          select: {
            totalAmount: true,
            receivedAmount: true,
            billDate: true,
            partyId: true
          }
        })

        if (!bill) {
          return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
        }

        totalAmount = bill.totalAmount
        paidAmount = bill.receivedAmount
        outstanding = Math.max(0, totalAmount - paidAmount)
        billDateValue = bill.billDate
        salesPartyId = bill.partyId || null
      }
    } else {
      totalAmount = roundCurrency(data.amount)
      paidAmount = 0
      outstanding = roundCurrency(data.amount)
      billDateValue = new Date(data.payDate)
      salesPartyId = isCashBankPaymentType(data.billType) ? normalizeOptionalString(data.partyId) || null : null
    }

    if (isBillLinkedPayment && data.amount > outstanding) {
      return NextResponse.json({ error: 'Payment amount cannot exceed pending balance' }, { status: 400 })
    }

    const paymentStatus = data.status || 'paid'
    const payDateValue = new Date(data.payDate)
    const normalizedIfscCode = normalizeOptionalString(data.ifscCode)?.toUpperCase() || null
    const paymentModeRecord = await findCompanyPaymentMode(data.companyId, data.mode)
    const isCashMode = isCashPaymentMode(data.mode, paymentModeRecord?.name || '')

    await assertFinancialYearOpenForDate({
      auth: authResult.auth,
      companyId: data.companyId,
      date: payDateValue,
      actionLabel: 'Payment'
    })

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          companyId: data.companyId,
          billType: data.billType,
          billId: data.billId,
          billDate: billDateValue,
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
          partyId: isSalesReceiptType(data.billType) || isCashBankPaymentType(data.billType) ? salesPartyId : null,
          farmerId: isPurchasePaymentType(data.billType) ? farmerId : null
        }
      })

      const newPaid = paidAmount + data.amount
      const newBalance = Math.max(0, totalAmount - newPaid)
      const billStatus = newBalance === 0 ? 'paid' : newBalance === totalAmount ? 'unpaid' : 'partial'

      if (isOpeningBalancePayment) {
        return payment
      }

      if (isPurchasePaymentType(data.billType)) {
        if (!purchaseTarget) {
          throw new Error('Bill not found')
        }

        await updatePurchasePaymentTargetTotals(
          tx,
          {
            kind: purchaseTarget.kind,
            id: data.billId,
            totalAmount
          },
          newPaid
        )
      } else if (isSalesReceiptType(data.billType)) {
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
  } catch (error) {
    if (error instanceof FinancialYearValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const requestedCompanyId = searchParams.get('companyId')?.trim() || null
    const billType = searchParams.get('billType')?.trim() || null
    const view = normalizePaymentListView(searchParams.get('view'))
    const pagination = parsePaginationParams(searchParams, { defaultPageSize: 50, maxPageSize: 200 })
    const includeDeleted =
      authResult.auth.role === 'super_admin' && parseBooleanParam(searchParams.get('includeDeleted'))

    const financialYearFilter = await getFinancialYearDateFilter({
      request,
      auth: authResult.auth,
      companyId: requestedCompanyId
    })

    if (requestedCompanyId) {
      const denied = await ensureCompanyAccess(request, requestedCompanyId)
      if (denied) return denied
    }

    const permissionScopedIds = requestedCompanyId
      ? [requestedCompanyId]
      : await filterCompanyIdsByRoutePermission(
          authResult.auth,
          await getScopedCompanyIds(authResult.auth, requestedCompanyId),
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

    const { rows: enhancedPayments, total } = await loadPaymentsListData({
      companyIds: permissionScopedIds,
      billType,
      includeDeleted,
      pagination,
      view,
      dateFrom: financialYearFilter.dateFrom,
      dateTo: financialYearFilter.dateTo
    })

    if (pagination.enabled) {
      return NextResponse.json({
        data: enhancedPayments,
        meta: buildPaginationMeta(total, pagination)
      })
    }

    return NextResponse.json(enhancedPayments)
  } catch (error) {
    if (error instanceof FinancialYearValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
