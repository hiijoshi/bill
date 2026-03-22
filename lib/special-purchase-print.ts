import { formatDisplayDate } from '@/lib/purchase-print'

export interface SpecialPurchaseBillPrintData {
  id: string
  invoiceNo: string
  billDateIso: string
  billDateLabel: string
  printDateLabel: string
  companyName: string
  companyAddress: string
  companyPhone: string
  mandiAccountNumber: string
  supplierName: string
  supplierAddress: string
  supplierContact: string
  supplierGstNumber: string
  productName: string
  bags: number
  weight: number
  rate: number
  netAmount: number
  taxableAmount: number
  gstRate: number
  gstAmount: number
  otherAmount: number
  grossAmount: number
  subTotalAmount: number
  totalGstAmount: number
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  status: string
}

type SpecialPurchaseBillLike = {
  id?: unknown
  supplierInvoiceNo?: unknown
  billDate?: unknown
  company?: {
    name?: unknown
    address?: unknown
    phone?: unknown
    mandiAccountNumber?: unknown
  } | null
  supplier?: {
    name?: unknown
    address?: unknown
    phone1?: unknown
    gstNumber?: unknown
  } | null
  specialPurchaseItems?: Array<{
    noOfBags?: unknown
    weight?: unknown
    rate?: unknown
    netAmount?: unknown
    taxableAmount?: unknown
    gstRateSnapshot?: unknown
    gstAmount?: unknown
    otherAmount?: unknown
    grossAmount?: unknown
    product?: {
      name?: unknown
    } | null
  }> | null
  subTotalAmount?: unknown
  gstAmount?: unknown
  totalAmount?: unknown
  paidAmount?: unknown
  balanceAmount?: unknown
  status?: unknown
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

function toDateInput(value: unknown): string | Date | null | undefined {
  if (value instanceof Date) return value
  if (typeof value === 'string') return value
  return null
}

export function mapSpecialPurchaseBillToPrintData(bill: SpecialPurchaseBillLike): SpecialPurchaseBillPrintData {
  const item = Array.isArray(bill?.specialPurchaseItems) ? bill.specialPurchaseItems[0] : null

  return {
    id: String(bill?.id || ''),
    invoiceNo: String(bill?.supplierInvoiceNo || ''),
    billDateIso: String(bill?.billDate || ''),
    billDateLabel: formatDisplayDate(toDateInput(bill?.billDate)),
    printDateLabel: formatDisplayDate(new Date()),
    companyName: String(bill?.company?.name || ''),
    companyAddress: String(bill?.company?.address || ''),
    companyPhone: String(bill?.company?.phone || ''),
    mandiAccountNumber: String(bill?.company?.mandiAccountNumber || ''),
    supplierName: String(bill?.supplier?.name || ''),
    supplierAddress: String(bill?.supplier?.address || ''),
    supplierContact: String(bill?.supplier?.phone1 || ''),
    supplierGstNumber: String(bill?.supplier?.gstNumber || ''),
    productName: String(item?.product?.name || ''),
    bags: Math.max(0, toNumber(item?.noOfBags, 0)),
    weight: Math.max(0, toNumber(item?.weight, 0)),
    rate: Math.max(0, toNumber(item?.rate, 0)),
    netAmount: Math.max(0, toNumber(item?.netAmount, 0)),
    taxableAmount: Math.max(0, toNumber(item?.taxableAmount ?? item?.netAmount, 0)),
    gstRate: Math.max(0, toNumber(item?.gstRateSnapshot, 0)),
    gstAmount: Math.max(0, toNumber(item?.gstAmount, 0)),
    otherAmount: Math.max(0, toNumber(item?.otherAmount, 0)),
    grossAmount: Math.max(0, toNumber(item?.grossAmount, 0)),
    subTotalAmount: Math.max(0, toNumber(bill?.subTotalAmount ?? item?.taxableAmount ?? item?.netAmount, 0)),
    totalGstAmount: Math.max(0, toNumber(bill?.gstAmount ?? item?.gstAmount, 0)),
    totalAmount: Math.max(0, toNumber(bill?.totalAmount, 0)),
    paidAmount: Math.max(0, toNumber(bill?.paidAmount, 0)),
    balanceAmount: Math.max(0, toNumber(bill?.balanceAmount, 0)),
    status: String(bill?.status || 'unpaid')
  }
}
