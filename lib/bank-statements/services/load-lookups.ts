import { prisma } from '@/lib/prisma'
import type { BankStatementLookupPayload } from '../types'

export async function loadBankStatementLookups(companyId: string): Promise<BankStatementLookupPayload> {
  const [accountingHeads, parties, suppliers, paymentModes] = await Promise.all([
    prisma.accountingHead.findMany({
      where: { companyId },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, category: true }
    }),
    prisma.party.findMany({
      where: { companyId },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, type: true }
    }),
    prisma.supplier.findMany({
      where: { companyId },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, gstNumber: true }
    }),
    prisma.paymentMode.findMany({
      where: { companyId, isActive: true },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, code: true }
    })
  ])

  return {
    accountingHeads: accountingHeads.map((row) => ({
      id: row.id,
      label: row.name,
      meta: row.category
    })),
    parties: parties.map((row) => ({
      id: row.id,
      label: row.name,
      meta: row.type
    })),
    suppliers: suppliers.map((row) => ({
      id: row.id,
      label: row.name,
      meta: row.gstNumber || null
    })),
    paymentModes: paymentModes.map((row) => ({
      id: row.id,
      label: row.name,
      meta: row.code
    })),
    voucherTypes: [
      {
        value: 'cash_bank_payment',
        label: 'Cash / Bank Payment',
        direction: 'debit'
      },
      {
        value: 'cash_bank_receipt',
        label: 'Cash / Bank Receipt',
        direction: 'credit'
      },
      {
        value: 'journal',
        label: 'Journal Entry',
        direction: 'both'
      }
    ]
  }
}
