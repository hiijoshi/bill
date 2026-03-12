import { cookies } from 'next/headers'

import { verifyToken } from '@/lib/auth'
import { normalizeAppRole } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { mapSpecialPurchaseBillToPrintData } from '@/lib/special-purchase-print'

import SpecialPurchasePrintClient from './SpecialPurchasePrintClient'

type PageProps = {
  params: Promise<{ id: string }>
}

async function canViewSpecialPurchaseBill(
  user: {
    id: string
    traderId: string
    role: string | null
    companyId: string | null
  },
  billCompanyId: string,
  billTraderId: string | null
): Promise<boolean> {
  const role = normalizeAppRole(user.role)

  if (role === 'super_admin') {
    return true
  }

  if (role === 'trader_admin') {
    if (!billTraderId || user.traderId !== billTraderId) return false
  } else {
    if (!user.companyId || user.companyId !== billCompanyId) return false
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

export default async function SpecialPurchasePrintPage({ params }: PageProps) {
  const { id } = await params

  const cookieStore = await cookies()
  const token = cookieStore.get('auth-token')?.value
  if (!token) {
    return <div className="p-6 text-red-600">Authentication required</div>
  }

  const payload = verifyToken(token)
  if (!payload?.userId || !payload?.traderId) {
    return <div className="p-6 text-red-600">Invalid session</div>
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

  if (user.locked || user.trader?.locked || user.trader?.deletedAt || user.company?.locked || user.company?.deletedAt) {
    return <div className="p-6 text-red-600">Account is locked or inactive</div>
  }

  const bill = await prisma.specialPurchaseBill.findFirst({
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
      supplier: true,
      specialPurchaseItems: {
        include: {
          product: true
        }
      }
    }
  })

  if (!bill) {
    return <div className="p-6 text-red-600">Special purchase bill not found</div>
  }

  const allowed = await canViewSpecialPurchaseBill(
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

  const printData = mapSpecialPurchaseBillToPrintData(bill)
  return <SpecialPurchasePrintClient printData={printData} />
}
