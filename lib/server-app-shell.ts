import 'server-only'

import { cookies, headers } from 'next/headers'

import type { RequestAuthContext } from '@/lib/api-security'
import type {
  ClientFinancialYearPayload,
  ClientFinancialYearSummary
} from '@/lib/client-financial-years'
import type { ShellAuthMePayload, ShellCompanySummary } from '@/lib/client-shell-data'
import type { DashboardLayoutInitialData, SubscriptionBannerPayload } from '@/lib/app-shell-types'
import { getAccessibleCompanies, normalizeAppRole, normalizeId } from '@/lib/api-security'
import { getFinancialYearContext } from '@/lib/financial-years'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import {
  getCompanyCookieNameCandidates,
  getFinancialYearCookieNameCandidates
} from '@/lib/session-cookies'
import { getCurrentTraderSubscription, getTraderSubscriptionEntitlement } from '@/lib/subscription-core'
import { ensureSubscriptionManagementSchemaReady } from '@/lib/subscription-schema'
import { getTraderDataLifecycleSummary } from '@/lib/trader-retention'

type ServerUserRow = {
  id: string
  userId: string
  traderId: string
  name: string | null
  role: string | null
  companyId: string | null
  locked: boolean
  trader: {
    id: string
    name: string | null
    locked: boolean
    deletedAt: Date | null
    maxCompanies: number | null
    maxUsers: number | null
  } | null
}

export type ServerAppShellBootstrap = {
  auth: RequestAuthContext
  user: ServerUserRow
  companies: ShellCompanySummary[]
  activeCompanyId: string
  layoutData: DashboardLayoutInitialData
}

function normalizeNullableId(value: string | null | undefined): string {
  return String(value || '').trim()
}

function getRequestedCompanyId(searchParams?: Record<string, string | string[] | undefined>): string {
  const direct = searchParams?.companyId
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim()
  }

  const combined = searchParams?.companyIds
  if (typeof combined === 'string' && combined.trim()) {
    return combined
      .split(',')
      .map((value) => value.trim())
      .find(Boolean) || ''
  }

  return ''
}

function getRequestedFinancialYearId(searchParams?: Record<string, string | string[] | undefined>): string {
  const candidates = [searchParams?.financialYearId, searchParams?.fy, searchParams?.financialYear]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return ''
}

async function getCookieValue(candidates: string[]): Promise<string> {
  const cookieStore = await cookies()
  for (const candidate of candidates) {
    const value = cookieStore.get(candidate)?.value?.trim()
    if (value) {
      return value
    }
  }
  return ''
}

async function getScopeSource() {
  const headerStore = await headers()
  return headerStore.get('x-forwarded-host') || headerStore.get('host') || null
}

function toShellAuthPayload(user: ServerUserRow, activeCompany: ShellCompanySummary | null): ShellAuthMePayload {
  return {
    success: true,
    user: {
      id: user.id,
      userId: user.userId,
      traderId: user.traderId,
      name: user.name,
      role: user.role,
      companyId: activeCompany?.id || null,
      assignedCompanyId: user.companyId || null
    },
    trader: user.trader
      ? {
          id: user.trader.id,
          name: user.trader.name
        }
      : null,
    company: activeCompany
      ? {
          id: activeCompany.id,
          name: activeCompany.name
        }
      : null
  }
}

function chooseActiveCompanyId(args: {
  companies: ShellCompanySummary[]
  requestedCompanyId: string
  cookieCompanyId: string
  assignedCompanyId: string
}): string {
  const unlockedCompanies = args.companies.filter((company) => !company.locked)
  const preferredIds = [
    args.requestedCompanyId,
    args.cookieCompanyId,
    args.assignedCompanyId
  ].filter(Boolean)

  for (const companyId of preferredIds) {
    if (unlockedCompanies.some((company) => company.id === companyId)) {
      return companyId
    }
  }

  for (const companyId of preferredIds) {
    if (args.companies.some((company) => company.id === companyId)) {
      return companyId
    }
  }

  return unlockedCompanies[0]?.id || args.companies[0]?.id || ''
}

async function loadSubscriptionBanner(user: ServerUserRow): Promise<SubscriptionBannerPayload | null> {
  if (!user.trader) {
    return null
  }

  const schemaReady = await ensureSubscriptionManagementSchemaReady(prisma)
  if (!schemaReady) {
    return null
  }

  const [entitlement, currentSubscription, dataLifecycle] = await Promise.all([
    getTraderSubscriptionEntitlement(prisma, user.traderId, new Date(), {
      id: user.trader.id,
      name: user.trader.name || '',
      maxCompanies: user.trader.maxCompanies,
      maxUsers: user.trader.maxUsers,
      locked: user.trader.locked,
      deletedAt: user.trader.deletedAt
    }),
    getCurrentTraderSubscription(prisma, user.traderId),
    getTraderDataLifecycleSummary(prisma, user.traderId, new Date(), {
      traderDeletedAt: user.trader.deletedAt
    })
  ])

  return {
    entitlement: entitlement
      ? {
          lifecycleState: entitlement.lifecycleState,
          message: entitlement.message,
          daysLeft: entitlement.daysLeft
        }
      : null,
    dataLifecycle: dataLifecycle
      ? {
          state: dataLifecycle.state,
          readOnlyMode: dataLifecycle.readOnlyMode,
          message: dataLifecycle.message
        }
      : null,
    currentSubscription: currentSubscription
      ? {
          planName: currentSubscription.planName,
          endDate: currentSubscription.endDate
        }
      : null
  }
}

