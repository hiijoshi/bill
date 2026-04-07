import { redirect } from 'next/navigation'

import PaymentPageClient from '@/app/payment/PaymentPageClient'
import { loadServerAppShellBootstrap } from '@/lib/server-app-shell'
import { loadServerPaymentWorkspace } from '@/lib/server-page-workspaces'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PaymentPage({ searchParams }: PageProps) {
  const params = await searchParams
  const shellBootstrap = await loadServerAppShellBootstrap({ searchParams: params })

  if (!shellBootstrap) {
    redirect('/login')
  }

  const companyId = shellBootstrap.activeCompanyId || ''
  const workspace = companyId
    ? await loadServerPaymentWorkspace(companyId, shellBootstrap.layoutData.financialYearPayload).catch(() => null)
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
        billId: String(payment.billId || ''),
        billNo: String(payment.billNo || ''),
        partyName: String(payment.partyName || ''),
        payDate:
          payment.payDate instanceof Date ? payment.payDate.toISOString() : String(payment.payDate || ''),
        amount: Number(payment.amount || 0),
        mode: String(payment.mode || '').toLowerCase() as 'cash' | 'online' | 'bank',
        txnRef: typeof payment.txnRef === 'string' ? payment.txnRef : undefined,
        note: typeof payment.note === 'string' ? payment.note : undefined,
        createdAt:
          payment.createdAt instanceof Date ? payment.createdAt.toISOString() : String(payment.createdAt || '')
      }))
    : []

  return (
    <PaymentPageClient
      initialCompanyId={companyId}
      initialPurchaseBills={initialPurchaseBills}
      initialSalesBills={initialSalesBills}
      initialPayments={initialPayments}
      initialLayoutData={shellBootstrap.layoutData}
    />
  )
}
