import { redirect } from 'next/navigation'

import StockAdjustmentClient from '@/app/stock/adjustment/StockAdjustmentClient'
import { loadServerAppShellBootstrap } from '@/lib/server-app-shell'
import { loadServerStockWorkspace } from '@/lib/server-page-workspaces'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function StockAdjustmentPage({ searchParams }: PageProps) {
  const params = await searchParams
  const shellBootstrap = await loadServerAppShellBootstrap({ searchParams: params })

  if (!shellBootstrap) {
    redirect('/login')
  }

  const companyId = shellBootstrap.activeCompanyId || ''
  const workspace = companyId
    ? await loadServerStockWorkspace(
        companyId,
        shellBootstrap.layoutData.financialYearPayload,
        40
      ).catch(() => null)
    : null
  const initialStockSummary = Array.isArray(workspace?.stockSummary)
    ? workspace.stockSummary.map((row) => ({
        productId: String(row.productId || ''),
        productName: String(row.productName || ''),
        unit: String(row.productUnit || ''),
        currentStock: Number(row.closingStock || 0),
        totalIn: Number(row.totalIn || 0),
        totalOut: Number(row.totalOut || 0),
        adjustmentEntries: Number(row.adjustmentEntries || 0),
        movementCount: Number(row.movementCount || 0),
        lastMovementDate:
          row.lastMovementDate instanceof Date
            ? row.lastMovementDate.toISOString()
            : row.lastMovementDate
              ? String(row.lastMovementDate)
              : null
      }))
    : []
  const initialStockLedger = Array.isArray(workspace?.stockLedger)
    ? workspace.stockLedger.map((entry) => ({
        id: String(entry.id || ''),
        entryDate: entry.entryDate instanceof Date ? entry.entryDate.toISOString() : String(entry.entryDate || ''),
        type: (
          entry.type === 'purchase' || entry.type === 'sales' || entry.type === 'adjustment'
            ? entry.type
            : 'adjustment'
        ) as 'purchase' | 'sales' | 'adjustment',
        qtyIn: Number(entry.qtyIn || 0),
        qtyOut: Number(entry.qtyOut || 0),
        refTable: String(entry.refTable || ''),
        refId: String(entry.refId || ''),
        product: {
          id: String(entry.product?.id || ''),
          name: String(entry.product?.name || '')
        }
      }))
    : []

  return (
    <StockAdjustmentClient
      initialCompanyId={companyId}
      initialProducts={workspace?.products || []}
      initialStockSummary={initialStockSummary}
      initialStockLedger={initialStockLedger}
      initialLayoutData={shellBootstrap.layoutData}
    />
  )
}
