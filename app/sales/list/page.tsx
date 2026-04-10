import { redirect } from 'next/navigation'

import SalesListClient from '@/app/sales/list/SalesListClient'
import { loadServerAppShellBootstrap } from '@/lib/server-app-shell'
import { loadServerSalesListData } from '@/lib/server-page-workspaces'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const clampNonNegative = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

function normalizeBillStatus(
  totalAmount: number,
  receivedAmount: number,
  balanceAmount: number,
  statusRaw: unknown
): 'paid' | 'partial' | 'unpaid' | 'cancelled' {
  const normalizedStatus = String(statusRaw || '').trim().toLowerCase()
  if (normalizedStatus === 'cancelled') return 'cancelled'
  if (balanceAmount <= 0 && totalAmount > 0) return 'paid'
  if (receivedAmount > 0) return 'partial'
  return 'unpaid'
}

export default async function SalesListPage({ searchParams }: PageProps) {
  const params = await searchParams
  const shellBootstrap = await loadServerAppShellBootstrap({ searchParams: params })

  if (!shellBootstrap) {
    redirect('/login')
  }

  const companyId = shellBootstrap.activeCompanyId || ''
  const dataset = companyId
    ? await loadServerSalesListData(companyId, shellBootstrap.layoutData.financialYearPayload).catch(() => null)
    : null

  const initialBills = Array.isArray(dataset)
    ? dataset.map((raw) => {
        const childRows = Array.isArray((raw as { childSalesBills?: Array<Record<string, unknown>> }).childSalesBills)
          ? ((raw as { childSalesBills?: Array<Record<string, unknown>> }).childSalesBills || [])
          : []
        const totalAmount = clampNonNegative(raw?.totalAmount)
        const receivedAmount = clampNonNegative(raw?.receivedAmount)
        const explicitBalance = clampNonNegative(raw?.balanceAmount)
        const status = normalizeBillStatus(totalAmount, receivedAmount, explicitBalance, raw?.status)
        const balanceAmount = status === 'cancelled' ? explicitBalance : Math.max(0, totalAmount - receivedAmount)

        return {
          id: String(raw?.id || ''),
          invoiceNo: String(raw?.billNo || ''),
          invoiceDate: String(raw?.billDate || ''),
          totalAmount,
          receivedAmount,
          balanceAmount,
          status,
          party: {
            name: String(raw?.party?.name || ''),
            address: String(raw?.party?.address || ''),
            phone1: String(raw?.party?.phone1 || '')
          },
          salesItems: Array.isArray(raw?.salesItems)
            ? raw.salesItems.map((item: Record<string, unknown>) => ({
                weight: clampNonNegative(item?.weight),
                qty: clampNonNegative(item?.weight),
                bags: clampNonNegative(item?.bags),
                rate: clampNonNegative(item?.rate),
                amount: clampNonNegative(item?.amount),
                product:
                  item?.product && typeof item.product === 'object'
                    ? { name: String((item.product as { name?: unknown }).name || '') }
                    : undefined
              }))
            : [],
          transportBills: Array.isArray(raw?.transportBills)
            ? raw.transportBills.map((item: Record<string, unknown>) => ({
                transportName: String(item?.transportName || ''),
                lorryNo: String(item?.lorryNo || ''),
                freightAmount: clampNonNegative(item?.freightAmount),
                otherAmount: clampNonNegative(item?.otherAmount),
                insuranceAmount: clampNonNegative(item?.insuranceAmount)
              }))
            : [],
          splitSummary:
            raw && typeof raw === 'object'
              ? {
                  invoiceKind: String((raw as { invoiceKind?: unknown }).invoiceKind || ''),
                  workflowStatus: String((raw as { workflowStatus?: unknown }).workflowStatus || ''),
                  splitMethod:
                    (raw as { splitMethod?: unknown }).splitMethod == null
                      ? null
                      : String((raw as { splitMethod?: unknown }).splitMethod),
                  splitPartLabel:
                    (raw as { splitPartLabel?: unknown }).splitPartLabel == null
                      ? null
                      : String((raw as { splitPartLabel?: unknown }).splitPartLabel),
                  splitSuffix:
                    (raw as { splitSuffix?: unknown }).splitSuffix == null
                      ? null
                      : String((raw as { splitSuffix?: unknown }).splitSuffix),
                  childCount: childRows.length,
                  parentBillId:
                    (raw as { parentSalesBill?: { id?: unknown } }).parentSalesBill?.id == null
                      ? null
                      : String((raw as { parentSalesBill?: { id?: unknown } }).parentSalesBill?.id),
                  parentBillNo:
                    (raw as { parentSalesBill?: { billNo?: unknown } }).parentSalesBill?.billNo == null
                      ? null
                      : String((raw as { parentSalesBill?: { billNo?: unknown } }).parentSalesBill?.billNo),
                }
              : undefined,
          parentSalesBill:
            raw &&
            typeof raw === 'object' &&
            (raw as { parentSalesBill?: { id?: unknown; billNo?: unknown } }).parentSalesBill
              ? {
                  id: String((raw as { parentSalesBill?: { id?: unknown } }).parentSalesBill?.id || ''),
                  billNo: String((raw as { parentSalesBill?: { billNo?: unknown } }).parentSalesBill?.billNo || ''),
                }
              : null,
          childSalesBills:
            raw &&
            typeof raw === 'object' &&
            childRows.length > 0
              ? childRows.map((child) => ({
                  id: String(child?.id || ''),
                  billNo: String(child?.billNo || ''),
                  totalAmount: clampNonNegative(child?.totalAmount),
                  receivedAmount: clampNonNegative(child?.receivedAmount),
                  balanceAmount: clampNonNegative(child?.balanceAmount),
                  workflowStatus: String(child?.workflowStatus || ''),
                  invoiceKind: String(child?.invoiceKind || ''),
                  splitPartLabel: child?.splitPartLabel == null ? null : String(child.splitPartLabel),
                  splitSuffix: child?.splitSuffix == null ? null : String(child.splitSuffix),
                }))
              : []
        }
      })
    : []

  return (
    <SalesListClient
      initialCompanyId={companyId}
      initialBills={initialBills}
      initialLayoutData={shellBootstrap.layoutData}
    />
  )
}
