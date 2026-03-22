import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  filterCompanyIdsByRoutePermission,
  getScopedCompanyIds,
  normalizeOptionalString,
  requireRoles
} from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'

const idParamsSchema = z.object({ id: z.string().trim().min(1, 'Payment ID is required') })

const updatePaymentSchema = z
  .object({
    amount: z.coerce.number().positive().optional(),
    payDate: z.string().trim().optional(),
    mode: z.string().trim().min(1).optional(),
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
  .strict()
  .refine(
    (value) =>
      value.amount !== undefined ||
      value.payDate !== undefined ||
      value.mode !== undefined ||
      value.cashAmount !== undefined ||
      value.cashPaymentDate !== undefined ||
      value.onlinePayAmount !== undefined ||
      value.onlinePaymentDate !== undefined ||
      value.ifscCode !== undefined ||
      value.beneficiaryBankAccount !== undefined ||
      value.bankNameSnapshot !== undefined ||
      value.bankBranchSnapshot !== undefined ||
      value.asFlag !== undefined ||
      value.txnRef !== undefined ||
      value.note !== undefined ||
      value.status !== undefined,
    { message: 'At least one field is required' }
  )

const parseOptionalDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return null
  return parsed
}

async function recalculateBillTotals(
  tx: Prisma.TransactionClient,
  payment: { id: string; billType: string; billId: string }
) {
  const aggregate = await tx.payment.aggregate({
    where: {
      billType: payment.billType,
      billId: payment.billId,
      deletedAt: null
    },
    _sum: {
      amount: true
    }
  })

  const paid = aggregate._sum.amount || 0

  if (payment.billType === 'purchase') {
    const bill = await tx.purchaseBill.findUnique({
      where: { id: payment.billId },
      select: { id: true, totalAmount: true }
    })

    if (!bill) return

    const balance = Math.max(0, bill.totalAmount - paid)
    const status = balance === 0 ? 'paid' : paid === 0 ? 'unpaid' : 'partial'

    await tx.purchaseBill.update({
      where: { id: payment.billId },
      data: {
        paidAmount: paid,
        balanceAmount: balance,
        status
      }
    })
    return
  }

  const bill = await tx.salesBill.findUnique({
    where: { id: payment.billId },
    select: { id: true, totalAmount: true }
  })

  if (!bill) return

  const balance = Math.max(0, bill.totalAmount - paid)
  const status = balance === 0 ? 'paid' : paid === 0 ? 'unpaid' : 'partial'

  await tx.salesBill.update({
    where: { id: payment.billId },
    data: {
      receivedAmount: paid,
      balanceAmount: balance,
      status
    }
  })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = idParamsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid payment ID' }, { status: 400 })
    }

    const parsedBody = updatePaymentSchema.safeParse(await request.json().catch(() => null))
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsedBody.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const paymentId = parsedParams.data.id
    const existingPayment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        deletedAt: null
      }
    })

    if (!existingPayment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    const scopedCompanyIds = await getScopedCompanyIds(authResult.auth, existingPayment.companyId)
    const permissionScopedIds = await filterCompanyIdsByRoutePermission(
      authResult.auth,
      scopedCompanyIds,
      request.nextUrl.pathname,
      request.method
    )
    if (!permissionScopedIds.includes(existingPayment.companyId)) {
      return NextResponse.json({ error: 'Payment access denied' }, { status: 403 })
    }

    const nextAmount = parsedBody.data.amount ?? existingPayment.amount

    const result = await prisma.$transaction(async (tx) => {
      if (parsedBody.data.amount !== undefined) {
        const aggregate = await tx.payment.aggregate({
          where: {
            billType: existingPayment.billType,
            billId: existingPayment.billId,
            id: { not: paymentId },
            deletedAt: null
          },
          _sum: {
            amount: true
          }
        })

        const otherPaymentsTotal = aggregate._sum.amount || 0

        if (existingPayment.billType === 'purchase') {
          const bill = await tx.purchaseBill.findUnique({
            where: { id: existingPayment.billId },
            select: { totalAmount: true }
          })
          if (!bill || otherPaymentsTotal + nextAmount > bill.totalAmount) {
            throw new Error('Payment amount exceeds pending balance')
          }
        } else {
          const bill = await tx.salesBill.findUnique({
            where: { id: existingPayment.billId },
            select: { totalAmount: true }
          })
          if (!bill || otherPaymentsTotal + nextAmount > bill.totalAmount) {
            throw new Error('Payment amount exceeds pending balance')
          }
        }
      }

      const updatedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          ...(parsedBody.data.amount !== undefined ? { amount: parsedBody.data.amount } : {}),
          ...(parsedBody.data.payDate !== undefined ? { payDate: new Date(parsedBody.data.payDate) } : {}),
          ...(parsedBody.data.mode !== undefined ? { mode: parsedBody.data.mode } : {}),
          ...(parsedBody.data.cashAmount !== undefined ? { cashAmount: parsedBody.data.cashAmount ?? null } : {}),
          ...(parsedBody.data.cashPaymentDate !== undefined
            ? { cashPaymentDate: parseOptionalDate(parsedBody.data.cashPaymentDate) }
            : {}),
          ...(parsedBody.data.onlinePayAmount !== undefined
            ? { onlinePayAmount: parsedBody.data.onlinePayAmount ?? null }
            : {}),
          ...(parsedBody.data.onlinePaymentDate !== undefined
            ? { onlinePaymentDate: parseOptionalDate(parsedBody.data.onlinePaymentDate) }
            : {}),
          ...(parsedBody.data.ifscCode !== undefined
            ? { ifscCode: normalizeOptionalString(parsedBody.data.ifscCode)?.toUpperCase() || null }
            : {}),
          ...(parsedBody.data.beneficiaryBankAccount !== undefined
            ? { beneficiaryBankAccount: normalizeOptionalString(parsedBody.data.beneficiaryBankAccount) }
            : {}),
          ...(parsedBody.data.bankNameSnapshot !== undefined
            ? { bankNameSnapshot: normalizeOptionalString(parsedBody.data.bankNameSnapshot) }
            : {}),
          ...(parsedBody.data.bankBranchSnapshot !== undefined
            ? { bankBranchSnapshot: normalizeOptionalString(parsedBody.data.bankBranchSnapshot) }
            : {}),
          ...(parsedBody.data.asFlag !== undefined
            ? { asFlag: normalizeOptionalString(parsedBody.data.asFlag) || null }
            : {}),
          ...(parsedBody.data.txnRef !== undefined ? { txnRef: normalizeOptionalString(parsedBody.data.txnRef) } : {}),
          ...(parsedBody.data.note !== undefined ? { note: normalizeOptionalString(parsedBody.data.note) } : {}),
          ...(parsedBody.data.status !== undefined ? { status: parsedBody.data.status } : {})
        }
      })

      await recalculateBillTotals(tx, {
        id: updatedPayment.id,
        billType: updatedPayment.billType,
        billId: updatedPayment.billId
      })

      return updatedPayment
    })

    const action =
      parsedBody.data.status !== undefined && parsedBody.data.status !== existingPayment.status
        ? 'STATUS_CHANGE'
        : 'UPDATE'

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action,
      resourceType: 'PAYMENT',
      resourceId: result.id,
      scope: {
        traderId: authResult.auth.traderId,
        companyId: result.companyId
      },
      before: existingPayment,
      after: result,
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json({ success: true, payment: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update payment'
    const status = message.includes('exceeds pending balance') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = idParamsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid payment ID' }, { status: 400 })
    }

    const paymentId = parsedParams.data.id
    const existingPayment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        deletedAt: null
      }
    })

    if (!existingPayment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    const scopedCompanyIds = await getScopedCompanyIds(authResult.auth, existingPayment.companyId)
    const permissionScopedIds = await filterCompanyIdsByRoutePermission(
      authResult.auth,
      scopedCompanyIds,
      request.nextUrl.pathname,
      request.method
    )
    if (!permissionScopedIds.includes(existingPayment.companyId)) {
      return NextResponse.json({ error: 'Payment access denied' }, { status: 403 })
    }

    const deletedAt = new Date()

    const deletedPayment = await prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          deletedAt,
          status: 'pending'
        }
      })

      await recalculateBillTotals(tx, {
        id: updated.id,
        billType: updated.billType,
        billId: updated.billId
      })

      return updated
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: 'DELETE',
      resourceType: 'PAYMENT',
      resourceId: deletedPayment.id,
      scope: {
        traderId: authResult.auth.traderId,
        companyId: deletedPayment.companyId
      },
      before: existingPayment,
      after: deletedPayment,
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete payment' }, { status: 500 })
  }
}
