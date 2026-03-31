'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import type { SalesBillPrintData } from '@/lib/sales-print'

import { DispatchTemplate, InvoiceTemplate, type PrintType } from '../[id]/print/SalesPrintClient'

type Props = {
  bills: SalesBillPrintData[]
  companyId: string
  printType: PrintType
  skippedCount: number
}

export default function SalesBulkPrintClient({ bills, companyId, printType, skippedCount }: Props) {
  const router = useRouter()
  const returnPath = companyId
    ? `/sales/list?companyId=${encodeURIComponent(companyId)}`
    : '/sales/list'

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.print()
    }, 350)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [])

  return (
    <div className="bg-white p-4 print:p-0">
      <style jsx global>{`
        @page {
          size: A4 portrait;
          margin: 6mm;
        }
        @media print {
          .no-print {
            display: none !important;
          }
          html, body {
            margin: 0;
            padding: 0;
            width: 210mm;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .sales-bulk-sheet {
            break-after: page;
            page-break-after: always;
          }
          .sales-bulk-sheet:last-child {
            break-after: auto;
            page-break-after: auto;
          }
        }
      `}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={() => router.push(returnPath)}>
          Back
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm text-slate-600">
            {bills.length} sales bill{bills.length === 1 ? '' : 's'} ready for {printType} print
          </div>
          {skippedCount > 0 ? (
            <div className="text-sm font-medium text-amber-700">
              {skippedCount} skipped due to missing access or missing data
            </div>
          ) : null}
          <Button variant="outline" onClick={() => window.print()}>
            Print All
          </Button>
          <Button onClick={() => router.push(returnPath)}>Sales List</Button>
        </div>
      </div>

      <div className="space-y-4 print:space-y-0">
        {bills.map((bill) => (
          <div key={bill.id} className="sales-bulk-sheet">
            {printType === 'dispatch' ? (
              <DispatchTemplate printData={bill} rows={padRows(bill.items, 16)} />
            ) : (
              <InvoiceTemplate printData={bill} rows={padRows(bill.items, 18)} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function padRows<T>(items: T[], minRows: number): Array<T | null> {
  const rows: Array<T | null> = [...items]
  while (rows.length < minRows) rows.push(null)
  return rows
}
