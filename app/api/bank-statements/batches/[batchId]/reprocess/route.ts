import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logBankStatementEvent } from '@/lib/bank-statements/audit'
import { toBankStatementErrorResponse } from '@/lib/bank-statements/errors'
import {
  assertBatchBelongsToCompany,
  assertCompanyScope,
  requireBankStatementAccess
} from '@/lib/bank-statements/security/require-bank-statement-access'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> }
) {
  const authResult = await requireBankStatementAccess(request, 'write')
  if (!authResult.ok) return authResult.response

  try {
    const { batchId } = await context.params
    const body = await request.json().catch(() => ({}))
    const companyId = String(body?.companyId || '').trim()

    if (!companyId) {
      return NextResponse.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Company ID is required.' } }, { status: 400 })
    }

    await assertCompanyScope(request, companyId, 'write')
    await assertBatchBelongsToCompany(companyId, batchId)

    await prisma.$transaction(async (tx) => {
      await tx.bankReconciliationLink.deleteMany({
        where: {
          statementBatchId: batchId
        }
      })
      await tx.bankStatementMatchCandidate.deleteMany({
        where: {
          statementRow: {
            uploadBatchId: batchId
          }
        }
      })
      await tx.bankStatementRow.updateMany({
        where: {
          uploadBatchId: batchId
        },
        data: {
          matchedLedgerId: null,
          matchedPaymentId: null,
          matchStatus: 'unsettled',
          matchConfidence: null,
          matchReason: null,
          reviewStatus: 'pending',
          reviewedByUserId: null,
          reviewedAt: null,
          ignoredAt: null,
          finalLinkId: null
        }
      })
      await tx.bankStatementBatch.update({
        where: { id: batchId },
        data: {
          batchStatus: 'parsed',
          matchStatus: 'pending',
          finalizeStatus: 'pending',
          settledRows: 0,
          unsettledRows: 0,
          ambiguousRows: 0,
          finalizedAt: null
        }
      })
    })

    await logBankStatementEvent({
      batchId,
      companyId,
      actor: authResult.auth,
      eventType: 'batch_reprocessed',
      stage: 'reprocess',
      note: 'Reset reconciliation results for reprocessing.'
    })

    return NextResponse.json({
      ok: true,
      data: {
        batchId,
        status: 'parsed'
      }
    })
  } catch (error) {
    return toBankStatementErrorResponse(error)
  }
}
