import { prisma } from '@/lib/prisma'
import { PERMISSION_MODULES, PERMISSION_MODULE_LABELS } from '@/lib/permissions'
import { getSuperAdminLiveUpdate } from '@/lib/live-update-state'
import { getOrSetServerCache, makeServerCacheKey } from '@/lib/server-cache'
import { getConnectedUserCountsForCompanies, getLinkedCompaniesForUser } from '@/lib/super-admin-user-companies'
import { getSuperAdminClosureQueue } from '@/lib/super-admin-subscription-data'

type SuperAdminOverviewParams = {
  traderId?: string | null
  companyId?: string | null
  userId?: string | null
  includeDeleted?: boolean
  sections?: SuperAdminOverviewSection[] | null
}

export type SuperAdminOverviewSection =
  | 'stats'
  | 'traders'
  | 'companies'
  | 'users'
  | 'closureQueue'
  | 'permissionPreview'

const SUPER_ADMIN_OVERVIEW_CACHE_TTL_MS = 15_000

function normalizeId(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

async function loadSuperAdminStats(includeDeleted: boolean, liveUpdateVersion: number) {
  return getOrSetServerCache(
    makeServerCacheKey('super-admin-overview:stats', [includeDeleted, liveUpdateVersion]),
    SUPER_ADMIN_OVERVIEW_CACHE_TTL_MS,
    async () => {
      const [traders, companies, users] = await Promise.all([
        prisma.trader.count({ where: includeDeleted ? undefined : { deletedAt: null } }),
        prisma.company.count({ where: includeDeleted ? undefined : { deletedAt: null } }),
        prisma.user.count({
          where: {
            ...(includeDeleted ? {} : { deletedAt: null }),
            NOT: [{ role: 'SUPER_ADMIN' }, { role: 'super_admin' }]
          }
        })
      ])

      return { traders, companies, users }
    }
  )
}

async function loadSuperAdminTraders(includeDeleted: boolean, liveUpdateVersion: number) {
  return getOrSetServerCache(
    makeServerCacheKey('super-admin-overview:traders', [includeDeleted, liveUpdateVersion]),
    SUPER_ADMIN_OVERVIEW_CACHE_TTL_MS,
    () =>
      prisma.trader.findMany({
        where: includeDeleted ? undefined : { deletedAt: null },
        select: {
          id: true,
          name: true,
          locked: true,
          _count: {
            select: {
              companies: includeDeleted ? true : { where: { deletedAt: null } },
              users: includeDeleted ? true : { where: { deletedAt: null } }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      })
  )
}

async function resolveSuperAdminCompanyScope(args: {
  companyId: string
  traderId: string | null
  includeDeleted: boolean
  liveUpdateVersion: number
}) {
  return getOrSetServerCache(
    makeServerCacheKey('super-admin-overview:company-scope', [
      args.companyId,
      args.traderId,
      args.includeDeleted,
      args.liveUpdateVersion
    ]),
    SUPER_ADMIN_OVERVIEW_CACHE_TTL_MS,
    async () => {
      const scopedCompany = await prisma.company.findFirst({
        where: {
          id: args.companyId,
          ...(args.includeDeleted ? {} : { deletedAt: null })
        },
        select: {
          id: true,
          traderId: true
        }
      })

      if (!scopedCompany) {
        return null
      }

      if (args.traderId && scopedCompany.traderId && scopedCompany.traderId !== args.traderId) {
        return null
      }

      return scopedCompany
    }
  )
}

async function loadSuperAdminCompanies(args: {
  traderId: string
  includeDeleted: boolean
  liveUpdateVersion: number
}) {
  return getOrSetServerCache(
    makeServerCacheKey('super-admin-overview:companies', [
      args.traderId,
      args.includeDeleted,
      args.liveUpdateVersion
    ]),
    SUPER_ADMIN_OVERVIEW_CACHE_TTL_MS,
    async () => {
      const companyRows = await prisma.company.findMany({
        where: {
          ...(args.includeDeleted ? {} : { deletedAt: null }),
          traderId: args.traderId
        },
        select: {
          id: true,
          name: true,
          traderId: true,
          locked: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      })

      const connectedUserCounts = await getConnectedUserCountsForCompanies(prisma, {
        companyIds: companyRows.map((company) => company.id),
        traderId: args.traderId,
        includeDeletedUsers: args.includeDeleted
      })

      return companyRows.map((company) => ({
        id: company.id,
        name: company.name,
        traderId: company.traderId,
        locked: company.locked,
        _count: {
          users: connectedUserCounts[company.id] ?? 0
        }
      }))
    }
  )
}

async function loadSuperAdminUsers(args: {
  companyId: string
  traderId: string | null
  includeDeleted: boolean
  liveUpdateVersion: number
}) {
  return getOrSetServerCache(
    makeServerCacheKey('super-admin-overview:users', [
      args.companyId,
      args.traderId,
      args.includeDeleted,
      args.liveUpdateVersion
    ]),
    SUPER_ADMIN_OVERVIEW_CACHE_TTL_MS,
    async () => {
      const rows = await prisma.user.findMany({
        where: {
          ...(args.includeDeleted ? {} : { deletedAt: null }),
          ...(args.traderId ? { traderId: args.traderId } : {}),
          OR: [
            { companyId: args.companyId },
            {
              permissions: {
                some: {
                  companyId: args.companyId
                }
              }
            }
          ],
          NOT: [{ role: 'SUPER_ADMIN' }, { role: 'super_admin' }]
        },
        select: {
          id: true,
          userId: true,
          name: true,
          role: true,
          companyId: true,
          locked: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      })

      return rows.map((user) => ({
        ...user,
        active: !user.locked
      }))
    }
  )
}

async function loadSuperAdminPermissionPreview(args: {
  userId: string
  requestedCompanyId: string | null
  includeDeleted: boolean
  liveUpdateVersion: number
}) {
  return getOrSetServerCache(
    makeServerCacheKey('super-admin-overview:permission-preview', [
      args.userId,
      args.requestedCompanyId,
      args.includeDeleted,
      args.liveUpdateVersion
    ]),
    SUPER_ADMIN_OVERVIEW_CACHE_TTL_MS,
    async () => {
      const user = await prisma.user.findFirst({
        where: {
          id: args.userId,
          ...(args.includeDeleted ? {} : { deletedAt: null })
        },
        select: {
          id: true,
          userId: true,
          name: true,
          role: true,
          traderId: true,
          companyId: true
        }
      })

      if (!user || String(user.role || '').toLowerCase().replace(/\s+/g, '_') === 'super_admin') {
        return null
      }

      const companyOptions = await getLinkedCompaniesForUser(prisma, {
        userId: user.id,
        traderId: user.traderId,
        primaryCompanyId: user.companyId
      })
      const selectedCompanyId =
        (args.requestedCompanyId && companyOptions.some((company) => company.id === args.requestedCompanyId)
          ? args.requestedCompanyId
          : null) ||
        user.companyId ||
        companyOptions[0]?.id ||
        null

      if (!selectedCompanyId) {
        return null
      }

      const rows = await prisma.userPermission.findMany({
        where: {
          userId: user.id,
          companyId: selectedCompanyId
        },
        select: {
          module: true,
          canRead: true,
          canWrite: true
        }
      })

      const permissionMap = new Map(rows.map((row) => [row.module, row]))
      return {
        companyId: selectedCompanyId,
        companyOptions,
        permissions: PERMISSION_MODULES.map((module) => ({
          module,
          label: PERMISSION_MODULE_LABELS[module],
          canRead: permissionMap.get(module)?.canRead || false,
          canWrite: permissionMap.get(module)?.canWrite || false
        }))
      }
    }
  )
}

async function loadSuperAdminClosureQueue(liveUpdateVersion: number) {
  return getOrSetServerCache(
    makeServerCacheKey('super-admin-overview:closure-queue', [liveUpdateVersion]),
    SUPER_ADMIN_OVERVIEW_CACHE_TTL_MS,
    async () => {
      const result = await getSuperAdminClosureQueue(prisma, { limit: 6 })
      return {
        schemaReady: result.schemaReady,
        schemaWarning: result.schemaWarning,
        summary: result.summary,
        rows: result.rows
      }
    }
  )
}

export async function loadSuperAdminOverviewData(params: SuperAdminOverviewParams = {}) {
  const includeDeleted = params.includeDeleted === true
  const traderId = normalizeId(params.traderId)
  let companyId = normalizeId(params.companyId)
  const userId = normalizeId(params.userId)
  const liveUpdateVersion = getSuperAdminLiveUpdate()
  const sections = Array.isArray(params.sections) && params.sections.length > 0
    ? new Set(params.sections)
    : new Set<SuperAdminOverviewSection>(['stats', 'traders', 'companies', 'users', 'permissionPreview'])
  const includeStats = sections.has('stats')
  const includeTraders = sections.has('traders')
  const includeCompanies = sections.has('companies')
  const includeUsers = sections.has('users')
  const includeClosureQueue = sections.has('closureQueue')
  const includePermissionPreview = sections.has('permissionPreview')

  const statsPromise = includeStats
    ? loadSuperAdminStats(includeDeleted, liveUpdateVersion)
    : Promise.resolve(null)

  const tradersPromise = includeTraders
    ? loadSuperAdminTraders(includeDeleted, liveUpdateVersion)
    : Promise.resolve([])
  const closureQueuePromise = includeClosureQueue
    ? loadSuperAdminClosureQueue(liveUpdateVersion)
    : Promise.resolve(null)

  const [stats, traders, closureQueue] = await Promise.all([statsPromise, tradersPromise, closureQueuePromise])

  let companies: Array<{
    id: string
    name: string
    traderId: string | null
    locked: boolean
    _count: {
      users: number
    }
  }> = []
  let users: Array<{
    id: string
    userId: string
    name?: string | null
    role?: string | null
    companyId?: string | null
    locked: boolean
    active: boolean
  }> = []
  let permissionPreview: {
    companyId: string
    companyOptions: Array<{ id: string; name: string; locked: boolean; isPrimary: boolean }>
    permissions: Array<{ module: string; label: string; canRead: boolean; canWrite: boolean }>
  } | null = null

  const scopedCompany =
    companyId && (includeCompanies || includeUsers || includePermissionPreview)
      ? await resolveSuperAdminCompanyScope({
          companyId,
          traderId,
          includeDeleted,
          liveUpdateVersion
        })
      : null

  if (companyId && !scopedCompany) {
    companyId = null
  }

  const shouldResolveTraderId = includeCompanies || includeUsers || includePermissionPreview
  const resolvedTraderId = shouldResolveTraderId
    ? traderId || scopedCompany?.traderId || null
    : null

  const [nextCompanies, nextUsers, nextPermissionPreview] = await Promise.all([
    includeCompanies && resolvedTraderId
      ? loadSuperAdminCompanies({
          traderId: resolvedTraderId,
          includeDeleted,
          liveUpdateVersion
        })
      : Promise.resolve(companies),
    includeUsers && companyId
      ? loadSuperAdminUsers({
          companyId,
          traderId: resolvedTraderId,
          includeDeleted,
          liveUpdateVersion
        })
      : Promise.resolve(users),
    includePermissionPreview && userId
      ? loadSuperAdminPermissionPreview({
          userId,
          requestedCompanyId: companyId,
          includeDeleted,
          liveUpdateVersion
        })
      : Promise.resolve(permissionPreview)
  ])

  companies = nextCompanies
  users = nextUsers
  permissionPreview = nextPermissionPreview

  return {
    ...(includeStats && stats
      ? {
          stats
        }
      : {}),
    ...(includeTraders
      ? {
          traders
        }
      : {}),
    ...(includeCompanies
      ? {
          companies
        }
      : {}),
    ...(includeUsers
      ? {
          users
        }
      : {}),
    ...(includeClosureQueue && closureQueue
      ? {
          closureQueue
        }
      : {}),
    ...(includePermissionPreview
      ? {
          permissionPreview
        }
      : {})
  }
}
