import { redirect } from 'next/navigation'

import PurchaseListClient from '@/app/purchase/list/PurchaseListClient'
import { loadServerAppShellBootstrap } from '@/lib/server-app-shell'
import { loadServerPurchaseListData } from '@/lib/server-page-workspaces'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const clampNonNegative = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

const normalizeBillFinancials = (totalRaw: unknown, paidRaw: unknown, balanceRaw: unknown, statusRaw: unknown) => {
  const totalAmount = clampNonNegative(totalRaw)
  const paidAmount = clampNonNegative(paidRaw)
  const normalizedStatus = String(statusRaw || '').trim().toLowerCase()
  const balanceAmount =
    normalizedStatus === 'cancelled'
      ? clampNonNegative(balanceRaw)
      : Math.max(0, totalAmount - paidAmount)
  const status = normalizedStatus === 'cancelled'
    ? 'cancelled'
    : balanceAmount === 0
      ? 'paid'
      : paidAmount <= 0
        ? 'unpaid'
        : 'partial'

  return { totalAmount, paidAmount, balanceAmount, status }
}

export default async function PurchaseListPage({ searchParams }: PageProps) {
  const params = await searchParams
  const shellBootstrap = await loadServerAppShellBootstrap({ searchParams: params })

  if (!shellBootstrap) {
    redirect('/login')
  }

  const companyId = shellBootstrap.activeCompanyId || ''
  const dataset = companyId ? await loadServerPurchaseListData(companyId).catch(() => null) : null

  const regularBills = Array.isArray(dataset?.purchaseBills)
    ? dataset.purchaseBills.map((bill) => ({
        id: String(bill?.id || ''),
        billNo: String(bill?.billNo || ''),
        billDate: String(bill?.billDate || ''),
        markaNo: typeof bill?.markaNo === 'string' ? bill.markaNo : null,
        ...normalizeBillFinancials(bill?.totalAmount, bill?.paidAmount, bill?.balanceAmount, bill?.status),
        farmer: bill?.farmer || null,
        farmerNameSnapshot: typeof bill?.farmerNameSnapshot === 'string' ? bill.farmerNameSnapshot : null,
        farmerAddressSnapshot: typeof bill?.farmerAddressSnapshot === 'string' ? bill.farmerAddressSnapshot : null,
        krashakAnubandhSnapshot: typeof bill?.krashakAnubandhSnapshot === 'string' ? bill.krashakAnubandhSnapshot : null,
        purchaseItems: Array.isArray(bill?.purchaseItems)
          ? bill.purchaseItems.map((item: Record<string, unknown>) => ({
              bags: clampNonNegative(item?.bags),
              qty: clampNonNegative(item?.qty),
              rate: clampNonNegative(item?.rate),
              hammali: clampNonNegative(item?.hammali),
              amount: clampNonNegative(item?.amount),
              markaNo: typeof item?.markaNo === 'string' ? item.markaNo : null
            }))
          : [],
        type: 'regular' as const
      }))
    : []

  const specialBills = Array.isArray(dataset?.specialPurchaseBills)
    ? dataset.specialPurchaseBills.map((bill) => ({
        id: String(bill?.id || ''),
        supplierInvoiceNo: String(bill?.supplierInvoiceNo || ''),
        billDate: String(bill?.billDate || ''),
        ...normalizeBillFinancials(bill?.totalAmount, bill?.paidAmount, bill?.balanceAmount, bill?.status),
        supplier: bill?.supplier || {
          id: '',
          name: '',
          address: '',
          gstNumber: ''
        },
        specialPurchaseItems: Array.isArray(bill?.specialPurchaseItems)
          ? bill.specialPurchaseItems.map((item: Record<string, unknown>) => ({
              noOfBags: clampNonNegative(item?.noOfBags),
              weight: clampNonNegative(item?.weight),
              rate: clampNonNegative(item?.rate),
              netAmount: clampNonNegative(item?.netAmount),
              otherAmount: clampNonNegative(item?.otherAmount),
              grossAmount: clampNonNegative(item?.grossAmount)
            }))
          : [],
        type: 'special' as const
      }))
    : []

  const initialBills = [...regularBills, ...specialBills].sort(
    (left, right) => new Date(right.billDate).getTime() - new Date(left.billDate).getTime()
  )

  return (
    <PurchaseListClient
      initialCompanyId={companyId}
      initialBills={initialBills}
      initialLayoutData={shellBootstrap.layoutData}
    />
  )
}
