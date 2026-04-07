import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  formatFinancialYearDateInput,
  getEffectiveClientFinancialYear,
  type ClientFinancialYearPayload
} from '@/lib/client-financial-years'
import { fetchInternalApiJson } from '@/lib/server-internal-api'
import { loadPaymentWorkspaceData } from '@/lib/server-payment-workspace'
import { loadReportDashboardData, type ReportDashboardType } from '@/lib/server-report-dashboard'
import { loadStockWorkspaceData } from '@/lib/server-stock-workspace'

export type ServerDateRange = {
  dateFrom: Date | null
  dateTo: Date | null
  dateFromInput: string
  dateToInput: string
}

export function getServerFinancialYearRange(payload?: ClientFinancialYearPayload | null): ServerDateRange {
  const financialYear = getEffectiveClientFinancialYear(payload || null)
  if (!financialYear) {
    return {
      dateFrom: null,
      dateTo: null,
      dateFromInput: '',
      dateToInput: ''
    }
  }

  const dateFrom = new Date(financialYear.startDate)
  const dateTo = new Date(financialYear.endDate)
  return {
    dateFrom: Number.isFinite(dateFrom.getTime()) ? dateFrom : null,
    dateTo: Number.isFinite(dateTo.getTime()) ? dateTo : null,
    dateFromInput: formatFinancialYearDateInput(financialYear.startDate),
    dateToInput: formatFinancialYearDateInput(financialYear.endDate)
  }
}

export async function loadServerDashboardOverview(companyIds: string[]) {
  const params = new URLSearchParams()
  params.append('include', 'purchaseBills')
  params.append('include', 'salesBills')

  if (companyIds.length === 1) {
    params.set('companyId', companyIds[0])
  } else if (companyIds.length > 1) {
    params.set('companyIds', companyIds.join(','))
  }

  return fetchInternalApiJson(`/api/main-dashboard/overview?${params.toString()}`)
}

export async function loadServerPurchaseListData(companyId: string) {
  const [purchaseBills, specialPurchaseBills] = await Promise.all([
    fetchInternalApiJson(`/api/purchase-bills?companyId=${encodeURIComponent(companyId)}&includeCancelled=true&view=list`),
    fetchInternalApiJson(`/api/special-purchase-bills?companyId=${encodeURIComponent(companyId)}&includeCancelled=true`)
  ])

  return {
    purchaseBills,
    specialPurchaseBills
  }
}

export async function loadServerSalesListData(companyId: string) {
  return fetchInternalApiJson(`/api/sales-bills?companyId=${encodeURIComponent(companyId)}&includeCancelled=true&view=list`)
}

export async function loadServerPaymentWorkspace(
  companyId: string,
  financialYearPayload?: ClientFinancialYearPayload | null,
  options: {
    includePaymentModes?: boolean
  } = {}
) {
  const range = getServerFinancialYearRange(financialYearPayload)
  return loadPaymentWorkspaceData(companyId, {
    includePaymentModes: options.includePaymentModes,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo
  })
}

export async function loadServerStockWorkspace(
  companyId: string,
  financialYearPayload?: ClientFinancialYearPayload | null,
  recentLimit = 60
) {
  const range = getServerFinancialYearRange(financialYearPayload)
  return loadStockWorkspaceData(companyId, recentLimit, {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo
  })
}

export async function loadServerReportDashboardWorkspace(
  companyId: string,
  reportType: ReportDashboardType,
  financialYearPayload?: ClientFinancialYearPayload | null
) {
  const range = getServerFinancialYearRange(financialYearPayload)
  return loadReportDashboardData(companyId, reportType, {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo
  })
}

export async function loadServerStockReportRows(
  companyId: string,
  financialYearPayload?: ClientFinancialYearPayload | null
) {
  const range = getServerFinancialYearRange(financialYearPayload)
  const params = new URLSearchParams({
    companyId
  })
  if (range.dateFromInput) params.set('dateFrom', range.dateFromInput)
  if (range.dateToInput) params.set('dateTo', range.dateToInput)

  const payload = await fetchInternalApiJson<Array<Record<string, unknown>> | { data?: Array<Record<string, unknown>> }>(
    `/api/stock-ledger?${params.toString()}`
  )

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : []

  const company = await prisma.company.findFirst({
    where: { id: companyId },
    select: {
      name: true
    }
  })
  const companyName = company?.name || companyId

  return rows
    .map((entry) => {
      const entryDate = typeof entry?.entryDate === 'string' ? new Date(entry.entryDate) : null
      if (!entryDate || !Number.isFinite(entryDate.getTime())) {
        return null
      }

      const qtyIn = Number(entry?.qtyIn || 0)
      const qtyOut = Number(entry?.qtyOut || 0)
      return {
        id: String(entry?.id || ''),
        companyId,
        companyName,
        entryDate: String(entry?.entryDate || ''),
        productName: String((entry?.product as { name?: unknown } | undefined)?.name || '').trim() || 'Unknown Product',
        unit: String((entry?.product as { unit?: unknown } | undefined)?.unit || '').trim() || '-',
        type: String(entry?.type || '').trim() || 'unknown',
        qtyIn: Number.isFinite(qtyIn) ? qtyIn : 0,
        qtyOut: Number.isFinite(qtyOut) ? qtyOut : 0,
        netMovement: (Number.isFinite(qtyIn) ? qtyIn : 0) - (Number.isFinite(qtyOut) ? qtyOut : 0),
        refTable: String(entry?.refTable || '').trim() || '-',
        refId: String(entry?.refId || '').trim() || '-',
        _sortTs: entryDate.getTime()
      }
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((left, right) => right._sortTs - left._sortTs)
}

export async function loadServerOperationsReport(
  companyId: string,
  view: string,
  financialYearPayload?: ClientFinancialYearPayload | null,
  options: {
    companyIds?: string[]
    partyId?: string
  } = {}
) {
  const range = getServerFinancialYearRange(financialYearPayload)
  const params = new URLSearchParams({ view })
  const normalizedCompanyIds = Array.from(new Set((options.companyIds || []).map((value) => value.trim()).filter(Boolean)))
  if (normalizedCompanyIds.length > 1) {
    params.set('companyIds', normalizedCompanyIds.join(','))
  } else {
    params.set('companyId', normalizedCompanyIds[0] || companyId)
  }
  if (options.partyId) {
    params.set('partyId', options.partyId)
  }
  if (range.dateFromInput) params.set('dateFrom', range.dateFromInput)
  if (range.dateToInput) params.set('dateTo', range.dateToInput)
  return fetchInternalApiJson(`/api/reports/operations?${params.toString()}`)
}
