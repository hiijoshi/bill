import { redirect } from 'next/navigation'

import PaymentDashboardClient from '@/app/payment/dashboard/PaymentDashboardClient'
import { loadServerAppShellBootstrap } from '@/lib/server-app-shell'
import { loadServerPaymentWorkspace } from '@/lib/server-page-workspaces'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PaymentDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams
  const shellBootstrap = await loadServerAppShellBootstrap({ searchParams: params })

  if (!shellBootstrap) {
    redirect('/login')
  }

  const companyId = shellBootstrap.activeCompanyId || ''
  const workspace = companyId
    ? await loadServerPaymentWorkspace(companyId, shellBootstrap.layoutData.financialYearPayload, {
        includePaymentModes: true
      }).catch(() => null)
    : null

  const initialPurchaseBills = Array.isArray(workspace?.purchaseBills)
    ? workspace.purchaseBills.map((bill) => ({
        ...bill,
        billDate: bill.billDate instanceof Date ? bill.billDate.toISOString() : String(bill.billDate || ''),
        farmer: bill.farmer
          ? {
              name: String(bill.farmer.name || ''),
              address: '',
              krashakAnubandhNumber: ''
            }
          : null,
        supplier: null
      }))
    : []
  const initialSalesBills = Array.isArray(workspace?.salesBills)
    ? workspace.salesBills.map((bill) => ({
        ...bill,
        billDate: bill.billDate instanceof Date ? bill.billDate.toISOString() : String(bill.billDate || ''),
        party: {
          name: String(bill.party?.name || ''),
          address: '',
          phone1: ''
        }
      }))
    : []
  const initialPayments = Array.isArray(workspace?.payments)
    ? workspace.payments.map((payment) => ({
        id: String(payment.id || ''),
        billType: String(payment.billType || ''),
        billTypeLabel: String(payment.billTypeLabel || ''),
        billId: String(payment.billId || ''),
        billNo: String(payment.billNo || ''),
        partyName: String(payment.partyName || ''),
        payDate:
          payment.payDate instanceof Date ? payment.payDate.toISOString() : String(payment.payDate || ''),
        amount: Number(payment.amount || 0),
        mode: String(payment.mode || ''),
        modeCategory: String(payment.modeCategory || 'cash') as 'cash' | 'online' | 'bank' | 'transfer',
        modeLabel: String(payment.modeLabel || ''),
        status: String(payment.status || 'paid') as 'pending' | 'paid',
        txnRef: typeof payment.txnRef === 'string' ? payment.txnRef : undefined,
        note: typeof payment.note === 'string' ? payment.note : undefined,
        bankNameSnapshot: typeof payment.bankNameSnapshot === 'string' ? payment.bankNameSnapshot : undefined,
        bankBranchSnapshot: typeof payment.bankBranchSnapshot === 'string' ? payment.bankBranchSnapshot : undefined,
        createdAt:
          payment.createdAt instanceof Date ? payment.createdAt.toISOString() : String(payment.createdAt || '')
      }))
    : []

  return (
    <PaymentDashboardClient
      initialCompanyId={companyId}
      initialPurchaseBills={initialPurchaseBills}
      initialSalesBills={initialSalesBills}
      initialPayments={initialPayments}
      initialPaymentModes={workspace?.paymentModes || []}
      initialLayoutData={shellBootstrap.layoutData}
    />
  )
}
