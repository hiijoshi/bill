import { prisma } from '@/lib/prisma'
import { normalizeAppRole } from '@/lib/api-security'
import { mapPurchaseBillToPrintData } from '@/lib/purchase-print'
import { mapSpecialPurchaseBillToPrintData } from '@/lib/special-purchase-print'
import { getSession } from '@/lib/session'

import PurchaseBulkPrintClient, { type PurchaseBulkPrintEntry } from './PurchaseBulkPrintClient'

type PageProps = {
  searchParams: Promise<{
    selected?: string | string[]
    companyId?: string
  }>
}

function toStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter(Boolean)
  }
  return value ? [value] : []
}

function parsePurchaseSelections(rawSelections: string[]): Array<{ key: string; type: 'regular' | 'special'; id: string }> {
  const seen = new Set<string>()
  const parsed: Array<{ key: string; type: 'regular' | 'special'; id: string }> = []

  for (const rawSelection of rawSelections) {
    const separatorIndex = rawSelection.indexOf(':')
    if (separatorIndex <= 0) continue

    const typeValue = rawSelection.slice(0, separatorIndex)
    const id = rawSelection.slice(separatorIndex + 1).trim()
    if (!id || (typeValue !== 'regular' && typeValue !== 'special')) continue

    const key = `${typeValue}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    parsed.push({ key, type: typeValue, id })
  }

  return parsed
}

async function canViewPurchaseModule(
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

export default async function PurchaseBulkPrintPage({ searchParams }: PageProps) {
  const params = await searchParams
  const companyId = typeof params.companyId === 'string' ? params.companyId : ''
  const selections = parsePurchaseSelections(toStringArray(params.selected))

  if (selections.length === 0) {
    return <div className="p-6 text-red-600">No purchase bills selected for bulk print</div>
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

  const regularIds = selections.filter((selection) => selection.type === 'regular').map((selection) => selection.id)
  const specialIds = selections.filter((selection) => selection.type === 'special').map((selection) => selection.id)

  const [regularBills, specialBills] = await Promise.all([
    regularIds.length > 0
      ? prisma.purchaseBill.findMany({
          where: {
            id: { in: regularIds }
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
      : Promise.resolve([]),
    specialIds.length > 0
      ? prisma.specialPurchaseBill.findMany({
          where: {
            id: { in: specialIds }
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
      : Promise.resolve([])
  ])

  const regularBillMap = new Map(regularBills.map((bill) => [bill.id, bill]))
  const specialBillMap = new Map(specialBills.map((bill) => [bill.id, bill]))

  const entries: PurchaseBulkPrintEntry[] = []
  let skippedCount = 0

  for (const selection of selections) {
    if (selection.type === 'regular') {
      const bill = regularBillMap.get(selection.id)
      if (!bill) {
        skippedCount += 1
        continue
      }

      const allowed = await canViewPurchaseModule(
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

      entries.push({
        key: selection.key,
        type: 'regular',
        printData: mapPurchaseBillToPrintData(bill)
      })
      continue
    }

    const bill = specialBillMap.get(selection.id)
    if (!bill) {
      skippedCount += 1
      continue
    }

    const allowed = await canViewPurchaseModule(
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

    entries.push({
      key: selection.key,
      type: 'special',
      printData: mapSpecialPurchaseBillToPrintData(bill)
    })
  }

  if (entries.length === 0) {
    return <div className="p-6 text-red-600">No purchase bills available for bulk print</div>
  }

  return <PurchaseBulkPrintClient entries={entries} companyId={companyId} skippedCount={skippedCount} />
}
