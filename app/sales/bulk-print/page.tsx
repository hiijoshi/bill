import { prisma } from '@/lib/prisma'
import { normalizeAppRole } from '@/lib/api-security'
import { mapSalesBillToPrintData, type SalesBillPrintData } from '@/lib/sales-print'
import { listSalesAdditionalChargesByBillIds } from '@/lib/sales-additional-charge-store'
import { getSession } from '@/lib/session'

import SalesBulkPrintClient from './SalesBulkPrintClient'

type PageProps = {
  searchParams: Promise<{
    selected?: string | string[]
    type?: string
    companyId?: string
  }>
}

function toStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter(Boolean)
  }
  return value ? [value] : []
}

async function canViewSalesBill(
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

  if (!billTraderId || user.traderId !== billTraderId) {
    return false
  }

  const permissions = await prisma.userPermission.findMany({
    where: {
      userId: user.id,
      companyId: billCompanyId,
      module: { in: ['SALES_LIST', 'SALES_ENTRY'] }
    },
    select: {
      module: true,
      canRead: true,
      canWrite: true
    }
  })

  const hasSalesListRead = permissions.some((permission) => {
    if (permission.module !== 'SALES_LIST') return false
    return permission.canRead || permission.canWrite
  })

  const hasSalesEntryWrite = permissions.some((permission) => {
    if (permission.module !== 'SALES_ENTRY') return false
    return permission.canWrite
  })

  return hasSalesListRead || hasSalesEntryWrite
}

export default async function SalesBulkPrintPage({ searchParams }: PageProps) {
  const params = await searchParams
  const companyId = typeof params.companyId === 'string' ? params.companyId : ''
  const selectedIds = Array.from(new Set(toStringArray(params.selected).map((value) => value.trim()).filter(Boolean)))
  const printType = params.type === 'dispatch' ? 'dispatch' : 'invoice'

  if (selectedIds.length === 0) {
    return <div className="p-6 text-red-600">No sales bills selected for bulk print</div>
  }

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

  const bills = await prisma.salesBill.findMany({
    where: {
      id: { in: selectedIds }
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          traderId: true
        }
      },
      party: true,
      salesItems: {
        include: {
          product: true
        }
      },
      transportBills: true
    }
  })

  const billMap = new Map(bills.map((bill) => [bill.id, bill]))
  const additionalChargesMap = await listSalesAdditionalChargesByBillIds(prisma, bills.map((bill) => bill.id))
  const allowedBills: SalesBillPrintData[] = []
  let skippedCount = 0

  for (const billId of selectedIds) {
    const bill = billMap.get(billId)
    if (!bill) {
      skippedCount += 1
      continue
    }

    const allowed = await canViewSalesBill(
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
      skippedCount += 1
      continue
    }

    allowedBills.push(
      mapSalesBillToPrintData({
        ...bill,
        additionalCharges: additionalChargesMap.get(bill.id) || [],
      })
    )
  }

  if (allowedBills.length === 0) {
    return <div className="p-6 text-red-600">No sales bills available for bulk print</div>
  }

  return (
    <SalesBulkPrintClient
      bills={allowedBills}
      companyId={companyId}
      printType={printType}
      skippedCount={skippedCount}
    />
  )
}
