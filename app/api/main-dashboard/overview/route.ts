import { NextRequest, NextResponse } from 'next/server'

import {
  filterCompanyIdsByRoutePermission,
  getAccessibleCompanies,
  normalizeId,
  normalizeAppRole,
  requireRoles
} from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { resolveSupabaseAppSession } from '@/lib/supabase/app-session'

type CacheEntry<T> = {
  data: T
  expiresAt: number
}

const serverCache = new Map<string, CacheEntry<unknown>>()
const pendingLoads = new Map<string, Promise<unknown>>()

function makeServerCacheKey(prefix: string, parts: unknown[]): string {
  return `${prefix}:${JSON.stringify(parts)}`
}

async function getOrSetServerCache<T>(
  key: string,
  maxAgeMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now()
  const cached = serverCache.get(key)
  if (cached && cached.expiresAt > now) {
    return cached.data as T
  }

  const pending = pendingLoads.get(key)
  if (pending) {
    return pending as Promise<T>
  }

  const nextLoad = loader()
    .then((data) => {
      serverCache.set(key, {
        data,
        expiresAt: Date.now() + maxAgeMs
      })
      pendingLoads.delete(key)
      return data
    })
    .catch((error) => {
      pendingLoads.delete(key)
      throw error
    })

  pendingLoads.set(key, nextLoad)
  return nextLoad
}

type OverviewSection =
  | 'purchaseBills'
  | 'salesBills'
  | 'payments'
  | 'products'
  | 'parties'
  | 'units'
  | 'stockLedger'

const OVERVIEW_SECTIONS: readonly OverviewSection[] = [
  'purchaseBills',
  'salesBills',
  'payments',
  'products',
  'parties',
  'units',
  'stockLedger'
]
const OVERVIEW_CACHE_TTL_MS = 15_000

const emptyOverviewPayload = {
  purchaseBills: [],
  salesBills: [],
  payments: [],
  products: [],
  parties: [],
  units: [],
  stockLedger: []
}

function parseOverviewIncludes(searchParams: URLSearchParams): Set<OverviewSection> {
  const rawValues = searchParams
    .getAll('include')
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean)

  if (rawValues.length === 0) {
    return new Set(OVERVIEW_SECTIONS)
  }

  const allowed = new Set<OverviewSection>(OVERVIEW_SECTIONS)
  const nextIncludes = new Set<OverviewSection>()
  for (const value of rawValues) {
    if (allowed.has(value as OverviewSection)) {
      nextIncludes.add(value as OverviewSection)
    }
  }

  return nextIncludes.size > 0 ? nextIncludes : new Set(OVERVIEW_SECTIONS)
}

async function getPermissionScopedCompanyIds(
  auth: Parameters<typeof getAccessibleCompanies>[0],
  request: NextRequest,
  targetCompanyIds: string[],
  pathname: string
) {
  if (targetCompanyIds.length === 0) return []
  return filterCompanyIdsByRoutePermission(auth, targetCompanyIds, pathname, request.method)
}

