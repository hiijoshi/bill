import { redirect } from 'next/navigation'

import ReportsMainClient from '@/app/reports/main/ReportsMainClient'
import { loadServerAppShellBootstrap } from '@/lib/server-app-shell'
import {
  getServerFinancialYearRange,
  loadServerOperationsReport,
  loadServerReportDashboardWorkspace,
  loadServerStockReportRows
} from '@/lib/server-page-workspaces'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type ReportType = 'main' | 'purchase' | 'sales' | 'stock' | 'operations'
type OperationsView = 'overview' | 'outstanding' | 'ledger' | 'daily' | 'cash-ledger' | 'bank-ledger'

function normalizeReportType(value: string | string[] | undefined): ReportType {
  const normalized = Array.isArray(value) ? value[0] : value
  if (normalized === 'purchase' || normalized === 'sales' || normalized === 'stock' || normalized === 'operations') {
    return normalized
  }
  return 'main'
}

function normalizeOperationsView(value: string | string[] | undefined): OperationsView {
  const normalized = Array.isArray(value) ? value[0] : value
  if (
    normalized === 'overview' ||
    normalized === 'daily' ||
    normalized === 'ledger' ||
    normalized === 'daily-transaction' ||
    normalized === 'daily-consolidated' ||
    normalized === 'cash-ledger' ||
    normalized === 'bank-ledger'
  ) {
    if (normalized === 'daily-transaction' || normalized === 'daily-consolidated') {
      return 'daily'
    }
    return normalized
  }
  return 'overview'
}

export default async function ReportsMainPage({ searchParams }: PageProps) {
  const params = await searchParams
  const shellBootstrap = await loadServerAppShellBootstrap({ searchParams: params })

  if (!shellBootstrap) {
    redirect('/login')
  }

  const companyId = shellBootstrap.activeCompanyId || ''
  const companyName = shellBootstrap.companies.find((company) => company.id === companyId)?.name || companyId
  const reportType = normalizeReportType(params.reportType)
  const operationsView = normalizeOperationsView(params.view)
  const initialPartyId = typeof params.partyId === 'string' ? params.partyId.trim() : ''
  const financialYearRange = getServerFinancialYearRange(shellBootstrap.layoutData.financialYearPayload)
  const generatedAt = new Date().toLocaleString('en-IN')

  const reportDashboardSeed =
    companyId && reportType !== 'stock' && reportType !== 'operations'
      ? await loadServerReportDashboardWorkspace(
          companyId,
          reportType === 'main' ? 'main' : reportType,
          shellBootstrap.layoutData.financialYearPayload
        )
          .then((payload) => ({
            datasets: [
              {
                companyId,
                companyName,
                purchaseBills: Array.isArray(payload.purchaseBills) ? payload.purchaseBills : [],
                specialPurchaseBills: Array.isArray(payload.specialPurchaseBills) ? payload.specialPurchaseBills : [],
                salesBills: Array.isArray(payload.salesBills) ? payload.salesBills : [],
                payments: Array.isArray(payload.payments) ? payload.payments : [],
                banks: Array.isArray(payload.banks) ? payload.banks : []
              }
            ],
            dateFrom: financialYearRange.dateFromInput,
            dateTo: financialYearRange.dateToInput,
            lastGeneratedAt: generatedAt
          }))
          .catch(() => null)
      : null

  const stockReportSeed =
    companyId && reportType === 'stock'
      ? await loadServerStockReportRows(
          companyId,
          shellBootstrap.layoutData.financialYearPayload
        )
          .then((rows) => ({
            rows,
            dateFrom: financialYearRange.dateFromInput,
            dateTo: financialYearRange.dateToInput,
            lastGeneratedAt: generatedAt
          }))
          .catch(() => null)
      : null

  const operationsReportSeed =
    companyId && reportType === 'operations'
      ? await loadServerOperationsReport(
          companyId,
          operationsView,
          shellBootstrap.layoutData.financialYearPayload,
          {
            partyId: initialPartyId
          }
        )
          .then((payload) => ({
            payload: payload as Record<string, unknown>,
            dateFrom: financialYearRange.dateFromInput,
            dateTo: financialYearRange.dateToInput,
            lastGeneratedAt:
              typeof (payload as { meta?: { generatedAt?: string } })?.meta?.generatedAt === 'string'
                ? new Date((payload as { meta?: { generatedAt?: string } }).meta!.generatedAt!).toLocaleString('en-IN')
                : generatedAt
          }))
          .catch(() => null)
      : null

  return (
    <ReportsMainClient
      initialCompanyId={companyId}
      initialLayoutData={shellBootstrap.layoutData}
      companyOptions={shellBootstrap.companies.map((company) => ({
        id: company.id,
        name: company.name
      }))}
      initialReportType={reportType}
      initialOperationsView={operationsView}
      initialSelectedPartyId={initialPartyId}
      initialCompanyWarning={companyId ? '' : 'Company is not resolved yet. Data may be limited until company is selected.'}
      initialReportDashboardSeed={reportDashboardSeed}
      initialStockReportSeed={stockReportSeed}
      initialOperationsReportSeed={operationsReportSeed}
    />
  )
}
