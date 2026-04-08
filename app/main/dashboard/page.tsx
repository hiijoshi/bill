import { redirect } from 'next/navigation'

import MainDashboardClient from '@/app/main/dashboard/MainDashboardClient'
import { getReadablePermissionModules, resolveFirstAccessibleAppRoute } from '@/lib/app-default-route'
import { loadPermissionAccessForCompany } from '@/lib/permission-access'
import { loadServerAppShellBootstrap } from '@/lib/server-app-shell'
import { loadServerDashboardOverview } from '@/lib/server-page-workspaces'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function getRequestedCompanyIds(params: Record<string, string | string[] | undefined>): string[] {
  const requested = new Set<string>()
  const companyId = typeof params.companyId === 'string' ? params.companyId.trim() : ''
  if (companyId) {
    requested.add(companyId)
  }

  const companyIdsRaw = typeof params.companyIds === 'string' ? params.companyIds : ''
  for (const companyValue of companyIdsRaw.split(',')) {
    const normalized = companyValue.trim()
    if (normalized) {
      requested.add(normalized)
    }
  }

  return [...requested]
}

function normalizeDashboardOverviewPayload(payload: unknown) {
  const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const summary = source.summary && typeof source.summary === 'object' ? source.summary as Record<string, unknown> : {}
  const purchase = summary.purchase && typeof summary.purchase === 'object' ? summary.purchase as Record<string, unknown> : {}
  const sales = summary.sales && typeof summary.sales === 'object' ? summary.sales as Record<string, unknown> : {}
  const cashflow = summary.cashflow && typeof summary.cashflow === 'object' ? summary.cashflow as Record<string, unknown> : {}
  const masterRecords =
    summary.masterRecords && typeof summary.masterRecords === 'object'
      ? summary.masterRecords as Record<string, unknown>
      : {}
  const inventory =
    summary.inventory && typeof summary.inventory === 'object'
      ? summary.inventory as Record<string, unknown>
      : {}
  const notifications =
    summary.notifications && typeof summary.notifications === 'object'
      ? summary.notifications as Record<string, unknown>
      : {}

  return {
    purchaseBills: Array.isArray(source.purchaseBills) ? source.purchaseBills : [],
    salesBills: Array.isArray(source.salesBills) ? source.salesBills : [],
    payments: Array.isArray(source.payments) ? source.payments : [],
    products: Array.isArray(source.products) ? source.products : [],
    parties: Array.isArray(source.parties) ? source.parties : [],
    units: Array.isArray(source.units) ? source.units : [],
    stockLedger: Array.isArray(source.stockLedger) ? source.stockLedger : [],
    summary: {
      purchase: {
        total: Number(purchase.total || 0),
        paid: Number(purchase.paid || 0),
        pending: Number(purchase.pending || 0),
        count: Number(purchase.count || 0)
      },
      sales: {
        total: Number(sales.total || 0),
        received: Number(sales.received || 0),
        pending: Number(sales.pending || 0),
        count: Number(sales.count || 0)
      },
      cashflow: {
        inAmount: Number(cashflow.inAmount || 0),
        outAmount: Number(cashflow.outAmount || 0),
        net: Number(cashflow.net || 0),
        count: Number(cashflow.count || 0)
      },
      masterRecords: {
        products: Number(masterRecords.products || 0),
        parties: Number(masterRecords.parties || 0),
        units: Number(masterRecords.units || 0)
      },
      inventory: {
        stockEntries: Number(inventory.stockEntries || 0),
        lowStock: Number(inventory.lowStock || 0),
        lowStockItems: Array.isArray(inventory.lowStockItems) ? inventory.lowStockItems : []
      },
      notifications: {
        pendingBills: Number(notifications.pendingBills || 0)
      }
    },
    companyPerformance: Array.isArray(source.companyPerformance) ? source.companyPerformance : [],
    trendData: Array.isArray(source.trendData) ? source.trendData : []
  }
}

export default async function MainDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams
  const shellBootstrap = await loadServerAppShellBootstrap({ searchParams: params })

  if (!shellBootstrap) {
    redirect('/login')
  }

  const availableCompanyIds = new Set(shellBootstrap.companies.map((company) => company.id))
  const selectedCompanyIds = getRequestedCompanyIds(params).filter((companyId) => availableCompanyIds.has(companyId))
  const normalizedSelectedCompanyIds =
    selectedCompanyIds.length > 0
      ? selectedCompanyIds
      : shellBootstrap.activeCompanyId
        ? [shellBootstrap.activeCompanyId]
        : []
  const primaryCompanyId =
    normalizedSelectedCompanyIds.includes(shellBootstrap.activeCompanyId)
      ? shellBootstrap.activeCompanyId
      : normalizedSelectedCompanyIds[0] || shellBootstrap.activeCompanyId || ''

  const permissionPromise = primaryCompanyId
    ? loadPermissionAccessForCompany({
        role: shellBootstrap.auth.role,
        userDbId: shellBootstrap.auth.userDbId || null,
        companyId: primaryCompanyId
      })
    : Promise.resolve(null)

  const overviewPromise =
    normalizedSelectedCompanyIds.length > 0
      ? loadServerDashboardOverview({
          auth: shellBootstrap.auth,
          companies: shellBootstrap.companies,
          targetCompanyIds: normalizedSelectedCompanyIds,
          financialYearPayload: shellBootstrap.layoutData.financialYearPayload
        }).catch(() => null)
      : Promise.resolve(null)

  const [permissionPayload, overviewPayload] = await Promise.all([
    permissionPromise,
    overviewPromise
  ])

  const hasDashboardAccess = permissionPayload
    ? new Set(getReadablePermissionModules(permissionPayload.permissions)).has('DASHBOARD')
    : true

  if (primaryCompanyId && permissionPayload && !hasDashboardAccess) {
    const nextRoute = resolveFirstAccessibleAppRoute(permissionPayload.permissions, primaryCompanyId)
    redirect(nextRoute.startsWith('/main/dashboard') ? '/main/profile' : nextRoute)
  }

  return (
    <MainDashboardClient
      initialCompanies={shellBootstrap.companies}
      initialSelectedCompanyIds={normalizedSelectedCompanyIds}
      initialPrimaryCompanyId={primaryCompanyId}
      initialDashboardData={normalizeDashboardOverviewPayload(overviewPayload)}
      initialHasDashboardAccess={hasDashboardAccess}
      initialDashboardAccessResolved
      initialPermissionPayload={
        permissionPayload
          ? {
              companyId: primaryCompanyId,
              ...permissionPayload
            }
          : null
      }
      initialLayoutData={shellBootstrap.layoutData}
    />
  )
}
