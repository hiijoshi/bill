'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { SalesBillPrintData } from '@/lib/sales-print'

type Props = {
  printData: SalesBillPrintData
}

export type PrintType = 'invoice' | 'dispatch'
export type InvoiceCopyVariant = 'original' | 'duplicate'

const toFixed2 = (value: number) => value.toFixed(2)

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

function getInvoiceCopyHint(copyVariant: InvoiceCopyVariant) {
  return copyVariant === 'duplicate' ? 'Duplicate For Transporter' : 'Original For Recipient'
}

function createRows<T>(items: T[], minRows: number): Array<T | null> {
  const rows: Array<T | null> = [...items]
  while (rows.length < minRows) rows.push(null)
  return rows
}

function formatCurrency(value: number): string {
  return currencyFormatter.format(Number(value || 0))
}

function formatRate(value: number): string {
  return currencyFormatter.format(Number(value || 0))
}

function toWordsUnder1000(value: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  if (value <= 0) return ''
  if (value < 10) return ones[value]
  if (value < 20) return teens[value - 10]
  if (value < 100) {
    return [tens[Math.floor(value / 10)], ones[value % 10]].filter(Boolean).join(' ')
  }
  return [ones[Math.floor(value / 100)], 'Hundred', toWordsUnder1000(value % 100)].filter(Boolean).join(' ')
}

