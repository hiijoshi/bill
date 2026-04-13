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

function normalizeText(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreContains(haystack: string, needle: string) {
  if (!haystack || !needle) return 0
  if (haystack.includes(needle)) return Math.min(needle.length * 2, 24)
  const parts = needle.split(' ').filter((part) => part.length > 2)
  return parts.reduce((sum, part) => sum + (haystack.includes(part) ? 3 : 0), 0)
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

  const [heads, parties, suppliers] = await Promise.all([
    prisma.accountingHead.findMany({
      where: { companyId },
      select: { id: true, name: true, category: true }
    }),
    prisma.party.findMany({
      where: { companyId },
      select: { id: true, name: true, type: true }
    }),
    prisma.supplier.findMany({
      where: { companyId },
      select: { id: true, name: true }
    })
  ])

  const normalizedRows: Array<NormalizedStatementTransaction & { matchCandidates: BankStatementMatchCandidate[] }> = rows.map((row) => ({
    ...(() => {
      const descriptionText = normalizeText(row.description)
      const bestHead = heads
        .map((head) => ({
          id: head.id,
          score: scoreContains(descriptionText, normalizeText(head.name)) + scoreContains(descriptionText, normalizeText(head.category))
        }))
        .sort((left, right) => right.score - left.score)[0]
      const bestParty = parties
        .map((party) => ({
          id: party.id,
          score: scoreContains(descriptionText, normalizeText(party.name))
        }))
        .sort((left, right) => right.score - left.score)[0]
      const bestSupplier = suppliers
        .map((supplier) => ({
          id: supplier.id,
          score: scoreContains(descriptionText, normalizeText(supplier.name))
        }))
        .sort((left, right) => right.score - left.score)[0]

      const suggestedAccountingHeadId = row.draftAccountingHeadId || (bestHead && bestHead.score >= 8 ? bestHead.id : null)
      const suggestedPartyId = row.draftPartyId || (bestParty && bestParty.score >= 8 ? bestParty.id : null)
      const suggestedSupplierId = row.draftSupplierId || (!suggestedPartyId && bestSupplier && bestSupplier.score >= 8 ? bestSupplier.id : null)
      const suggestedVoucherType = (
        row.draftVoucherType ||
        (row.direction === 'credit' ? 'cash_bank_receipt' : 'cash_bank_payment')
      ) as NormalizedStatementTransaction['suggestedVoucherType']

      const suggestedReasonParts = [
        suggestedAccountingHeadId ? 'accounting head by narration' : null,
        suggestedPartyId ? 'party by narration' : null,
        suggestedSupplierId ? 'supplier by narration' : null
      ].filter(Boolean)

      return {
        suggestedAccountingHeadId,
        suggestedPartyId,
        suggestedSupplierId,
        suggestedVoucherType,
        suggestedReason: suggestedReasonParts.length > 0 ? suggestedReasonParts.join(', ') : null
      }
    })(),
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
