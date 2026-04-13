import type { RequestAuthContext } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { logBankStatementEvent } from '../audit'
import { BankStatementError } from '../errors'
import { serializeBankStatementBatch } from '../serializers'
import { resolveBankStatementActorUser } from '../security/require-bank-statement-access'

export async function finalizeBankStatementBatch(input: {
  auth: RequestAuthContext
  batchId: string
}) {
  const actorUser = await resolveBankStatementActorUser(input.auth)

  const batch = await prisma.bankStatementBatch.findUnique({
    where: { id: input.batchId }
  })

  if (!batch) {
    throw new BankStatementError('BATCH_NOT_FOUND', 'Bank statement batch was not found.', { status: 404 })
  }

  const rows = await prisma.bankStatementRow.findMany({
    where: {
      uploadBatchId: batch.id,
      companyId: batch.companyId
    }
  })

  const unsettledBlocking = rows.some((row) => row.matchStatus === 'ambiguous')
  if (unsettledBlocking) {
    throw new BankStatementError('VALIDATION_FAILED', 'Resolve ambiguous rows before finalizing reconciliation.', {
      status: 409
    })
  }

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      if (row.matchStatus !== 'settled' || !row.matchedPaymentId) {
        if (!row.matchedLedgerId) {
          continue
        }
      }

      const conflicting = await tx.bankReconciliationLink.findFirst({
        where: {
          OR: [
            row.matchedPaymentId
              ? {
                  paymentId: row.matchedPaymentId,
                  statementRowId: {
                    not: row.id
                  }
                }
              : undefined,
            row.matchedLedgerId
              ? {
                  ledgerEntryId: row.matchedLedgerId,
                  statementRowId: {
                    not: row.id
                  }
                }
              : undefined
          ].filter(Boolean) as Array<Record<string, unknown>>
        }
      })

      if (conflicting) {
        throw new BankStatementError('FORBIDDEN', 'A matched bank movement is already finalized against another statement row.', {
          status: 409
        })
      }

      const existing = await tx.bankReconciliationLink.findFirst({
        where: {
          statementRowId: row.id
        }
      })

      if (!existing) {
        const link = await tx.bankReconciliationLink.create({
          data: {
            companyId: row.companyId,
            bankId: row.bankId,
            statementBatchId: batch.id,
            statementRowId: row.id,
            ledgerEntryId: row.matchedLedgerId,
            paymentId: row.matchedPaymentId,
            linkType: row.reviewStatus === 'manually_linked' ? 'manual' : 'auto',
            confidence: row.matchConfidence,
            reason: row.matchReason,
            createdByUserId: actorUser?.id || null
          }
        })

        await tx.bankStatementRow.update({
          where: { id: row.id },
          data: {
            finalLinkId: link.id
          }
        })
      }
    }

    await tx.bankStatementBatch.update({
      where: { id: batch.id },
      data: {
        batchStatus: 'finalized',
        finalizeStatus: 'completed',
        finalizedAt: new Date()
      }
    })
  })

  await logBankStatementEvent({
    batchId: batch.id,
    companyId: batch.companyId,
    actor: input.auth,
    eventType: 'batch_finalized',
    stage: 'finalize',
    note: 'Finalized bank statement reconciliation batch.'
  })

  const updated = await prisma.bankStatementBatch.findUnique({ where: { id: batch.id } })
  if (!updated) {
    throw new BankStatementError('INTERNAL_ERROR', 'Finalized batch could not be reloaded.', { status: 500 })
  }

  return {
    batch: serializeBankStatementBatch(updated)
  }
}
