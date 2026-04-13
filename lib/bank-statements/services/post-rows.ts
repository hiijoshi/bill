import type { RequestAuthContext } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { logBankStatementEvent } from '../audit'
import { BankStatementError } from '../errors'
import { buildCashBankPaymentReference } from '@/lib/payment-entry-types'
import { resolveBankStatementActorUser } from '../security/require-bank-statement-access'

function normalizeVoucherType(value: string | null | undefined, direction: 'debit' | 'credit') {
  if (value === 'journal') return 'journal' as const
  if (value === 'cash_bank_payment' || value === 'cash_bank_receipt') return value
  return direction === 'debit' ? 'cash_bank_payment' as const : 'cash_bank_receipt' as const
}

export async function postBankStatementRows(input: {
  auth: RequestAuthContext
  companyId: string
  batchId: string
  rowIds: string[]
}) {
  const actorUser = await resolveBankStatementActorUser(input.auth)
  const rows = await prisma.bankStatementRow.findMany({
    where: {
      companyId: input.companyId,
      uploadBatchId: input.batchId,
      id: { in: input.rowIds }
    },
    include: {
      batch: {
        include: { bank: true }
      }
    }
  })

  if (rows.length !== input.rowIds.length) {
    throw new BankStatementError('ROW_NOT_FOUND', 'One or more bank statement rows were not found.', { status: 404 })
  }

  const headIds = Array.from(new Set(rows.map((row) => row.draftAccountingHeadId).filter(Boolean) as string[]))
  const partyIds = Array.from(new Set(rows.map((row) => row.draftPartyId).filter(Boolean) as string[]))
  const supplierIds = Array.from(new Set(rows.map((row) => row.draftSupplierId).filter(Boolean) as string[]))
  const paymentModeIds = Array.from(new Set(rows.map((row) => row.draftPaymentMode).filter(Boolean) as string[]))

  const [heads, parties, suppliers, paymentModes] = await Promise.all([
    headIds.length ? prisma.accountingHead.findMany({ where: { companyId: input.companyId, id: { in: headIds } } }) : Promise.resolve([]),
    partyIds.length ? prisma.party.findMany({ where: { companyId: input.companyId, id: { in: partyIds } } }) : Promise.resolve([]),
    supplierIds.length ? prisma.supplier.findMany({ where: { companyId: input.companyId, id: { in: supplierIds } } }) : Promise.resolve([]),
    paymentModeIds.length ? prisma.paymentMode.findMany({ where: { companyId: input.companyId, id: { in: paymentModeIds } } }) : Promise.resolve([])
  ])

  const headMap = new Map(heads.map((row) => [row.id, row]))
  const partyMap = new Map(parties.map((row) => [row.id, row]))
  const supplierMap = new Map(suppliers.map((row) => [row.id, row]))
  const paymentModeMap = new Map(paymentModes.map((row) => [row.id, row]))

  const posted = await prisma.$transaction(async (tx) => {
    const results: Array<{ rowId: string; paymentId: string | null; ledgerEntryId: string | null }> = []

    for (const row of rows) {
      if (row.postedAt || row.postedPaymentId || row.postedLedgerEntryId || row.finalLinkId) {
        throw new BankStatementError('VALIDATION_FAILED', 'One or more selected rows are already posted or finalized.', { status: 409 })
      }

      const head = row.draftAccountingHeadId ? headMap.get(row.draftAccountingHeadId) || null : null
      const party = row.draftPartyId ? partyMap.get(row.draftPartyId) || null : null
      const supplier = row.draftSupplierId ? supplierMap.get(row.draftSupplierId) || null : null
      const paymentMode = row.draftPaymentMode ? paymentModeMap.get(row.draftPaymentMode) || null : null
      const voucherType = normalizeVoucherType(row.draftVoucherType, row.direction as 'debit' | 'credit')

      if (!head && !party && !supplier) {
        throw new BankStatementError('VALIDATION_FAILED', 'Every posted row needs an accounting head, party, or supplier mapping.', { status: 400 })
      }

      const referenceType = head ? 'accounting-head' : party ? 'party' : 'supplier'
      const referenceId = head?.id || party?.id || supplier?.id
      if (!referenceId) {
        throw new BankStatementError('VALIDATION_FAILED', 'Selected posting target is invalid.', { status: 400 })
      }

      let paymentId: string | null = null
      let ledgerEntryId: string | null = null
      const paymentModeName = paymentMode?.name || 'Bank'

      if (voucherType !== 'journal') {
        const payment = await tx.payment.create({
          data: {
            companyId: row.companyId,
            billType: voucherType,
            billId: buildCashBankPaymentReference(referenceType, referenceId),
            billDate: row.transactionDate ? new Date(row.transactionDate) : new Date(),
            payDate: row.transactionDate ? new Date(row.transactionDate) : new Date(),
            amount: row.amount,
            mode: paymentModeName,
            cashAmount: voucherType === 'cash_bank_payment' ? row.amount : null,
            cashPaymentDate: voucherType === 'cash_bank_payment' ? (row.transactionDate ? new Date(row.transactionDate) : new Date()) : null,
            onlinePayAmount: voucherType === 'cash_bank_receipt' ? row.amount : null,
            onlinePaymentDate: voucherType === 'cash_bank_receipt' ? (row.transactionDate ? new Date(row.transactionDate) : new Date()) : null,
            txnRef: row.referenceNumber,
            note: [row.description, row.draftRemarks].filter(Boolean).join(' | '),
            partyId: party?.id || null,
            bankNameSnapshot: row.batch.bank?.name || null,
            beneficiaryBankAccount: row.batch.bank?.accountNumber || null,
            ifscCode: row.batch.bank?.ifscCode || null,
            status: 'paid'
          }
        })
        paymentId = payment.id
      }

      const ledgerEntry = await tx.ledgerEntry.create({
        data: {
          companyId: row.companyId,
          entryDate: row.transactionDate ? new Date(row.transactionDate) : new Date(),
          billType: voucherType === 'journal' ? 'journal' : 'bank_statement_reconciliation',
          billId: paymentId || `recon:${row.id}`,
          direction: row.direction === 'credit' ? 'credit' : 'debit',
          amount: row.amount,
          partyId: party?.id || null,
          accountingHeadId: head?.id || null,
          accountHeadNameSnapshot: head?.name || null,
          counterpartyNameSnapshot: party?.name || supplier?.name || null,
          note: [row.description, row.referenceNumber, row.draftRemarks].filter(Boolean).join(' | ')
        }
      })
      ledgerEntryId = ledgerEntry.id

      const link = await tx.bankReconciliationLink.create({
        data: {
          companyId: row.companyId,
          bankId: row.bankId,
          statementBatchId: row.uploadBatchId,
          statementRowId: row.id,
          paymentId,
          ledgerEntryId,
          linkType: 'manual',
          confidence: row.matchConfidence ?? 100,
          reason: row.draftRemarks || 'Posted to ledger from unsettled reconciliation row.',
          createdByUserId: actorUser?.id || null
        }
      })

      await tx.bankStatementRow.update({
        where: { id: row.id },
        data: {
          matchStatus: 'settled',
          reviewStatus: 'manually_linked',
          matchedPaymentId: paymentId,
          matchedLedgerId: ledgerEntryId,
          postedPaymentId: paymentId,
          postedLedgerEntryId: ledgerEntryId,
          postedAt: new Date(),
          finalLinkId: link.id,
          matchConfidence: row.matchConfidence ?? 100,
          matchReason: row.draftRemarks || 'Posted to ledger from reconciliation workspace.',
          reviewedByUserId: actorUser?.id || null,
          reviewedAt: new Date()
        }
      })

      results.push({
        rowId: row.id,
        paymentId,
        ledgerEntryId
      })
    }

    const summaryRows = await tx.bankStatementRow.findMany({
      where: {
        uploadBatchId: input.batchId
      },
      select: { matchStatus: true }
    })

    await tx.bankStatementBatch.update({
      where: { id: input.batchId },
      data: {
        batchStatus: 'ready_for_review',
        settledRows: summaryRows.filter((row) => row.matchStatus === 'settled').length,
        unsettledRows: summaryRows.filter((row) => row.matchStatus === 'unsettled').length,
        ambiguousRows: summaryRows.filter((row) => row.matchStatus === 'ambiguous').length
      }
    })

    return results
  })

  if (rows[0]) {
    await logBankStatementEvent({
      batchId: rows[0].uploadBatchId,
      companyId: rows[0].companyId,
      actor: input.auth,
      eventType: 'row_reviewed',
      stage: 'post',
      note: 'Posted unsettled reconciliation rows to ERP ledger.',
      payload: {
        rowIds: posted.map((row) => row.rowId)
      }
    })
  }

  return posted
}
