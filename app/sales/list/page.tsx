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
  const dataset = companyId ? await loadServerSalesListData(companyId).catch(() => null) : null

  const initialBills = Array.isArray(dataset)
    ? dataset.map((raw) => {
        const totalAmount = clampNonNegative(raw?.totalAmount)
        const receivedAmount = clampNonNegative(raw?.receivedAmount)
        const explicitBalance = clampNonNegative(raw?.balanceAmount)
        const status = normalizeBillStatus(totalAmount, receivedAmount, explicitBalance, raw?.status)
        const balanceAmount = status === 'cancelled' ? explicitBalance : Math.max(0, totalAmount - receivedAmount)

        return {
          id: String(raw?.id || ''),
          invoiceNo: String(raw?.invoiceNo || raw?.billNo || ''),
          invoiceDate: String(raw?.invoiceDate || raw?.billDate || ''),
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
                weight: clampNonNegative(item?.weight || item?.qty),
                qty: clampNonNegative(item?.qty || item?.weight),
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
