import { prisma } from '@/lib/prisma'
import type { RequestAuthContext } from '@/lib/api-security'
import { logBankStatementEvent } from '../audit'
import { BankStatementError } from '../errors'
import { serializeBankStatementBatch } from '../serializers'
import { loadBankMovementCandidates } from '../matching/candidate-loader'
import { scoreBankStatementAgainstCandidates } from '../matching/match-engine'
import { resolveMatchDecision } from '../matching/resolve-decision'

export async function matchBankStatementBatch(input: {
  auth: RequestAuthContext
  batchId: string
}) {
  const batch = await prisma.bankStatementBatch.findUnique({
    where: { id: input.batchId }
  })

  if (!batch) {
    throw new BankStatementError('BATCH_NOT_FOUND', 'Bank statement batch was not found.', {
      status: 404
    })
  }

  const rows = await prisma.bankStatementRow.findMany({
    where: {
      uploadBatchId: batch.id,
      companyId: batch.companyId
    },
    orderBy: [
      { transactionDate: 'asc' },
      { sourceRowIndex: 'asc' }
    ]
  })

  await prisma.bankStatementBatch.update({
    where: { id: batch.id },
    data: {
      batchStatus: 'matching',
      matchStatus: 'processing'
    }
  })

  await logBankStatementEvent({
    batchId: batch.id,
    companyId: batch.companyId,
    actor: input.auth,
    eventType: 'match_started',
    stage: 'match',
    note: 'Started matching parsed statement rows against same-company bank movements.'
  })

  const statementDateFrom = rows.map((row) => row.transactionDate).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] || null
  const statementDateTo = rows.map((row) => row.transactionDate).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] || null

  const candidates = await loadBankMovementCandidates({
    companyId: batch.companyId,
    bankId: batch.bankId || null,
    statementDateFrom,
    statementDateTo
  })

  const reservedPaymentIds = new Set<string>()

  await prisma.$transaction(async (tx) => {
    await tx.bankStatementMatchCandidate.deleteMany({
      where: {
        statementRow: {
          uploadBatchId: batch.id
        }
      }
    })

    for (const row of rows) {
      if (row.extractionStatus === 'invalid') {
        await tx.bankStatementRow.update({
          where: { id: row.id },
          data: {
            matchStatus: 'unsettled',
            reviewStatus: 'pending',
            matchReason: 'Row is invalid and cannot be matched.'
          }
        })
        continue
      }

      const scored = scoreBankStatementAgainstCandidates({
        row: {
          transactionDate: row.transactionDate?.toISOString() || null,
          amount: row.amount,
          direction: row.direction as 'debit' | 'credit',
          referenceNumber: row.referenceNumber,
          description: row.description
        },
        candidates: candidates.filter((candidate) => Math.abs(candidate.amount - row.amount) <= 0.009)
      })

      if (scored.length > 0) {
        await tx.bankStatementMatchCandidate.createMany({
          data: scored.slice(0, 5).map((candidate, index) => ({
            statementRowId: row.id,
            paymentId: candidate.paymentId,
            candidateRank: index + 1,
            totalScore: candidate.totalScore,
            amountScore: candidate.amountScore,
            directionScore: candidate.directionScore,
            dateScore: candidate.dateScore,
            referenceScore: candidate.referenceScore,
            narrationScore: candidate.narrationScore,
            balanceScore: candidate.balanceScore,
            decision: 'candidate',
            reason: candidate.reasons.join('; '),
            reasonJson: JSON.stringify(candidate.reasons),
            isReserved: false
          }))
        })
      }

      const decision = resolveMatchDecision(scored)

      if (decision.status === 'settled' && !reservedPaymentIds.has(decision.candidate.paymentId)) {
        reservedPaymentIds.add(decision.candidate.paymentId)
        await tx.bankStatementRow.update({
          where: { id: row.id },
          data: {
            matchStatus: 'settled',
            matchedPaymentId: decision.candidate.paymentId,
            matchConfidence: decision.candidate.totalScore,
            matchReason: decision.reason,
            reviewStatus: 'accepted'
          }
        })
        await tx.bankStatementMatchCandidate.updateMany({
          where: {
            statementRowId: row.id,
            paymentId: decision.candidate.paymentId
          },
          data: {
            decision: 'selected',
            isReserved: true
          }
        })
      } else if (decision.status === 'settled' && reservedPaymentIds.has(decision.candidate.paymentId)) {
        await tx.bankStatementRow.update({
          where: { id: row.id },
          data: {
            matchStatus: 'ambiguous',
            matchedPaymentId: null,
            matchConfidence: decision.candidate.totalScore,
            matchReason: 'Candidate conflicts with another statement row and requires manual review.',
            reviewStatus: 'pending'
          }
        })
      } else if (decision.status === 'ambiguous') {
        await tx.bankStatementRow.update({
          where: { id: row.id },
          data: {
            matchStatus: 'ambiguous',
            matchedPaymentId: null,
            matchConfidence: decision.candidates[0]?.totalScore ?? null,
            matchReason: decision.reason,
            reviewStatus: 'pending'
          }
        })
      } else {
        await tx.bankStatementRow.update({
          where: { id: row.id },
          data: {
            matchStatus: 'unsettled',
            matchedPaymentId: null,
            matchConfidence: null,
            matchReason: decision.reason,
            reviewStatus: 'pending'
          }
        })
      }
    }

    const summaryRows = await tx.bankStatementRow.findMany({
      where: {
        uploadBatchId: batch.id
      },
      select: {
        matchStatus: true
      }
    })

    await tx.bankStatementBatch.update({
      where: { id: batch.id },
      data: {
        batchStatus: 'ready_for_review',
        matchStatus: 'completed',
        settledRows: summaryRows.filter((row) => row.matchStatus === 'settled').length,
        unsettledRows: summaryRows.filter((row) => row.matchStatus === 'unsettled').length,
        ambiguousRows: summaryRows.filter((row) => row.matchStatus === 'ambiguous').length,
        matchedAt: new Date()
      }
    })
  })

  await logBankStatementEvent({
    batchId: batch.id,
    companyId: batch.companyId,
    actor: input.auth,
    eventType: 'match_completed',
    stage: 'match',
    note: 'Completed same-company bank statement matching.'
  })

  const updated = await prisma.bankStatementBatch.findUnique({ where: { id: batch.id } })
  if (!updated) {
    throw new BankStatementError('INTERNAL_ERROR', 'Matched batch could not be reloaded.', { status: 500 })
  }

  return {
    batch: serializeBankStatementBatch(updated)
  }
}
