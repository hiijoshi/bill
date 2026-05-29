import { Suspense } from 'react'
import { prisma } from '@/lib/prisma'
import { normalizeAppRole } from '@/lib/api-security'
import { mapSalesBillToPrintData } from '@/lib/sales-print'
import { listSalesAdditionalChargesByBillIds } from '@/lib/sales-additional-charge-store'
import { getSession } from '@/lib/session'
import { ensureSalesItemSchema } from '@/lib/sales-item-schema'
import { isPrismaSchemaMismatchError } from '@/lib/prisma-schema-guard'
import SalesPrintClient from './SalesPrintClient'

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ companyId?: string }>
}

type SalesPermission = {
  module: string
  canRead: boolean
  canWrite: boolean
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

  if (!billTraderId || userTraderId !== billTraderId) return false

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

export default async function SalesPrintPage({ params, searchParams }: PageProps) {
  try {
    await ensureSalesItemSchema(prisma)
    const { id } = await params
    const query = await searchParams
    const companyIdParam = typeof query.companyId === 'string' && query.companyId.trim() ? query.companyId.trim() : null

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

    const bill = await prisma.salesBill.findFirst({
      where: {
        OR: [{ id }, { billNo: id }],
        ...(companyIdParam ? { companyId: companyIdParam } : {})
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
            mandiAccountNumber: true,
            traderId: true,
            banks: {
              where: {
                isActive: true
              },
              select: {
                name: true,
                branch: true,
                ifscCode: true,
                accountNumber: true
              },
              orderBy: [
                { name: 'asc' },
                { createdAt: 'asc' }
              ],
              take: 1
            }
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

    if (!bill || !bill.company?.traderId) {
      return <div className="p-6 text-red-600">Sales bill not found</div>
    }

    const permissions =
      role === 'super_admin'
        ? []
        : await prisma.userPermission.findMany({
            where: {
              userId: user.id,
              companyId: bill.companyId,
              module: { in: ['SALES_LIST', 'SALES_ENTRY'] }
            },
            select: {
              module: true,
              canRead: true,
              canWrite: true
            }
          })

    const allowed = hasSalesBillAccess(role, user.traderId, bill.company.traderId, permissions)

    if (!allowed) {
      return <div className="p-6 text-red-600">Insufficient privileges</div>
    }

    const additionalChargesMap = await listSalesAdditionalChargesByBillIds(prisma, [bill.id])
    const printData = mapSalesBillToPrintData({
      ...bill,
      additionalCharges: additionalChargesMap.get(bill.id) || [],
    })
    return (
      <Suspense fallback={<div className="p-6">Loading print preview...</div>}>
        <SalesPrintClient printData={printData} />
      </Suspense>
    )
  } catch (error) {
    console.error('Sales print render failed:', error)
    if (isPrismaSchemaMismatchError(error)) {
      return (
        <div className="p-6 text-red-600">
          Database schema mismatch. Run: npm run prisma:migrate:deploy && npx prisma generate
        </div>
      )
    }
    return <div className="p-6 text-red-600">Unable to render sales print right now</div>
  }
}
