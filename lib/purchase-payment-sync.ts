import type { Prisma, PrismaClient } from '@prisma/client'

export type PurchasePaymentTargetKind = 'regular' | 'special'

type PurchasePaymentDbClient = Prisma.TransactionClient | PrismaClient

export type PurchasePaymentTarget = {
  kind: PurchasePaymentTargetKind
  id: string
  billDate: Date
  totalAmount: number
  paidAmount: number
  billNo: string
  partyName: string
  farmerId: string | null
}

export function derivePurchasePaymentStatus(
  totalAmount: number,
  paidAmount: number
): 'unpaid' | 'partial' | 'paid' {
  const safeTotal = Math.max(0, Number(totalAmount || 0))
  const safePaid = Math.max(0, Number(paidAmount || 0))
  const balance = Math.max(0, safeTotal - safePaid)

  if (balance === 0 && safeTotal > 0) return 'paid'
  if (safePaid <= 0) return 'unpaid'
  return 'partial'
}

export function buildPurchasePaymentSyncNote(kind: PurchasePaymentTargetKind): string {
  return kind === 'special'
    ? 'Synced from special purchase bill paid amount'
    : 'Synced from purchase bill paid amount'
}

export async function findPurchasePaymentTarget(
  db: PurchasePaymentDbClient,
  companyId: string,
  billId: string
): Promise<PurchasePaymentTarget | null> {
  const purchaseBill = await db.purchaseBill.findFirst({
    where: { id: billId, companyId },
    select: {
      id: true,
      billDate: true,
      billNo: true,
      totalAmount: true,
      paidAmount: true,
      farmerId: true,
      farmer: {
        select: {
          name: true
        }
      }
    }
  })

  if (purchaseBill) {
    return {
      kind: 'regular',
      id: purchaseBill.id,
      billDate: purchaseBill.billDate,
      totalAmount: Number(purchaseBill.totalAmount || 0),
      paidAmount: Number(purchaseBill.paidAmount || 0),
      billNo: purchaseBill.billNo || '',
      partyName: purchaseBill.farmer?.name || '',
      farmerId: purchaseBill.farmerId || null
    }
  }

  const specialPurchaseBill = await db.specialPurchaseBill.findFirst({
    where: { id: billId, companyId },
    select: {
      id: true,
      billDate: true,
      supplierInvoiceNo: true,
      totalAmount: true,
      paidAmount: true,
      supplier: {
        select: {
          name: true
        }
      }
    }
  })

  if (!specialPurchaseBill) {
    return null
  }

  return {
    kind: 'special',
    id: specialPurchaseBill.id,
    billDate: specialPurchaseBill.billDate,
    totalAmount: Number(specialPurchaseBill.totalAmount || 0),
    paidAmount: Number(specialPurchaseBill.paidAmount || 0),
    billNo: specialPurchaseBill.supplierInvoiceNo || '',
    partyName: specialPurchaseBill.supplier?.name || '',
    farmerId: null
  }
}

export async function updatePurchasePaymentTargetTotals(
  db: PurchasePaymentDbClient,
  target: Pick<PurchasePaymentTarget, 'kind' | 'id' | 'totalAmount'>,
  paidAmount: number
) {
  const safePaidAmount = Math.max(0, Number(paidAmount || 0))
  const balanceAmount = Math.max(0, Number(target.totalAmount || 0) - safePaidAmount)
  const status = derivePurchasePaymentStatus(target.totalAmount, safePaidAmount)

  if (target.kind === 'special') {
    await db.specialPurchaseBill.update({
      where: { id: target.id },
      data: {
        paidAmount: safePaidAmount,
        balanceAmount,
        status
      }
    })
    return
  }

  await db.purchaseBill.update({
    where: { id: target.id },
    data: {
      paidAmount: safePaidAmount,
      balanceAmount,
      status
    }
  })
}
