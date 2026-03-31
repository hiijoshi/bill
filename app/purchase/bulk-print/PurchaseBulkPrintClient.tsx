'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import type { PurchaseBillPrintData } from '@/lib/purchase-print'
import type { SpecialPurchaseBillPrintData } from '@/lib/special-purchase-print'

import { PurchasePrintSheet } from '../[id]/print/PurchasePrintClient'
import { SpecialPurchasePrintSheet } from '../special/[id]/print/SpecialPurchasePrintClient'

export type PurchaseBulkPrintEntry =
  | {
      key: string
      type: 'regular'
      printData: PurchaseBillPrintData
    }
  | {
      key: string
      type: 'special'
      printData: SpecialPurchaseBillPrintData
    }

type Props = {
  entries: PurchaseBulkPrintEntry[]
  companyId: string
  skippedCount: number
}

export default function PurchaseBulkPrintClient({ entries, companyId, skippedCount }: Props) {
  const router = useRouter()
  const returnPath = companyId
    ? `/purchase/list?companyId=${encodeURIComponent(companyId)}`
    : '/purchase/list'

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
          @page {
            size: A4 portrait;
            margin: 0;
          }
          .purchase-bulk-sheet {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={() => router.push(returnPath)}>
          Back
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm text-slate-600">
            {entries.length} bill{entries.length === 1 ? '' : 's'} ready for print
          </div>
          {skippedCount > 0 ? (
            <div className="text-sm font-medium text-amber-700">
              {skippedCount} skipped due to missing access or missing data
            </div>
          ) : null}
          <Button variant="outline" onClick={() => window.print()}>
            Print All
          </Button>
          <Button onClick={() => router.push(returnPath)}>Purchase List</Button>
        </div>
      </div>

      <div className="space-y-4 print:space-y-0">
        {entries.map((entry) => (
          <div key={entry.key} className="purchase-bulk-sheet">
            {entry.type === 'regular' ? (
              <PurchasePrintSheet printData={entry.printData} />
            ) : (
              <SpecialPurchasePrintSheet printData={entry.printData} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
