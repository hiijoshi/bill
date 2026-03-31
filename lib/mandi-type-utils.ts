import type { PrismaClient, Prisma } from '@prisma/client'

type MandiTypeClient = PrismaClient | Prisma.TransactionClient

export type MandiTypeUsage = {
  linkedPartyCount: number
  linkedFarmerCount: number
  linkedAccountingHeadCount: number
  linkedBillChargeCount: number
  totalLinkedCount: number
}

export function normalizeOptionalMandiTypeId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value === 'null' || value === 'undefined') return null
  return value
}

export async function assertMandiTypeBelongsToCompany(
  client: MandiTypeClient,
  companyId: string,
  mandiTypeId: string | null
): Promise<string | null> {
  if (!mandiTypeId) return null

  const mandiType = await client.mandiType.findFirst({
    where: {
      id: mandiTypeId,
      companyId
    },
    select: {
      id: true
    }
  })

  if (!mandiType) {
    throw new Error('Selected mandi type is invalid for this company')
  }

  return mandiType.id
}

export async function getMandiTypeUsageMap(
  client: MandiTypeClient,
  mandiTypeIds: string[]
): Promise<Map<string, MandiTypeUsage>> {
  const usageMap = new Map<string, MandiTypeUsage>()
  const validIds = Array.from(new Set(mandiTypeIds.map((value) => String(value || '').trim()).filter(Boolean)))
  if (validIds.length === 0) return usageMap

  const [partyGroups, farmerGroups, accountingHeadGroups, billChargeGroups] = await Promise.all([
    client.partyMandiProfile.groupBy({
      by: ['mandiTypeId'],
      where: {
        mandiTypeId: { in: validIds }
      },
      _count: {
        _all: true
      }
    }),
    client.farmerMandiProfile.groupBy({
      by: ['mandiTypeId'],
      where: {
        mandiTypeId: { in: validIds }
      },
      _count: {
        _all: true
      }
    }),
    client.accountingHeadMandiConfig.groupBy({
      by: ['mandiTypeId'],
      where: {
        mandiTypeId: { in: validIds }
      },
      _count: {
        _all: true
      }
    }),
    client.billCharge.groupBy({
      by: ['mandiTypeId'],
      where: {
        mandiTypeId: { in: validIds }
      },
      _count: {
        _all: true
      }
    })
  ])

  const ensureUsage = (mandiTypeId: string): MandiTypeUsage => {
    const existing = usageMap.get(mandiTypeId)
    if (existing) return existing
    const next: MandiTypeUsage = {
      linkedPartyCount: 0,
      linkedFarmerCount: 0,
      linkedAccountingHeadCount: 0,
      linkedBillChargeCount: 0,
      totalLinkedCount: 0
    }
    usageMap.set(mandiTypeId, next)
    return next
  }

  for (const row of partyGroups) {
    const mandiTypeId = String(row.mandiTypeId || '').trim()
    if (!mandiTypeId) continue
    ensureUsage(mandiTypeId).linkedPartyCount = row._count._all
  }

  for (const row of farmerGroups) {
    const mandiTypeId = String(row.mandiTypeId || '').trim()
    if (!mandiTypeId) continue
    ensureUsage(mandiTypeId).linkedFarmerCount = row._count._all
  }

  for (const row of accountingHeadGroups) {
    const mandiTypeId = String(row.mandiTypeId || '').trim()
    if (!mandiTypeId) continue
    ensureUsage(mandiTypeId).linkedAccountingHeadCount = row._count._all
  }

  for (const row of billChargeGroups) {
    const mandiTypeId = String(row.mandiTypeId || '').trim()
    if (!mandiTypeId) continue
    ensureUsage(mandiTypeId).linkedBillChargeCount = row._count._all
  }

  for (const usage of usageMap.values()) {
    usage.totalLinkedCount =
      usage.linkedPartyCount +
      usage.linkedFarmerCount +
      usage.linkedAccountingHeadCount +
      usage.linkedBillChargeCount
  }

  return usageMap
}

export function formatMandiTypeUsageMessage(name: string, usage: MandiTypeUsage): string {
  const parts: string[] = []
  if (usage.linkedPartyCount > 0) parts.push(`${usage.linkedPartyCount} parties`)
  if (usage.linkedFarmerCount > 0) parts.push(`${usage.linkedFarmerCount} farmers`)
  if (usage.linkedAccountingHeadCount > 0) parts.push(`${usage.linkedAccountingHeadCount} accounting heads`)
  if (usage.linkedBillChargeCount > 0) parts.push(`${usage.linkedBillChargeCount} bill charges`)

  if (parts.length === 0) {
    return `${name} is not linked anywhere.`
  }

  return `${name} is linked to ${parts.join(', ')}. Unlink it first.`
}
