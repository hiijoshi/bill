import type { RequestAuthContext } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { logBankStatementEvent } from '../audit'
import { BankStatementError } from '../errors'
import { resolveBankStatementActorUser } from '../security/require-bank-statement-access'

export async function reviewBankStatementRow(input: {
  auth: RequestAuthContext
  rowId: string
  action:
    | { action: 'manual_link'; paymentId: string }
    | { action: 'mark_unsettled' }
    | { action: 'ignore' }
    | { action: 'accept_match' }
}) {
  const actorUser = await resolveBankStatementActorUser(input.auth)

  const row = await prisma.bankStatementRow.findUnique({
    where: { id: input.rowId },
    include: {
      batch: true
    }
  })

  if (!row) {
    throw new BankStatementError('ROW_NOT_FOUND', 'Bank statement row was not found.', { status: 404 })
  }

  if (input.action.action === 'manual_link') {
    const payment = await prisma.payment.findFirst({
      where: {
        id: input.action.paymentId,
        companyId: row.companyId,
        deletedAt: null
      }
    })

    if (!payment) {
      throw new BankStatementError('FORBIDDEN', 'Selected bank movement is not available for this company.', {
        status: 403
      })
    }

    const existingLink = await prisma.bankReconciliationLink.findFirst({
      where: {
        paymentId: payment.id,
        statementRowId: {
          not: row.id
        }
      }
    })

    if (existingLink) {
      throw new BankStatementError('FORBIDDEN', 'Selected bank movement is already reconciled with another statement row.', {
        status: 409
      })
    }

    const updated = await prisma.bankStatementRow.update({
      where: { id: row.id },
      data: {
        matchStatus: 'settled',
        matchedPaymentId: payment.id,
        matchConfidence: 100,
        matchReason: 'Manually linked by reviewer.',
        reviewStatus: 'manually_linked',
        reviewedByUserId: actorUser?.id || null,
        reviewedAt: new Date()
      }
    })

    await logBankStatementEvent({
      batchId: row.uploadBatchId,
      companyId: row.companyId,
      actor: input.auth,
      eventType: 'row_reviewed',
      stage: 'review',
      note: 'Statement row linked manually.',
      payload: {
        rowId: row.id,
        paymentId: payment.id
      }
    })

    return updated
  }

  if (input.action.action === 'accept_match') {
    if (!row.matchedPaymentId) {
      throw new BankStatementError('VALIDATION_FAILED', 'This row does not have a selected system match to accept.', {
        status: 400
      })
    }

    const updated = await prisma.bankStatementRow.update({
      where: { id: row.id },
      data: {
        reviewStatus: 'accepted',
        reviewedByUserId: actorUser?.id || null,
        reviewedAt: new Date()
      }
    })

    await logBankStatementEvent({
      batchId: row.uploadBatchId,
      companyId: row.companyId,
      actor: input.auth,
      eventType: 'row_reviewed',
      stage: 'review',
      note: 'Accepted system match for statement row.',
      payload: { rowId: row.id }
    })

    return updated
  }

  if (input.action.action === 'ignore') {
    const updated = await prisma.bankStatementRow.update({
      where: { id: row.id },
      data: {
        matchStatus: 'ignored',
        reviewStatus: 'ignored',
        matchedPaymentId: null,
        reviewedByUserId: actorUser?.id || null,
        reviewedAt: new Date(),
        ignoredAt: new Date(),
        matchReason: 'Ignored during reconciliation review.'
      }
    })

    await logBankStatementEvent({
      batchId: row.uploadBatchId,
      companyId: row.companyId,
      actor: input.auth,
      eventType: 'row_reviewed',
      stage: 'review',
      note: 'Ignored statement row during review.',
      payload: { rowId: row.id }
    })

    return updated
  }

  const updated = await prisma.bankStatementRow.update({
    where: { id: row.id },
    data: {
      matchStatus: 'unsettled',
      matchedPaymentId: null,
      matchConfidence: null,
      reviewStatus: 'rejected',
      reviewedByUserId: actorUser?.id || null,
      reviewedAt: new Date(),
      matchReason: 'Marked unsettled during review.'
    }
  })

  await logBankStatementEvent({
    batchId: row.uploadBatchId,
    companyId: row.companyId,
    actor: input.auth,
    eventType: 'row_reviewed',
    stage: 'review',
    note: 'Marked statement row as unsettled.',
    payload: { rowId: row.id }
  })

  return updated
}
