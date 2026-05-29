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

type SalesPermission = {
  module: string
  canRead: boolean
  canWrite: boolean
}

function toStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter(Boolean)
  }
  return value ? [value] : []
}

function hasSalesBillAccess(
  role: string,
  userTraderId: string,
  billTraderId: string | null,
  permissions: SalesPermission[]
): boolean {
  if (role === 'super_admin') {
    return true
  }

  if (!billTraderId || userTraderId !== billTraderId) {
    return false
  }

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

async function loadSalesPermissionsByCompany(userId: string, companyId: string): Promise<SalesPermission[]> {
  return prisma.userPermission.findMany({
    where: {
      userId,
      companyId,
      module: { in: ['SALES_LIST', 'SALES_ENTRY'] }
    },
    select: {
      module: true,
      canRead: true,
      canWrite: true
    }
  })
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
  const role = normalizeAppRole(user.role)

  const bills = await prisma.salesBill.findMany({
    where: {
      id: { in: selectedIds },
      ...(companyId ? { companyId } : {})
    },
    include: {
      parentSalesBill: {
        select: {
          id: true,
          billNo: true
        }
      },
      childSalesBills: {
        select: {
          id: true,
          billNo: true,
          totalAmount: true,
          status: true,
          splitPartLabel: true,
          splitSuffix: true
        },
        orderBy: {
          splitSequence: 'asc'
        }
      },
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
  const permissionsByCompanyId = new Map<string, SalesPermission[]>()

  for (const billId of selectedIds) {
    const bill = billMap.get(billId)
    if (!bill) {
      skippedCount += 1
      continue
    }

    let permissions: SalesPermission[] = []
    if (role !== 'super_admin') {
      const cachedPermissions = permissionsByCompanyId.get(bill.companyId)
      if (cachedPermissions) {
        permissions = cachedPermissions
      } else {
        const loadedPermissions = await loadSalesPermissionsByCompany(user.id, bill.companyId)
        permissionsByCompanyId.set(bill.companyId, loadedPermissions)
        permissions = loadedPermissions
      }
    }

    const allowed = hasSalesBillAccess(role, user.traderId, bill.company.traderId, permissions)

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