async function loadFinancialYearPayload(args: {
  auth: RequestAuthContext
  companyId: string
  searchParams?: Record<string, string | string[] | undefined>
}): Promise<ClientFinancialYearPayload> {
  const context = await getFinancialYearContext({
    auth: args.auth,
    companyId: args.companyId || null
  })
  const scopeSource = await getScopeSource()
  const cookieFinancialYearId = await getCookieValue(
    getFinancialYearCookieNameCandidates(scopeSource)
  )
  const requestedFinancialYearId =
    getRequestedFinancialYearId(args.searchParams) || normalizeId(cookieFinancialYearId)
  const selectedFinancialYear =
    (requestedFinancialYearId
      ? context.financialYears.find((row) => row.id === requestedFinancialYearId) || null
      : null) || null

  const serializeFinancialYear = (
    row: (typeof context.financialYears)[number] | null
  ): ClientFinancialYearSummary | null =>
    row
      ? {
          id: row.id,
          traderId: row.traderId,
          label: row.label,
          startDate: row.startDate.toISOString(),
          endDate: row.endDate.toISOString(),
          isActive: row.isActive,
          status: row.status as ClientFinancialYearSummary['status'],
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
          closedAt: row.closedAt ? row.closedAt.toISOString() : null,
          lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null
        }
      : null

  return {
    traderId: context.traderId,
    activeFinancialYear: serializeFinancialYear(context.activeFinancialYear),
    selectedFinancialYear: serializeFinancialYear(selectedFinancialYear),
    financialYears: context.financialYears
      .map((row) => serializeFinancialYear(row))
      .filter((row): row is ClientFinancialYearSummary => Boolean(row))
  }
}

export async function loadServerAppShellBootstrap(options: {
  searchParams?: Record<string, string | string[] | undefined>
  companyId?: string | null
} = {}): Promise<ServerAppShellBootstrap | null> {
  const session = await getSession('app')
  if (!session) {
    return null
  }

  const user = await prisma.user.findFirst({
    where: {
      userId: session.userId,
      traderId: session.traderId,
      deletedAt: null
    },
    select: {
      id: true,
      userId: true,
      traderId: true,
      name: true,
      role: true,
      companyId: true,
      locked: true,
      trader: {
        select: {
          id: true,
          name: true,
          locked: true,
          deletedAt: true,
          maxCompanies: true,
          maxUsers: true
        }
      }
    }
  })

  if (!user || user.locked || user.trader?.locked || user.trader?.deletedAt) {
    return null
  }

  const auth: RequestAuthContext = {
    userId: user.userId,
    traderId: user.traderId,
    role: normalizeAppRole(user.role || session.role),
    companyId: user.companyId || null,
    userDbId: user.id
  }

  const companies = await getAccessibleCompanies(auth)
  const normalizedCompanies: ShellCompanySummary[] = companies.map((company) => ({
    id: company.id,
    name: company.name,
    locked: company.locked
  }))

  const scopeSource = await getScopeSource()
  const cookieCompanyId = await getCookieValue(getCompanyCookieNameCandidates(scopeSource))
  const requestedCompanyId = normalizeNullableId(options.companyId) || getRequestedCompanyId(options.searchParams)
  const activeCompanyId = chooseActiveCompanyId({
    companies: normalizedCompanies,
    requestedCompanyId,
    cookieCompanyId,
    assignedCompanyId: normalizeNullableId(user.companyId)
  })
  const activeCompany = normalizedCompanies.find((company) => company.id === activeCompanyId) || null
  const [subscriptionBanner, financialYearPayload] = await Promise.all([
    loadSubscriptionBanner(user),
    loadFinancialYearPayload({
      auth,
      companyId: activeCompanyId || normalizeNullableId(user.companyId),
      searchParams: options.searchParams
    })
  ])

  return {
    auth,
    user,
    companies: normalizedCompanies,
    activeCompanyId,
    layoutData: {
      shellBootstrap: {
        auth: toShellAuthPayload(user, activeCompany),
        companies: normalizedCompanies,
        activeCompanyId
      },
      subscriptionBanner,
      financialYearPayload
    }
  }
}
