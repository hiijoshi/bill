import { prisma } from '@/lib/prisma'
import type { BankStatementMatchCandidate, NormalizedStatementTransaction } from '../types'
import { serializeBankStatementBatch } from '../serializers'

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export async function loadBankStatementBatchDetails(companyId: string, batchId: string) {
  const batch = await prisma.bankStatementBatch.findFirst({
    where: {
      id: batchId,
      companyId
    }
  })

  if (!batch) return null

  const rows = await prisma.bankStatementRow.findMany({
    where: {
      companyId,
      uploadBatchId: batchId
    },
    orderBy: [
      { sourcePageNumber: 'asc' },
      { sourceRowIndex: 'asc' }
    ],
    include: {
      matchCandidates: {
        include: {
          ledgerEntry: {
            select: {
              id: true,
              accountHeadNameSnapshot: true,
              counterpartyNameSnapshot: true,
              amount: true,
              entryDate: true,
              note: true
            }
          },
          payment: {
            select: {
              id: true,
              amount: true,
              payDate: true,
              txnRef: true,
              bankNameSnapshot: true,
              beneficiaryBankAccount: true,
              ifscCode: true,
              mode: true,
              party: {
                select: { name: true }
              },
              farmer: {
                select: { name: true }
              }
            }
          }
        },
        orderBy: {
          candidateRank: 'asc'
        }
      }
    }
  })

  const normalizedRows: Array<NormalizedStatementTransaction & { matchCandidates: BankStatementMatchCandidate[] }> = rows.map((row) => ({
    id: row.id,
    companyId: row.companyId,
    uploadBatchId: row.uploadBatchId,
    bankId: row.bankId || null,
    sourceRowIndex: row.sourceRowIndex,
    sourcePageNumber: row.sourcePageNumber ?? null,
    sourceSheetName: row.sourceSheetName || null,
    transactionDate: row.transactionDate?.toISOString() || null,
    valueDate: row.valueDate?.toISOString() || null,
    description: row.description,
    descriptionNormalized: row.descriptionNormalized || null,
    debit: row.debit ?? null,
    credit: row.credit ?? null,
    amount: row.amount,
    direction: row.direction as NormalizedStatementTransaction['direction'],
    referenceNumber: row.referenceNumber || null,
    referenceNormalized: row.referenceNormalized || null,
    chequeNumber: row.chequeNumber || null,
    balance: row.balance ?? null,
    transactionType: row.transactionType || null,
    rawRow: parseJson<Record<string, unknown>>(row.rawRowJson),
    parserType: row.parserType,
    parserConfidence: row.parserConfidence ?? null,
    extractionStatus: row.extractionStatus as NormalizedStatementTransaction['extractionStatus'],
    duplicateFingerprint: row.duplicateFingerprint,
    duplicateState: row.duplicateState as NormalizedStatementTransaction['duplicateState'],
    duplicateOfRowId: row.duplicateOfRowId || null,
    matchStatus: row.matchStatus as NormalizedStatementTransaction['matchStatus'],
    matchedLedgerId: row.matchedLedgerId || null,
    matchedPaymentId: row.matchedPaymentId || null,
    matchConfidence: row.matchConfidence ?? null,
    matchReason: row.matchReason || null,
    matchReasonJson: row.matchReasonJson || null,
    draftAccountingHeadId: row.draftAccountingHeadId || null,
    draftPartyId: row.draftPartyId || null,
    draftSupplierId: row.draftSupplierId || null,
    draftVoucherType: (row.draftVoucherType as NormalizedStatementTransaction['draftVoucherType']) || null,
    draftPaymentMode: row.draftPaymentMode || null,
    draftRemarks: row.draftRemarks || null,
    postedPaymentId: row.postedPaymentId || null,
    postedLedgerEntryId: row.postedLedgerEntryId || null,
    postedAt: row.postedAt?.toISOString() || null,
    reviewStatus: row.reviewStatus as NormalizedStatementTransaction['reviewStatus'],
    reviewedByUserId: row.reviewedByUserId || null,
    reviewedAt: row.reviewedAt?.toISOString() || null,
    matchCandidates: row.matchCandidates.map((candidate) => ({
      id: candidate.id,
      statementRowId: candidate.statementRowId,
      ledgerEntryId: candidate.ledgerEntryId || '',
      paymentId: candidate.paymentId || '',
      candidateRank: candidate.candidateRank,
      totalScore: candidate.totalScore,
      amountScore: candidate.amountScore,
      directionScore: candidate.directionScore,
      dateScore: candidate.dateScore,
      referenceScore: candidate.referenceScore,
      narrationScore: candidate.narrationScore,
      balanceScore: candidate.balanceScore,
      decision: candidate.decision as BankStatementMatchCandidate['decision'],
      reason: candidate.reason || candidate.ledgerEntry?.note || null,
      reasonJson: candidate.reasonJson || null,
      isReserved: candidate.isReserved
    }))
  }))

  return {
    batch: serializeBankStatementBatch(batch),
    rows: normalizedRows
  }
}
