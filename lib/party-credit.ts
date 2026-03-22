import { prisma } from '@/lib/prisma'
import { normalizeNonNegative, roundCurrency } from '@/lib/billing-calculations'

export const DEFAULT_PARTY_CREDIT_DAYS = 30

export type PartyCreditSnapshot = {
  party: {
    id: string
    name: string
    phone1: string
    creditLimit: number | null
    creditDays: number
  }
  outstandingAmount: number
  overdueAmount: number
  pendingSaleAmount: number
  projectedOutstanding: number
  remainingLimit: number | null
  hasOverdue: boolean
  isOverLimit: boolean
  warning: boolean
}

type GetPartyCreditSnapshotArgs = {
  companyId: string
  partyId: string
  pendingSaleAmount?: number
  referenceDate?: Date
  excludeBillId?: string | null
}

export async function getPartyCreditSnapshot({
  companyId,
  partyId,
  pendingSaleAmount = 0,
  referenceDate = new Date(),
  excludeBillId,
}: GetPartyCreditSnapshotArgs): Promise<PartyCreditSnapshot | null> {
  const party = await prisma.party.findFirst({
    where: {
      id: partyId,
      companyId,
    },
    select: {
      id: true,
      name: true,
      phone1: true,
      creditLimit: true,
      creditDays: true,
    },
  })

  if (!party) {
    return null
  }

  const bills = await prisma.salesBill.findMany({
    where: {
      companyId,
      partyId,
      ...(excludeBillId ? { id: { not: excludeBillId } } : {}),
    },
    select: {
      billDate: true,
      balanceAmount: true,
    },
    orderBy: { billDate: 'asc' },
  })

  const today = new Date(referenceDate)
  today.setHours(0, 0, 0, 0)

  const creditDays = Math.max(
    0,
    Math.floor(Number(party.creditDays ?? DEFAULT_PARTY_CREDIT_DAYS))
  )

  const outstandingAmount = roundCurrency(
    bills.reduce((sum, bill) => sum + normalizeNonNegative(bill.balanceAmount), 0)
  )

  const overdueAmount = roundCurrency(
    bills.reduce((sum, bill) => {
      const balance = normalizeNonNegative(bill.balanceAmount)
      if (balance <= 0) return sum

      const dueDate = new Date(bill.billDate)
      dueDate.setHours(0, 0, 0, 0)
      dueDate.setDate(dueDate.getDate() + creditDays)

      return dueDate.getTime() < today.getTime() ? sum + balance : sum
    }, 0)
  )

  const normalizedPendingSaleAmount = roundCurrency(normalizeNonNegative(pendingSaleAmount))
  const creditLimit =
    party.creditLimit == null ? null : roundCurrency(normalizeNonNegative(party.creditLimit))
  const projectedOutstanding = roundCurrency(outstandingAmount + normalizedPendingSaleAmount)
  const remainingLimit =
    creditLimit == null ? null : roundCurrency(creditLimit - projectedOutstanding)
  const hasOverdue = overdueAmount > 0
  const isOverLimit = creditLimit != null && projectedOutstanding > creditLimit

  return {
    party: {
      id: party.id,
      name: party.name,
      phone1: party.phone1 || '',
      creditLimit,
      creditDays,
    },
    outstandingAmount,
    overdueAmount,
    pendingSaleAmount: normalizedPendingSaleAmount,
    projectedOutstanding,
    remainingLimit,
    hasOverdue,
    isOverLimit,
    warning: hasOverdue || isOverLimit,
  }
}