function numberToIndianWords(value: number): string {
  const normalized = Math.max(0, Math.floor(Number(value || 0)))
  if (normalized === 0) return 'Zero'

  const segments: Array<[number, string]> = [
    [10000000, 'Crore'],
    [100000, 'Lakh'],
    [1000, 'Thousand']
  ]

  let remaining = normalized
  const words: string[] = []

  for (const [divisor, label] of segments) {
    const quotient = Math.floor(remaining / divisor)
    if (quotient > 0) {
      words.push(toWordsUnder1000(quotient), label)
      remaining %= divisor
    }
  }

  if (remaining > 0) {
    words.push(toWordsUnder1000(remaining))
  }

  return words.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

function formatAmountInWords(value: number): string {
  const normalized = Math.max(0, Number(value || 0))
  const rupees = Math.floor(normalized)
  const paise = Math.round((normalized - rupees) * 100)
  const rupeeWords = numberToIndianWords(rupees)
  if (paise <= 0) return `INR ${rupeeWords} Only`
  return `INR ${rupeeWords} and ${numberToIndianWords(paise)} Paise Only`
}

export default function SalesPrintClient({ printData }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [printType, setPrintType] = useState<PrintType>(
    () =>
      searchParams.get('type') === 'dispatch' && printData.invoiceKind !== 'split_parent' ? 'dispatch' : 'invoice'
  )
  const shouldAutoPrint = searchParams.get('autoprint') === '1'
  const [invoiceCopyVariant, setInvoiceCopyVariant] = useState<InvoiceCopyVariant>(() => {
    const copy = searchParams.get('copy')
    const legacyPart = searchParams.get('part')
    return copy === 'duplicate' || legacyPart === '17(B)' ? 'duplicate' : 'original'
  })
  const canDispatchPreview = printData.invoiceKind !== 'split_parent'

  const updateType = (nextType: PrintType) => {
    if (nextType === 'dispatch' && !canDispatchPreview) {
      return
    }
    setPrintType(nextType)
    const currentUrl = new URL(window.location.href)
    currentUrl.searchParams.set('type', nextType)
    window.history.replaceState({}, '', `${currentUrl.pathname}?${currentUrl.searchParams.toString()}`)
  }

  const updateInvoiceCopyVariant = (nextVariant: InvoiceCopyVariant) => {
    setInvoiceCopyVariant(nextVariant)
    const currentUrl = new URL(window.location.href)
    currentUrl.searchParams.set('copy', nextVariant)
    currentUrl.searchParams.delete('part')
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

  useEffect(() => {
    if (canDispatchPreview || printType !== 'dispatch') return
    updateType('invoice')
  }, [canDispatchPreview, printType])

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
            disabled={!canDispatchPreview}
          >
            Dispatch Preview
          </Button>
          {printType === 'invoice' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={invoiceCopyVariant === 'original' ? 'default' : 'outline'}
                onClick={() => updateInvoiceCopyVariant('original')}
              >
                Original
              </Button>
              <Button
                variant={invoiceCopyVariant === 'duplicate' ? 'default' : 'outline'}
                onClick={() => updateInvoiceCopyVariant('duplicate')}
              >
                Duplicate
              </Button>
            </div>
          ) : null}
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
          copyLabel={invoiceCopyVariant === 'duplicate' ? 'Duplicate Copy' : 'Original Copy'}
          copyHint={getInvoiceCopyHint(invoiceCopyVariant)}
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

export function InvoiceTemplate({
  printData,
  rows,
  copyLabel,
  copyHint
}: {
  printData: SalesBillPrintData
  rows: Array<SalesBillPrintData['items'][number] | null>
  copyLabel?: string
  copyHint?: string
}) {
  const cgstAmount = printData.gstAmount > 0 ? printData.gstAmount / 2 : 0
  const sgstAmount = printData.gstAmount > 0 ? printData.gstAmount / 2 : 0
  const amountInWords = formatAmountInWords(printData.totalAmount)
  const totalLineAmount = printData.items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0)
  const isSplitParent = printData.invoiceKind === 'split_parent'
  const isSplitChild = printData.invoiceKind === 'split_child'

  return (
    <div className="print-sheet border border-black bg-white text-[11px]">
      <div className="flex items-center justify-between border-b border-black px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
        <span>Tax Invoice</span>
        <span className="text-[10px] font-medium italic tracking-[0.12em]">
          {copyLabel ? `${copyLabel} / ` : ''}
          ({copyHint || 'Original For Recipient'})
        </span>
      </div>

      <div className="border-b border-black px-3 py-2 text-center">
        <div className="text-[18px] font-bold tracking-tight">{printData.companyName || '-'}</div>
        <div className="mt-1 text-[11px] leading-snug">{printData.companyAddress || '-'}</div>
        <div className="mt-1 text-[11px]">Contact: {printData.companyPhone || '-'}</div>
        {printData.companyBankDisplay ? (
          <div className="mt-1 text-[10px]">Bank Details: {printData.companyBankDisplay}</div>
        ) : null}
      </div>

      {isSplitParent || isSplitChild ? (
        <div className="border-b border-black bg-slate-50 px-3 py-2 text-[10.5px]">
          {isSplitParent ? (
            <div className="flex items-center justify-between gap-4">
              <span className="font-semibold uppercase tracking-[0.12em]">Parent Summary Invoice</span>
              <span>{printData.childBills.length} split part(s) linked to this invoice</span>
            </div>
          ) : (
            <div className="grid grid-cols-[132px_1fr] gap-y-1">
              <span className="font-semibold">Parent Invoice Ref</span>
              <span>{printData.parentBillNo || '-'}</span>
              <span className="font-semibold">Split Part</span>
              <span>{printData.splitPartLabel || printData.splitSuffix || '-'}</span>
            </div>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-[1.4fr_0.8fr] border-b border-black">
        <div className="border-r border-black px-3 py-2">
          <div className="grid grid-cols-[64px_10px_1fr] gap-y-0.5">
            <div className="font-semibold">Buyer</div>
            <div>:</div>
            <div className="font-semibold">{printData.partyName || '-'}</div>
            <div className="font-semibold">Address</div>
            <div>:</div>
            <div>{printData.partyAddress || '-'}</div>
            <div className="font-semibold">Mobile</div>
            <div>:</div>
            <div>{printData.partyContact || '-'}</div>
            <div className="font-semibold">Dispatch</div>
            <div>:</div>
            <div>{printData.transportName || printData.lorryNo ? `${printData.transportName || 'Transport'} / ${printData.lorryNo || '-'}` : '-'}</div>
          </div>
        </div>
        <div className="px-3 py-2">
          <div className="grid grid-cols-[88px_10px_1fr] gap-y-0.5">
            <div className="font-semibold">Invoice No.</div>
            <div>:</div>
            <div className="font-semibold">{printData.billNo || '-'}</div>
            {isSplitChild ? (
              <>
                <div className="font-semibold">Parent Ref.</div>
                <div>:</div>
                <div>{printData.parentBillNo || '-'}</div>
              </>
            ) : null}
            <div className="font-semibold">Dated</div>
            <div>:</div>
            <div>{printData.billDateLabel}</div>
            <div className="font-semibold">Lorry No.</div>
            <div>:</div>
            <div>{printData.lorryNo || '-'}</div>
            <div className="font-semibold">Print Date</div>
            <div>:</div>
            <div>{printData.printDateLabel}</div>
          </div>
        </div>
      </div>

      <table className="w-full border-collapse text-[10.5px]">
        <thead>
          <tr className="border-b border-black">
            <th className="w-[5%] border-r border-black px-1 py-1 text-left font-semibold">Sl</th>
            <th className="w-[35%] border-r border-black px-1 py-1 text-left font-semibold">Description of Goods</th>
            <th className="w-[10%] border-r border-black px-1 py-1 text-right font-semibold">GST %</th>
            <th className="w-[12%] border-r border-black px-1 py-1 text-right font-semibold">Quantity</th>
            <th className="w-[14%] border-r border-black px-1 py-1 text-right font-semibold">Weight (Qt)</th>
            <th className="w-[12%] border-r border-black px-1 py-1 text-right font-semibold">Rate</th>
            <th className="w-[12%] px-1 py-1 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={`invoice-row-${index}`} className="h-6 align-top">
              <td className="border-r border-black px-1 py-0.5">{item ? index + 1 : ''}</td>
              <td className="border-r border-black px-1 py-0.5">{item?.productName || ''}</td>
              <td className="border-r border-black px-1 py-0.5 text-right">{item ? `${Number(item.gstRate || 0).toFixed(0)}%` : ''}</td>
              <td className="border-r border-black px-1 py-0.5 text-right">{item ? `${toFixed2(item.bags)} bags` : ''}</td>
              <td className="border-r border-black px-1 py-0.5 text-right">{item ? toFixed2(item.totalWeightQt) : ''}</td>
              <td className="border-r border-black px-1 py-0.5 text-right">{item ? formatRate(item.ratePerQt) : ''}</td>
              <td className="px-1 py-0.5 text-right">{item ? formatCurrency(item.lineTotal) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-black">
            <td className="border-r border-black px-1 py-1 font-semibold" colSpan={3}>Total</td>
            <td className="border-r border-black px-1 py-1 text-right font-semibold">{toFixed2(printData.totalBags)} bags</td>
            <td className="border-r border-black px-1 py-1 text-right font-semibold">{toFixed2(printData.totalWeightQt)}</td>
            <td className="border-r border-black px-1 py-1 text-right font-semibold">-</td>
            <td className="px-1 py-1 text-right font-semibold">{formatCurrency(totalLineAmount)}</td>
          </tr>
          <tr>
            <td className="border-r border-black px-1 py-0.5" colSpan={6}>Taxable Amount</td>
            <td className="px-1 py-0.5 text-right">{formatCurrency(printData.subTotalAmount)}</td>
          </tr>
          <tr>
            <td className="border-r border-black px-1 py-0.5" colSpan={6}>CGST</td>
            <td className="px-1 py-0.5 text-right">{formatCurrency(cgstAmount)}</td>
          </tr>
          <tr>
            <td className="border-r border-black px-1 py-0.5" colSpan={6}>SGST</td>
            <td className="px-1 py-0.5 text-right">{formatCurrency(sgstAmount)}</td>
          </tr>
          <tr>
            <td className="border-r border-black px-1 py-0.5" colSpan={6}>Freight</td>
            <td className="px-1 py-0.5 text-right">{formatCurrency(printData.freightAmount)}</td>
          </tr>
          {printData.additionalCharges.length > 0 ? (
            printData.additionalCharges.map((charge, index) => (
              <tr key={`additional-charge-${index}`}>
                <td className="border-r border-black px-1 py-0.5" colSpan={6}>
                  {charge.chargeType}
                  {charge.remark ? ` - ${charge.remark}` : ''}
                </td>
                <td className="px-1 py-0.5 text-right">{formatCurrency(charge.amount)}</td>
              </tr>
            ))
          ) : (
            <>
              <tr>
                <td className="border-r border-black px-1 py-0.5" colSpan={6}>Other Charges</td>
                <td className="px-1 py-0.5 text-right">{formatCurrency(printData.otherAmount)}</td>
              </tr>
              <tr>
                <td className="border-r border-black px-1 py-0.5" colSpan={6}>Insurance</td>
                <td className="px-1 py-0.5 text-right">{formatCurrency(printData.insuranceAmount)}</td>
              </tr>
            </>
          )}
          <tr>
            <td className="border-r border-black px-1 py-0.5" colSpan={6}>Advance</td>
            <td className="px-1 py-0.5 text-right">{formatCurrency(printData.advance)}</td>
          </tr>
          <tr className="border-t border-black">
            <td className="border-r border-black px-1 py-1 text-[13px] font-bold" colSpan={6}>Grand Total</td>
            <td className="px-1 py-1 text-right text-[13px] font-bold">₹ {formatCurrency(printData.totalAmount)}</td>
          </tr>
        </tfoot>
      </table>

      {isSplitParent && printData.childBills.length > 0 ? (
        <div className="border-t border-black">
          <div className="border-b border-black px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]">
            Split Parts Summary
          </div>
          <table className="w-full border-collapse text-[10.5px]">
            <thead>
              <tr className="border-b border-black">
                <th className="border-r border-black px-2 py-1 text-left">Part Invoice</th>
                <th className="border-r border-black px-2 py-1 text-left">Part Label</th>
                <th className="border-r border-black px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {printData.childBills.map((child) => (
                <tr key={child.id} className="border-b border-black">
                  <td className="border-r border-black px-2 py-1">{child.billNo || '-'}</td>
                  <td className="border-r border-black px-2 py-1">{child.splitPartLabel || child.splitSuffix || '-'}</td>
                  <td className="border-r border-black px-2 py-1 uppercase">{child.status || '-'}</td>
                  <td className="px-2 py-1 text-right">{formatCurrency(child.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-b border-black px-3 py-2 text-[10px] italic leading-snug">
            This parent invoice is a logical summary only. Operational posting and settlement flow through the split child invoices above.
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-[1.1fr_0.9fr] border-t border-black">
        <div className="border-r border-black px-3 py-2">
          <div className="border-b border-black pb-2">
            <span className="font-semibold">Amount in Words :</span> {amountInWords}
          </div>
          <div className="pt-2 text-[10px] italic leading-snug">
            Declaration : We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.
          </div>
          {printData.companyBankDisplay ? (
            <div className="mt-3 rounded border border-black px-2 py-2 text-[10px] leading-snug">
              <span className="font-semibold">Bank Details:</span> {printData.companyBankDisplay}
            </div>
          ) : null}
        </div>
        <div className="px-3 py-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
            <div>Received</div>
            <div className="text-right">{formatCurrency(printData.receivedAmount)}</div>
            <div>Balance</div>
            <div className="text-right">{formatCurrency(printData.balanceAmount)}</div>
            <div>Status</div>
            <div className="text-right uppercase">{printData.status || '-'}</div>
          </div>
          <div className="mt-8 text-right text-[11px] font-semibold">
            For {printData.companyName || '-'}
          </div>
          <div className="mt-8 text-right text-[11px]">Authorised Signatory</div>
        </div>
      </div>
    </div>
  )
}

export function DispatchTemplate({
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

      <div className="grid grid-cols-2 gap-2 px-2 py-2 text-[13px]">
        <div>
          <span className="font-semibold">No.</span> {printData.billNo}
        </div>
        <div className="text-right">
          <span className="font-semibold">Date</span> {printData.billDateLabel}
        </div>
      </div>

      {printData.invoiceKind === 'split_child' ? (
        <div className="px-2 py-1 text-[11px]">
          <span className="font-semibold">Parent Invoice Ref:</span> {printData.parentBillNo || '-'}
        </div>
      ) : null}

      {printData.invoiceKind === 'split_parent' ? (
        <div className="border-b border-black px-2 py-1 text-[11px] italic">
          Dispatch execution should be printed from child split invoices. This parent invoice is a summary reference.
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2 border-t border-black px-2 py-2 text-[12px]">
        <div><span className="font-semibold">Goods Name</span>: {printData.items[0]?.productName || '-'}</div>
        <div><span className="font-semibold">Quantity</span>: {toFixed2(printData.totalBags)}</div>
        <div><span className="font-semibold">Value of Goods</span>: {toFixed2(printData.totalAmount)}</div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-2 py-1 text-[12px]">
        <div><span className="font-semibold">Dispatched to</span>: {printData.partyName || '-'}</div>
        <div>{printData.partyAddress || '-'}</div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-2 py-1 text-[12px]">
        <div><span className="font-semibold">Lorry Number</span>: {printData.lorryNo || '-'}</div>
        <div><span className="font-semibold">Transport Name</span>: {printData.transportName || '-'}</div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-2 py-1 text-[12px]">
        <div><span className="font-semibold">Freight Per Qt</span>: {toFixed2(printData.freightPerQt)}</div>
        <div><span className="font-semibold">To Pay</span>: {toFixed2(printData.toPay)}</div>
      </div>

      <div className="border-y border-black px-2 py-1 text-center text-[13px] font-semibold">
        Goods Details
      </div>

      <table className="w-full text-[12px]">
        <thead>
          <tr>
            <th className="w-[8%] px-1 py-1 text-left">S.No.</th>
            <th className="w-[34%] px-1 py-1 text-left">Goods Details</th>
            <th className="w-[16%] px-1 py-1 text-right">No. of Bags</th>
            <th className="w-[20%] px-1 py-1 text-right">Weight/Bag Qt</th>
            <th className="w-[22%] px-1 py-1 text-right">Total Weight Qt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={`dispatch-row-${index}`} className="h-6">
              <td className="px-1 py-0.5">{item ? index + 1 : ''}</td>
              <td className="px-1 py-0.5">{item?.productName || ''}</td>
              <td className="px-1 py-0.5 text-right">{item ? toFixed2(item.bags) : ''}</td>
              <td className="px-1 py-0.5 text-right">{item ? toFixed2(item.weightPerBagQt) : ''}</td>
              <td className="px-1 py-0.5 text-right">{item ? toFixed2(item.totalWeightQt) : ''}</td>
            </tr>
          ))}
          <tr className="border-t border-black font-semibold">
            <td className="px-1 py-1" colSpan={2}>Total</td>
            <td className="px-1 py-1 text-right">{toFixed2(printData.totalBags)}</td>
            <td className="px-1 py-1 text-right">
              {printData.totalBags > 0 ? toFixed2(printData.totalWeightQt / printData.totalBags) : toFixed2(0)}
            </td>
            <td className="px-1 py-1 text-right">{toFixed2(printData.totalWeightQt)}</td>
          </tr>
        </tbody>
      </table>

      <div className="border-t border-black px-2 py-1 text-[11px]">
        <span className="font-semibold">Banker:</span> {printData.companyBankDisplay || '-'}
      </div>
      <div className="px-2 py-1 text-[10px] leading-tight">
        <span className="font-semibold">Note:</span> Dispatch data generated from sales entry records.
      </div>
      <div className="px-2 py-2 text-right text-[12px] italic font-semibold">
        For: {printData.companyName || '-'}
      </div>
    </div>
  )
}
