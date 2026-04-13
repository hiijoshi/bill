import { prisma } from '@/lib/prisma'
import type { BankMovementCandidate } from './types'

function normalizeDirectionForPayment(payment: { billType: string }) {
  const type = String(payment.billType || '').toLowerCase()
  if (type.includes('sales') || type.includes('receipt')) return 'credit' as const
  return 'debit' as const
}

function normalizeDirectionForLedger(entry: { direction: string }) {
  return String(entry.direction || '').toLowerCase().includes('credit') ? 'credit' as const : 'debit' as const
}

export async function loadBankMovementCandidates(input: {
  companyId: string
  bankId: string | null
  statementDateFrom?: Date | null
  statementDateTo?: Date | null
}) {
  const bank = input.bankId
    ? await prisma.bank.findFirst({
        where: {
          id: input.bankId,
          companyId: input.companyId
        }
      })
    : null

  const [payments, ledgerEntries] = await Promise.all([
    prisma.payment.findMany({
      where: {
        companyId: input.companyId,
        deletedAt: null,
        mode: {
          in: ['bank', 'online', 'transfer']
        },
        ...(input.statementDateFrom || input.statementDateTo
          ? {
              payDate: {
                ...(input.statementDateFrom ? { gte: new Date(input.statementDateFrom.getTime() - 7 * 86_400_000) } : {}),
                ...(input.statementDateTo ? { lte: new Date(input.statementDateTo.getTime() + 7 * 86_400_000) } : {})
              }
            }
          : {})
      },
      include: {
        party: {
          select: { name: true }
        },
        farmer: {
          select: { name: true }
        },
        bankReconciliationLinks: {
          select: { id: true }
        }
      },
      orderBy: {
        payDate: 'asc'
      }
    }),
    prisma.ledgerEntry.findMany({
      where: {
        companyId: input.companyId,
        ...(input.statementDateFrom || input.statementDateTo
          ? {
              entryDate: {
                ...(input.statementDateFrom ? { gte: new Date(input.statementDateFrom.getTime() - 7 * 86_400_000) } : {}),
                ...(input.statementDateTo ? { lte: new Date(input.statementDateTo.getTime() + 7 * 86_400_000) } : {})
              }
            }
          : {})
      },
      include: {
        accountingHead: {
          select: { name: true }
        },
        party: {
          select: { name: true }
        },
        farmer: {
          select: { name: true }
        },
        bankReconciliationLinks: {
          select: { id: true }
        }
      },
      orderBy: {
        entryDate: 'asc'
      }
    })
  ])

  const normalizedBankName = String(bank?.name || '').trim().toLowerCase()
  const normalizedIfsc = String(bank?.ifscCode || '').trim().toLowerCase()
  const normalizedAccount = String(bank?.accountNumber || '').replace(/\s+/g, '').toLowerCase()

  const paymentCandidates = payments
    .filter((payment) => {
      if (!bank) return true

      const paymentBankName = String(payment.bankNameSnapshot || '').trim().toLowerCase()
      const paymentIfsc = String(payment.ifscCode || '').trim().toLowerCase()
      const paymentAccount = String(payment.beneficiaryBankAccount || '').replace(/\s+/g, '').toLowerCase()

      return Boolean(
        (normalizedBankName && paymentBankName && paymentBankName.includes(normalizedBankName)) ||
        (normalizedIfsc && paymentIfsc && paymentIfsc === normalizedIfsc) ||
        (normalizedAccount && paymentAccount && paymentAccount === normalizedAccount)
      )
    })
    .map<BankMovementCandidate>((payment) => ({
      paymentId: payment.id,
      ledgerEntryId: null,
      targetType: 'payment',
      companyId: payment.companyId,
      amount: payment.amount,
      payDate: payment.payDate,
      direction: normalizeDirectionForPayment(payment),
      referenceNumber: payment.txnRef || null,
      description: [
        payment.note,
        payment.bankNameSnapshot,
        payment.party?.name,
        payment.farmer?.name
      ].filter(Boolean).join(' | '),
      bankName: payment.bankNameSnapshot || null,
      accountNumber: payment.beneficiaryBankAccount || null,
      ifscCode: payment.ifscCode || null,
      counterpartyName: payment.party?.name || payment.farmer?.name || null
    }))

  const ledgerCandidates = ledgerEntries.map<BankMovementCandidate>((entry) => ({
    paymentId: null,
    ledgerEntryId: entry.id,
    targetType: 'ledger_entry',
    companyId: entry.companyId,
    amount: entry.amount,
    payDate: entry.entryDate,
    direction: normalizeDirectionForLedger(entry),
    referenceNumber: entry.billId || null,
    description: [
      entry.note,
      entry.accountingHead?.name,
      entry.accountHeadNameSnapshot,
      entry.counterpartyNameSnapshot,
      entry.party?.name,
      entry.farmer?.name
    ].filter(Boolean).join(' | '),
    bankName: null,
    accountNumber: null,
    ifscCode: null,
    counterpartyName: entry.counterpartyNameSnapshot || entry.party?.name || entry.farmer?.name || null
  }))

  return [...paymentCandidates, ...ledgerCandidates]
}
