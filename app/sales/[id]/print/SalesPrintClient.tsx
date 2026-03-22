'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { SalesBillPrintData } from '@/lib/sales-print'

type Props = {
  printData: SalesBillPrintData
}

type PrintType = 'invoice' | 'dispatch'

const toFixed2 = (value: number) => value.toFixed(2)

function createRows<T>(items: T[], minRows: number): Array<T | null> {
  const rows: Array<T | null> = [...items]
  while (rows.length < minRows) rows.push(null)
  return rows
}

export default function SalesPrintClient({ printData }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [printType, setPrintType] = useState<PrintType>(
    () => (searchParams.get('type') === 'dispatch' ? 'dispatch' : 'invoice')
  )
  const shouldAutoPrint = searchParams.get('autoprint') === '1'

  const updateType = (nextType: PrintType) => {
    setPrintType(nextType)
    const currentUrl = new URL(window.location.href)
    currentUrl.searchParams.set('type', nextType)
    window.history.replaceState({}, '', `${currentUrl.pathname}?${currentUrl.searchParams.toString()}`)
  }

  const invoiceRows = useMemo(() => createRows(printData.items, 18), [printData.items])
  const dispatchRows = useMemo(() => createRows(printData.items, 16), [printData.items])

  useEffect(() => {
    if (!shouldAutoPrint) return
    const timeout = window.setTimeout(() => {
      window.print()
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [shouldAutoPrint, printType])

  return (
    <div className="bg-white text-black p-4 print:p-0">
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
          .print-sheet {
            width: 198mm;
            min-height: 285mm;
            margin: 0 auto;
            box-sizing: border-box;
          }
        }
      `}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={() => router.back()}>Back</Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={printType === 'invoice' ? 'default' : 'outline'}
            onClick={() => updateType('invoice')}
          >
            Invoice Preview
          </Button>
          <Button
            variant={printType === 'dispatch' ? 'default' : 'outline'}
            onClick={() => updateType('dispatch')}
          >
            Dispatch Preview
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            Print {printType === 'invoice' ? 'Invoice' : 'Dispatch'}
          </Button>
          <Button onClick={() => router.push('/sales/list')}>Sales List</Button>
        </div>
      </div>

      {printType === 'invoice' ? (
        <InvoiceTemplate
          printData={printData}
          rows={invoiceRows}
        />
      ) : (
        <DispatchTemplate
          printData={printData}
          rows={dispatchRows}
        />
      )}
    </div>
  )
}

function InvoiceTemplate({
  printData,
  rows
}: {
  printData: SalesBillPrintData
  rows: Array<SalesBillPrintData['items'][number] | null>
}) {
  return (
    <div className="print-sheet border border-black bg-white">
      <div className="border-b border-black px-2 py-1 text-center text-[42px] font-black leading-none">
        {printData.companyName || '-'}
      </div>
      <div className="border-b border-black px-2 py-1 text-center text-[16px] font-semibold leading-tight">
        {printData.companyAddress || '-'}
      </div>
      <div className="border-b border-black px-2 py-1 text-right text-[11px] font-medium">
        Mobile: {printData.companyPhone || '-'}
      </div>

      <div className="grid grid-cols-2 border-b border-black text-[13px]">
        <div className="border-r border-black p-2">
          <div><span className="font-semibold">Inv. No.</span> {printData.billNo}</div>
          <div className="mt-2 font-semibold">M/s {printData.partyName || '-'}</div>
          <div className="font-semibold">{printData.partyAddress || '-'}</div>
          <div>{printData.partyContact ? `Mobile: ${printData.partyContact}` : ''}</div>
        </div>
        <div className="p-2">
          <div className="grid grid-cols-2 gap-x-4">
            <div className="font-semibold">Invoice Date</div>
            <div className="text-right font-semibold">{printData.billDateLabel}</div>
            <div className="font-semibold">Wagon Lorry No</div>
            <div className="text-right font-semibold">{printData.lorryNo || '-'}</div>
            <div className="font-semibold">Dispatch Date</div>
            <div className="text-right font-semibold">{printData.billDateLabel}</div>
            <div className="font-semibold">From</div>
            <div className="text-right font-semibold">{printData.companyAddress || '-'}</div>
            <div className="font-semibold">To</div>
            <div className="text-right font-semibold">{printData.partyAddress || '-'}</div>
          </div>
        </div>
      </div>

      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-black">
            <th className="w-[6%] border-r border-black px-1 py-0.5 text-left">S. No.</th>
            <th className="w-[24%] border-r border-black px-1 py-0.5 text-left">Description</th>
            <th className="w-[10%] border-r border-black px-1 py-0.5 text-right">No of Bags</th>
            <th className="w-[12%] border-r border-black px-1 py-0.5 text-right">Weight/Bag Qt</th>
            <th className="w-[14%] border-r border-black px-1 py-0.5 text-right">Weight Qt</th>
            <th className="w-[14%] border-r border-black px-1 py-0.5 text-right">Rate per Qt</th>
            <th className="w-[20%] px-1 py-0.5 text-right">Total Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={`invoice-row-${index}`} className="h-6 border-b border-black">
              <td className="border-r border-black px-1 py-0.5">{item ? index + 1 : ''}</td>
              <td className="border-r border-black px-1 py-0.5">{item?.productName || ''}</td>
              <td className="border-r border-black px-1 py-0.5 text-right">{item ? toFixed2(item.bags) : ''}</td>
              <td className="border-r border-black px-1 py-0.5 text-right">{item ? toFixed2(item.weightPerBagQt) : ''}</td>
              <td className="border-r border-black px-1 py-0.5 text-right">{item ? toFixed2(item.totalWeightQt) : ''}</td>
              <td className="border-r border-black px-1 py-0.5 text-right">{item ? toFixed2(item.ratePerQt) : ''}</td>
              <td className="px-1 py-0.5 text-right">{item ? toFixed2(item.lineTotal) : ''}</td>
            </tr>
          ))}
          <tr className="border-b border-black font-semibold">
            <td className="border-r border-black px-1 py-0.5" colSpan={2}>Total</td>
            <td className="border-r border-black px-1 py-0.5 text-right">{toFixed2(printData.totalBags)}</td>
            <td className="border-r border-black px-1 py-0.5 text-right">
              {printData.totalBags > 0 ? toFixed2(printData.totalWeightQt / printData.totalBags) : toFixed2(0)}
            </td>
            <td className="border-r border-black px-1 py-0.5 text-right">{toFixed2(printData.totalWeightQt)}</td>
            <td className="border-r border-black px-1 py-0.5 text-right">-</td>
            <td className="px-1 py-0.5 text-right">{toFixed2(printData.subTotalAmount + printData.gstAmount)}</td>
          </tr>
          <tr className="border-b border-black">
            <td className="border-r border-black px-1 py-0.5 font-semibold" colSpan={2}>Product Subtotal</td>
            <td className="border-r border-black px-1 py-0.5" colSpan={4}></td>
            <td className="px-1 py-0.5 text-right">{toFixed2(printData.subTotalAmount)}</td>
          </tr>
          <tr className="border-b border-black">
            <td className="border-r border-black px-1 py-0.5 font-semibold" colSpan={2}>GST Total</td>
            <td className="border-r border-black px-1 py-0.5" colSpan={4}></td>
            <td className="px-1 py-0.5 text-right">{toFixed2(printData.gstAmount)}</td>
          </tr>
          <tr className="border-b border-black">
            <td className="border-r border-black px-1 py-0.5 font-semibold" colSpan={2}>Freight</td>
            <td className="border-r border-black px-1 py-0.5" colSpan={4}></td>
            <td className="px-1 py-0.5 text-right">{toFixed2(printData.freightAmount)}</td>
          </tr>
          <tr className="border-b border-black">
            <td className="border-r border-black px-1 py-0.5 font-semibold" colSpan={2}>Other Charges</td>
            <td className="border-r border-black px-1 py-0.5" colSpan={4}></td>
            <td className="px-1 py-0.5 text-right">{toFixed2(printData.otherAmount)}</td>
          </tr>
          <tr className="border-b border-black">
            <td className="border-r border-black px-1 py-0.5 font-semibold" colSpan={2}>Insurance</td>
            <td className="border-r border-black px-1 py-0.5" colSpan={4}></td>
            <td className="px-1 py-0.5 text-right">{toFixed2(printData.insuranceAmount)}</td>
          </tr>
          <tr className="border-b border-black">
            <td className="border-r border-black px-1 py-0.5 font-semibold" colSpan={2}>Transport Advance</td>
            <td className="border-r border-black px-1 py-0.5" colSpan={4}></td>
            <td className="px-1 py-0.5 text-right">{toFixed2(printData.advance)}</td>
          </tr>
          <tr className="border-b border-black bg-gray-50">
            <td className="border-r border-black px-1 py-0.5 text-[15px] font-black" colSpan={2}>Grand Total</td>
            <td className="border-r border-black px-1 py-0.5" colSpan={4}></td>
            <td className="px-1 py-0.5 text-right text-[15px] font-black">{toFixed2(printData.totalAmount)}</td>
          </tr>
        </tbody>
      </table>

      <div className="border-b border-black px-2 py-1 text-[11px]">
        <span className="font-semibold">Banker:</span> Bank Name / A/c No / IFSC
      </div>
      <div className="border-b border-black px-2 py-1 text-[10px] leading-tight">
        <span className="font-semibold">Note:</span> All disputes subject to mandi rules and invoice terms.
      </div>
      <div className="px-2 py-2 text-right text-[12px] italic font-semibold">
        For: {printData.companyName || '-'}
      </div>
    </div>
  )
}

function DispatchTemplate({
  printData,
  rows
}: {
  printData: SalesBillPrintData
  rows: Array<SalesBillPrintData['items'][number] | null>
}) {
  return (
    <div className="print-sheet border border-black bg-white">
      <div className="border-b border-black px-2 py-1 text-center text-[42px] font-black leading-none">
        {printData.companyName || '-'}
      </div>
      <div className="border-b border-black px-2 py-1 text-center text-[16px] font-semibold leading-tight">
        {printData.companyAddress || '-'}
      </div>
      <div className="border-b border-black px-2 py-1 text-right text-[11px] font-medium">
        Mobile: {printData.companyPhone || '-'}
      </div>

      <div className="grid grid-cols-2 border-b border-black text-[13px]">
        <div className="border-r border-black px-2 py-1">
          <span className="font-semibold">No.</span> {printData.billNo}
        </div>
        <div className="px-2 py-1 text-right">
          <span className="font-semibold">Date</span> {printData.billDateLabel}
        </div>
      </div>

      <div className="grid grid-cols-3 border-b border-black text-[12px]">
        <div className="border-r border-black px-2 py-1"><span className="font-semibold">Goods Name</span>: {printData.items[0]?.productName || '-'}</div>
        <div className="border-r border-black px-2 py-1"><span className="font-semibold">Quantity</span>: {toFixed2(printData.totalBags)}</div>
        <div className="px-2 py-1"><span className="font-semibold">Value of Goods</span>: {toFixed2(printData.totalAmount)}</div>
      </div>

      <div className="grid grid-cols-2 border-b border-black text-[12px]">
        <div className="border-r border-black px-2 py-1"><span className="font-semibold">Dispatched to</span>: {printData.partyName || '-'}</div>
        <div className="px-2 py-1">{printData.partyAddress || '-'}</div>
      </div>

      <div className="grid grid-cols-2 border-b border-black text-[12px]">
        <div className="border-r border-black px-2 py-1"><span className="font-semibold">Lorry Number</span>: {printData.lorryNo || '-'}</div>
        <div className="px-2 py-1"><span className="font-semibold">Transport Name</span>: {printData.transportName || '-'}</div>
      </div>

      <div className="grid grid-cols-2 border-b border-black text-[12px]">
        <div className="border-r border-black px-2 py-1"><span className="font-semibold">Freight Per Qt</span>: {toFixed2(printData.freightPerQt)}</div>
        <div className="px-2 py-1"><span className="font-semibold">To Pay</span>: {toFixed2(printData.toPay)}</div>
      </div>

      <div className="border-b border-black px-2 py-1 text-center text-[13px] font-semibold">
        Goods Details
      </div>

      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-black">
            <th className="w-[8%] border-r border-black px-1 py-0.5 text-left">S.No.</th>
            <th className="w-[34%] border-r border-black px-1 py-0.5 text-left">Goods Details</th>
            <th className="w-[16%] border-r border-black px-1 py-0.5 text-right">No. of Bags</th>
            <th className="w-[20%] border-r border-black px-1 py-0.5 text-right">Weight/Bag Qt</th>
            <th className="w-[22%] px-1 py-0.5 text-right">Total Weight Qt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={`dispatch-row-${index}`} className="h-6 border-b border-black">
              <td className="border-r border-black px-1 py-0.5">{item ? index + 1 : ''}</td>
              <td className="border-r border-black px-1 py-0.5">{item?.productName || ''}</td>
              <td className="border-r border-black px-1 py-0.5 text-right">{item ? toFixed2(item.bags) : ''}</td>
              <td className="border-r border-black px-1 py-0.5 text-right">{item ? toFixed2(item.weightPerBagQt) : ''}</td>
              <td className="px-1 py-0.5 text-right">{item ? toFixed2(item.totalWeightQt) : ''}</td>
            </tr>
          ))}
          <tr className="border-b border-black font-semibold">
            <td className="border-r border-black px-1 py-0.5" colSpan={2}>Total</td>
            <td className="border-r border-black px-1 py-0.5 text-right">{toFixed2(printData.totalBags)}</td>
            <td className="border-r border-black px-1 py-0.5 text-right">
              {printData.totalBags > 0 ? toFixed2(printData.totalWeightQt / printData.totalBags) : toFixed2(0)}
            </td>
            <td className="px-1 py-0.5 text-right">{toFixed2(printData.totalWeightQt)}</td>
          </tr>
        </tbody>
      </table>

      <div className="border-b border-black px-2 py-1 text-[11px]">
        <span className="font-semibold">Banker:</span> Bank Name / A/c No / IFSC
      </div>
      <div className="border-b border-black px-2 py-1 text-[10px] leading-tight">
        <span className="font-semibold">Note:</span> Dispatch data generated from sales entry records.
      </div>
      <div className="px-2 py-2 text-right text-[12px] italic font-semibold">
        For: {printData.companyName || '-'}
      </div>
    </div>
  )
}
