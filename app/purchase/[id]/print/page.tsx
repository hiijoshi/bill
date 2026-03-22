import { prisma } from '@/lib/prisma'
import { normalizeAppRole } from '@/lib/api-security'
import { mapPurchaseBillToPrintData } from '@/lib/purchase-print'
import { getSession } from '@/lib/session'
import PurchasePrintClient from './PurchasePrintClient'

type PageProps = {
  params: Promise<{ id: string }>
}

async function canViewPurchaseBill(user: {
  id: string
  traderId: string
  role: string | null
  companyId: string | null
}, billCompanyId: string, billTraderId: string | null): Promise<boolean> {
  const role = normalizeAppRole(user.role)

  if (role === 'super_admin') {
    return true
  }

  if (role === 'trader_admin') {
    if (!billTraderId || user.traderId !== billTraderId) return false
  } else {
    if (!billTraderId || user.traderId !== billTraderId) return false
  }

  const permissions = await prisma.userPermission.findMany({
    where: {
      userId: user.id,
      companyId: billCompanyId,
      module: { in: ['PURCHASE_LIST', 'PURCHASE_ENTRY'] }
    },
    select: {
      module: true,
      canRead: true,
      canWrite: true
    }
  })

  const hasPurchaseListRead = permissions.some((permission) => {
    if (permission.module !== 'PURCHASE_LIST') return false
    return permission.canRead || permission.canWrite
  })

  const hasPurchaseEntryWrite = permissions.some((permission) => {
    if (permission.module !== 'PURCHASE_ENTRY') return false
    return permission.canWrite
  })

  return hasPurchaseListRead || hasPurchaseEntryWrite
}

export default async function PurchasePrintPage({ params }: PageProps) {
  const { id } = await params

  const payload = await getSession()
  if (!payload?.userId || !payload?.traderId) {
    return <div className="p-6 text-red-600">Authentication required</div>
  }

  const user = await prisma.user.findFirst({
    where: {
      userId: payload.userId,
      traderId: payload.traderId,
      deletedAt: null
    },
    select: {
      id: true,
      traderId: true,
      role: true,
      companyId: true,
      locked: true,
      trader: {
        select: {
          id: true,
          locked: true,
          deletedAt: true
        }
      },
      company: {
        select: {
          id: true,
          locked: true,
          deletedAt: true
        }
      }
    }
  })

  if (!user) {
    return <div className="p-6 text-red-600">Invalid session user</div>
  }

  if (user.locked || user.trader?.locked || user.trader?.deletedAt) {
    return <div className="p-6 text-red-600">Account is locked or inactive</div>
  }

  const bill = await prisma.purchaseBill.findFirst({
    where: {
      id
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          traderId: true,
          mandiAccountNumber: true
        }
      },
      farmer: true,
      purchaseItems: {
        include: {
          product: true
        }
      }
    }
  })

  if (!bill) {
    return <div className="p-6 text-red-600">Purchase bill not found</div>
  }

  const allowed = await canViewPurchaseBill(
    {
      id: user.id,
      traderId: user.traderId,
      role: user.role,
      companyId: user.companyId
    },
    bill.companyId,
    bill.company.traderId
  )

  if (!allowed) {
    return <div className="p-6 text-red-600">Insufficient privileges</div>
  }

  const printData = mapPurchaseBillToPrintData(bill)
  return <PurchasePrintClient printData={printData} />
}