async function loadOverviewPayload(params: {
  includes: Set<OverviewSection>
  purchaseCompanyIds: string[]
  salesCompanyIds: string[]
  paymentCompanyIds: string[]
  productCompanyIds: string[]
  partyCompanyIds: string[]
  unitCompanyIds: string[]
  stockCompanyIds: string[]
}) {
  const purchaseBillsQuery =
    params.includes.has('purchaseBills') && params.purchaseCompanyIds.length > 0
      ? prisma.purchaseBill.findMany({
          where: { companyId: { in: params.purchaseCompanyIds } },
          select: {
            id: true,
            companyId: true,
            billNo: true,
            billDate: true,
            totalAmount: true,
            paidAmount: true,
            balanceAmount: true,
            status: true,
            farmer: {
              select: {
                name: true
              }
            }
          },
          orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
        })
      : Promise.resolve([])

  const salesBillsQuery =
    params.includes.has('salesBills') && params.salesCompanyIds.length > 0
      ? prisma.salesBill.findMany({
          where: { companyId: { in: params.salesCompanyIds } },
          select: {
            id: true,
            companyId: true,
            billNo: true,
            billDate: true,
            totalAmount: true,
            receivedAmount: true,
            balanceAmount: true,
            status: true,
            party: {
              select: {
                name: true
              }
            }
          },
          orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
        })
      : Promise.resolve([])

  const paymentsQuery =
    params.includes.has('payments') && params.paymentCompanyIds.length > 0
      ? prisma.payment.findMany({
          where: {
            companyId: { in: params.paymentCompanyIds },
            deletedAt: null
          },
          select: {
            id: true,
            companyId: true,
            billType: true,
            billId: true,
            amount: true,
            payDate: true,
            billDate: true,
            mode: true,
            status: true,
            txnRef: true,
            note: true,
            createdAt: true,
            party: {
              select: {
                name: true
              }
            },
            farmer: {
              select: {
                name: true
              }
            }
          },
          orderBy: [{ payDate: 'desc' }, { createdAt: 'desc' }]
        })
      : Promise.resolve([])

  const productsQuery =
    params.includes.has('products') && params.productCompanyIds.length > 0
      ? prisma.product.findMany({
          where: { companyId: { in: params.productCompanyIds } },
          select: {
            id: true,
            companyId: true,
            name: true,
            unit: {
              select: {
                symbol: true
              }
            }
          }
        })
      : Promise.resolve([])

  const partiesQuery =
    params.includes.has('parties') && params.partyCompanyIds.length > 0
      ? prisma.party.findMany({
          where: { companyId: { in: params.partyCompanyIds } },
          select: { id: true, companyId: true }
        })
      : Promise.resolve([])

  const unitsQuery =
    params.includes.has('units') && params.unitCompanyIds.length > 0
      ? prisma.unit.findMany({
          where: { companyId: { in: params.unitCompanyIds } },
          select: { id: true, companyId: true }
        })
      : Promise.resolve([])

  const stockLedgerQuery =
    params.includes.has('stockLedger') && params.stockCompanyIds.length > 0
      ? prisma.stockLedger.findMany({
          where: { companyId: { in: params.stockCompanyIds } },
          select: {
            id: true,
            companyId: true,
            entryDate: true,
            qtyIn: true,
            qtyOut: true,
            type: true,
            product: {
              select: {
                id: true,
                name: true,
                unit: {
                  select: {
                    symbol: true
                  }
                }
              }
            }
          },
          orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }]
        })
      : Promise.resolve([])

  const [purchaseBills, salesBills, payments, products, parties, units, stockLedger] = await Promise.all([
    purchaseBillsQuery,
    salesBillsQuery,
    paymentsQuery,
    productsQuery,
    partiesQuery,
    unitsQuery,
    stockLedgerQuery
  ])

  return {
    purchaseBills,
    salesBills,
    payments,
    products,
    parties,
    units,
    stockLedger
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams
    const includes = parseOverviewIncludes(searchParams)
    const requestedCompanyIds = Array.from(
      new Set(
        searchParams
          .getAll('companyIds')
          .flatMap((value) => String(value || '').split(','))
          .map((value) => normalizeId(value))
          .filter(Boolean)
      )
    )

    const requestedCompanyId = normalizeId(searchParams.get('companyId'))
    const explicitRequestedIds =
      requestedCompanyIds.length > 0 ? requestedCompanyIds : requestedCompanyId ? [requestedCompanyId] : []

    const supabaseSession = await resolveSupabaseAppSession(request)
    if (supabaseSession) {
      const accessibleCompanyIds = supabaseSession.companies
        .filter((company) => !company.locked)
        .map((company) => company.id)

      const targetCompanyIds =
        explicitRequestedIds.length > 0
          ? explicitRequestedIds.filter((companyId) => accessibleCompanyIds.includes(companyId))
          : accessibleCompanyIds

      if (targetCompanyIds.length === 0) {
        return supabaseSession.applyCookies(NextResponse.json(emptyOverviewPayload))
      }

      const supabaseAuth = {
        userId: supabaseSession.profile.user_code,
        traderId: supabaseSession.claims.trader_id,
        role: normalizeAppRole(supabaseSession.claims.app_role),
        companyId:
          supabaseSession.activeCompany?.id ||
          supabaseSession.profile.default_company_id ||
          null,
        userDbId: supabaseSession.claims.user_db_id
      }

      const [
        purchaseCompanyIds,
        salesCompanyIds,
        paymentCompanyIds,
        productCompanyIds,
        partyCompanyIds,
        unitCompanyIds,
        stockCompanyIds
      ] = await Promise.all([
        getPermissionScopedCompanyIds(supabaseAuth, request, targetCompanyIds, '/api/purchase-bills'),
        getPermissionScopedCompanyIds(supabaseAuth, request, targetCompanyIds, '/api/sales-bills'),
        getPermissionScopedCompanyIds(supabaseAuth, request, targetCompanyIds, '/api/payments'),
        getPermissionScopedCompanyIds(supabaseAuth, request, targetCompanyIds, '/api/products'),
        getPermissionScopedCompanyIds(supabaseAuth, request, targetCompanyIds, '/api/parties'),
        getPermissionScopedCompanyIds(supabaseAuth, request, targetCompanyIds, '/api/units'),
        getPermissionScopedCompanyIds(supabaseAuth, request, targetCompanyIds, '/api/stock-ledger')
      ])

      const cacheKey = makeServerCacheKey('overview', [
        Array.from(includes).sort(),
        purchaseCompanyIds,
        salesCompanyIds,
        paymentCompanyIds,
        productCompanyIds,
        partyCompanyIds,
        unitCompanyIds,
        stockCompanyIds
      ])

      const payload = await getOrSetServerCache(cacheKey, OVERVIEW_CACHE_TTL_MS, () =>
        loadOverviewPayload({
          includes,
          purchaseCompanyIds,
          salesCompanyIds,
          paymentCompanyIds,
          productCompanyIds,
          partyCompanyIds,
          unitCompanyIds,
          stockCompanyIds
        })
      )

      return supabaseSession.applyCookies(NextResponse.json(payload))
    }

    const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
    if (!authResult.ok) return authResult.response

    const accessibleCompanies = await getAccessibleCompanies(authResult.auth)

    const accessibleCompanyIds = accessibleCompanies
      .filter((company) => !company.locked)
      .map((company) => company.id)

    const targetCompanyIds =
      explicitRequestedIds.length > 0
        ? explicitRequestedIds.filter((companyId) => accessibleCompanyIds.includes(companyId))
        : accessibleCompanyIds

    if (targetCompanyIds.length === 0) {
      return NextResponse.json(emptyOverviewPayload)
    }

    const [
      purchaseCompanyIds,
      salesCompanyIds,
      paymentCompanyIds,
      productCompanyIds,
      partyCompanyIds,
      unitCompanyIds,
      stockCompanyIds
    ] = await Promise.all([
      getPermissionScopedCompanyIds(authResult.auth, request, targetCompanyIds, '/api/purchase-bills'),
      getPermissionScopedCompanyIds(authResult.auth, request, targetCompanyIds, '/api/sales-bills'),
      getPermissionScopedCompanyIds(authResult.auth, request, targetCompanyIds, '/api/payments'),
      getPermissionScopedCompanyIds(authResult.auth, request, targetCompanyIds, '/api/products'),
      getPermissionScopedCompanyIds(authResult.auth, request, targetCompanyIds, '/api/parties'),
      getPermissionScopedCompanyIds(authResult.auth, request, targetCompanyIds, '/api/units'),
      getPermissionScopedCompanyIds(authResult.auth, request, targetCompanyIds, '/api/stock-ledger')
    ])

    const cacheKey = makeServerCacheKey('overview', [
      Array.from(includes).sort(),
      purchaseCompanyIds,
      salesCompanyIds,
      paymentCompanyIds,
      productCompanyIds,
      partyCompanyIds,
      unitCompanyIds,
      stockCompanyIds
    ])

    const payload = await getOrSetServerCache(cacheKey, OVERVIEW_CACHE_TTL_MS, () =>
      loadOverviewPayload({
        includes,
        purchaseCompanyIds,
        salesCompanyIds,
        paymentCompanyIds,
        productCompanyIds,
        partyCompanyIds,
        unitCompanyIds,
        stockCompanyIds
      })
    )

    return NextResponse.json(payload)
  } catch (error) {
    console.error('GET /api/main-dashboard/overview failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    return NextResponse.json({ error: 'Failed to load dashboard overview' }, { status: 500 })
  }
}
