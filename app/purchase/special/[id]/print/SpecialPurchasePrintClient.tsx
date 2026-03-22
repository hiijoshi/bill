'use client'

import { useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import type { SpecialPurchaseBillPrintData } from '@/lib/special-purchase-print'

type Props = {
  printData: SpecialPurchaseBillPrintData
}

export default function SpecialPurchasePrintClient({ printData }: Props) {
  const router = useRouter()

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.print()
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [])

  const payableToSupplier = useMemo(() => {
    return Math.max(0, printData.totalAmount)
  }, [printData.totalAmount])

  return (
    <div className="print-root bg-white p-4 text-black print:p-0">
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          html, body {
            margin: 0;
            padding: 0;
            width: 210mm;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          @page { size: A4 portrait; margin: 0; }
          .print-root {
            width: 210mm;
            margin: 0;
            padding: 0;
          }
          .half-a4-sheet {
            width: 210mm;
            min-height: 132mm;
            box-sizing: border-box;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .print-shadow {
            text-shadow: 0.6px 0.6px 0 rgba(0, 0, 0, 0.28);
          }
        }
      `}</style>

      <div className="no-print mb-4 flex items-center justify-between">
        <Button variant="outline" onClick={() => router.back()}>Back</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>Print</Button>
          <Button onClick={() => router.push('/purchase/list')}>Purchase List</Button>
        </div>
      </div>

      <div className="half-a4-sheet mx-auto border-x border-t border-black">
        <div className="print-shadow border-b border-black py-1 text-center text-[26px] font-black leading-none print:text-[22px]">
          {printData.companyName || '-'}
        </div>
        <div className="print-shadow border-b border-black py-1 text-center text-[16px] font-bold leading-none print:text-[14px]">
          {printData.companyAddress || '-'}
        </div>

        <div className="grid grid-cols-3 border-b border-black text-[14px] font-bold print:text-[12px]">
          <div className="border-r border-black p-1 print:p-[2px]">
            सप्लायर-की-प्रति
            <div className="mt-0.5 text-[12px] font-semibold print:text-[10px]">दिनांक : {printData.billDateLabel}</div>
          </div>
          <div className="border-r border-black p-1 text-center print:p-[2px]">
            विशेष खरीद भुगतान पत्रक
            <div className="text-[11px] font-semibold print:text-[9px]">(विशेष खरीद - सप्लायर)</div>
            <div className="mt-0.5 text-[12px] font-bold print:text-[10px]">मंडी अकाउंट नंबर : {printData.mandiAccountNumber || '-'}</div>
          </div>
          <div className="p-1 text-[12px] font-semibold print:p-[2px] print:text-[10px]">
            <div>प्रिंट दिनांक : {printData.printDateLabel}</div>
            <div>इनवॉइस नं : {printData.invoiceNo || '-'}</div>
          </div>
        </div>

        <div className="grid grid-cols-4 border-b border-black text-[12px] font-medium print:text-[10px]">
          <div className="border-r border-black p-1 print:p-[2px]">बिल दिनांक : {printData.billDateLabel}</div>
          <div className="border-r border-black p-1 print:p-[2px]">सप्लायर का नाम : {printData.supplierName || '-'}</div>
          <div className="border-r border-black p-1 print:p-[2px]">सप्लायर का पता : {printData.supplierAddress || '-'}</div>
          <div className="p-1 print:p-[2px]">मोबाइल नंबर : {printData.supplierContact || '-'}</div>
        </div>

        <div className="grid grid-cols-6 border-b border-black text-[12px] font-medium print:text-[10px]">
          <div className="border-r border-black p-1 print:p-[2px]">कृषि उपज का नाम : {printData.productName || '-'}</div>
          <div className="border-r border-black p-1 print:p-[2px]">बैग : {printData.bags.toFixed(2)}</div>
          <div className="border-r border-black p-1 print:p-[2px]">वजन (क्विंटल) : {printData.weight.toFixed(2)}</div>
          <div className="border-r border-black p-1 print:p-[2px]">दर : ₹ {printData.rate.toFixed(2)}</div>
          <div className="border-r border-black p-1 print:p-[2px]">टैक्सेबल राशि : ₹ {printData.taxableAmount.toFixed(2)}</div>
          <div className="p-1 print:p-[2px]">ग्रॉस राशि : ₹ {printData.grossAmount.toFixed(2)}</div>
        </div>

        <div className="grid grid-cols-4 border-b border-black text-[12px] font-medium print:text-[10px]">
          <div className="border-r border-black p-1 print:p-[2px]">अन्य राशि : ₹ {printData.otherAmount.toFixed(2)}</div>
          <div className="border-r border-black p-1 print:p-[2px]">GST राशि : ₹ {printData.totalGstAmount.toFixed(2)}</div>
          <div className="border-r border-black p-1 print:p-[2px]">GST नंबर : {printData.supplierGstNumber || '-'}</div>
          <div className="p-1 print:p-[2px]">सप्लायर को भुगतान योग्य राशि : ₹ {payableToSupplier.toFixed(2)}</div>
        </div>

        <div className="border-b border-black p-1 text-[12px] font-semibold print:p-[2px] print:text-[10px]">
          सप्लायर को भुगतान की गई राशि (भुगतान : नगद भुगतान)
        </div>

        <div className="grid grid-cols-4 border-b border-black text-[12px] font-medium print:text-[10px]">
          <div className="border-r border-black p-1 print:p-[2px]">नकद भुगतान की गई राशि :</div>
          <div className="print-shadow border-r border-black p-1 text-[32px] font-black leading-none print:p-[2px] print:text-[24px]">
            ₹ {printData.paidAmount.toFixed(2)}
          </div>
          <div className="border-r border-black p-1 print:p-[2px]">RTGS/NEFT/ऑनलाइन बैंकिंग से भुगतान राशि यूटीआर विवरण :</div>
          <div className="p-1 print:p-[2px]">
            <div>बैंक : -</div>
            <div>आईएफएससी : -</div>
            <div>UTR/Transaction Ref: -</div>
          </div>
        </div>

        <div className="grid grid-cols-3 border-b border-black text-[12px] font-medium print:text-[10px]">
          <div className="border-r border-black p-1 print:p-[2px]">कंपनी : {printData.companyName || '-'}</div>
          <div className="border-r border-black p-1 print:p-[2px]">सप्लायर इनवॉइस नं : {printData.invoiceNo || '-'}</div>
          <div className="p-1 print:p-[2px]">स्थिति : {printData.status}</div>
        </div>

        <div className="grid grid-cols-3 border-b border-black text-[12px] font-medium print:text-[10px]">
          <div className="border-r border-black p-1 print:p-[2px]">सबटोटल : ₹ {printData.subTotalAmount.toFixed(2)}</div>
          <div className="border-r border-black p-1 print:p-[2px]">कुल GST : ₹ {printData.totalGstAmount.toFixed(2)}</div>
          <div className="p-1 print:p-[2px]">फाइनल इनवॉइस टोटल : ₹ {printData.totalAmount.toFixed(2)}</div>
        </div>

        <div className="grid grid-cols-3 border-b border-black text-[12px] font-medium print:text-[10px]">
          <div className="border-r border-black p-1 print:p-[2px]">लाइन ग्रॉस : ₹ {printData.grossAmount.toFixed(2)}</div>
          <div className="border-r border-black p-1 print:p-[2px]">शेष राशि : ₹ {printData.balanceAmount.toFixed(2)}</div>
          <div className="p-1 print:p-[2px]">कंपनी फोन : {printData.companyPhone || '-'}</div>
        </div>

        <div className="grid grid-cols-2 border-b border-black text-[12px] font-semibold print:text-[10px]">
          <div className="border-r border-black p-3 text-center print:p-[6px]">क्रेता के हस्ताक्षर</div>
          <div className="p-3 text-center print:p-[6px]">विक्रेता / सप्लायर के हस्ताक्षर</div>
        </div>

        <div className="border-t border-b border-black p-1 text-[10px] leading-tight print:p-[2px] print:text-[8px]">
          <div className="font-bold">नोट :</div>
          <div>
            1. म. प्र. कृषि उपज मंडी अधिनियम, 1972 की धारा 37(2) (क)-मंडी प्रांगण में क्रय की गई कृषि उपज की कीमत का
            भुगतान विक्रेता को उसी दिन मंडी प्रांगण में किया जायेगा। धारा 37(2) (ख)-यदि क्रेता खंड (क) के अधीन भुगतान
            नहीं करता है तो वह विक्रेता को देय कृषि उपज की कुल कीमत के 1 प्रतिशत प्रतिदिन की दर से अतिरिक्त भुगतान पांच
            दिन के भीतर करने का दायी होगा। धारा 37(2) (ग) यदि क्रेता उपरोक्त खंड (क) तथा (ख) के अधीन विक्रेता को भुगतान
            के साथ अतिरिक्त भुगतान ऐसे क्रय के दिन से पांच दिन के भीतर नहीं करता है तो उसकी अनुज्ञप्ति छठवें दिन को रद्द
            कर दी गई समझी जायेगी और उसे या उसके नातेदार (धारा 11 की उपधारा (1) के खंड (क) के स्पष्टीकरण में विनिर्दिष्ट
            अभिप्रेत अनुसार) को ऐसे प्रकरण की तारीख से एक वर्ष की कालावधि के लिये इस अधिनियम के अधीन कोई अनुज्ञा मंजूर
            नहीं की जायेगी।
          </div>
          <div>2. क्रेता द्वारा विक्रेता/सप्लायर की किसी भी स्थिति में भुगतान हेतु चेक जारी नहीं किये जा सकेंगे।</div>
          <div>
            3. आरटीजीएस/एनईएफटी/ऑनलाइन बैंकिंग के माध्यम से राशि विक्रेता/सप्लायर के खाते में स्थानांतरण के प्रमाणीकरण
            स्वरूप संबंधित बैंक की जमा पर्ची/रसीद व यूटीआर नंबर संलग्न करें।
          </div>
        </div>
      </div>
    </div>
  )
}
