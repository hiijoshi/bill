export interface PurchaseBillPrintData {
  id: string
  billNo: string
  billDateIso: string
  billDateLabel: string
  printDateLabel: string
  companyName: string
  companyAddress: string
  companyPhone: string
  mandiAccountNumber: string
  farmerName: string
  farmerAddress: string
  farmerContact: string
  krashakAnubandhNumber: string
  productName: string
  bags: number
  markaNo: string
  qty: number
  totalWeightQt: number
  rate: number
  hammali: number
  amount: number
  taxableAmount: number
  gstRate: number
  itemGstAmount: number
  lineTotal: number
  subTotalAmount: number
  gstAmount: number
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  status: string
  userUnitName: string
}

type PurchasePrintCompany = {
  name?: unknown
  address?: unknown
  phone?: unknown
  mandiAccountNumber?: unknown
}

type PurchasePrintFarmer = {
  name?: unknown
  address?: unknown
  phone1?: unknown
  krashakAnubandhNumber?: unknown
}

type PurchasePrintProduct = {
  name?: unknown
}

type PurchasePrintItem = {
  productNameSnapshot?: unknown
  product?: PurchasePrintProduct | null
  bags?: unknown
  markaNo?: unknown
  qty?: unknown
  totalWeightQt?: unknown
  rate?: unknown
  hammali?: unknown
  amount?: unknown
  taxableAmount?: unknown
  gstRateSnapshot?: unknown
  gstAmount?: unknown
  lineTotal?: unknown
  userUnitName?: unknown
}

type PurchaseBillPrintSource = {
  id?: unknown
  billNo?: unknown
  billDate?: unknown
  companyNameSnapshot?: unknown
  company?: PurchasePrintCompany | null
  mandiAccountNumberSnapshot?: unknown
  farmerNameSnapshot?: unknown
  farmerAddressSnapshot?: unknown
  farmerContactSnapshot?: unknown
  krashakAnubandhSnapshot?: unknown
  farmer?: PurchasePrintFarmer | null
  purchaseItems?: PurchasePrintItem[] | null
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

function toStringValue(value: unknown, fallback = ''): string {
  if (value == null) return fallback
  return String(value)
}

function toDateValue(value: unknown): string | Date | null {
  if (typeof value === 'string' || value instanceof Date) {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return null
}

export function formatDisplayDate(value: string | Date | null | undefined): string {
  const date = value ? new Date(value) : null
  if (!date || !Number.isFinite(date.getTime())) return '-'
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}-${month}-${year}`
}

export function mapPurchaseBillToPrintData(bill: PurchaseBillPrintSource | null | undefined): PurchaseBillPrintData {
  const item = Array.isArray(bill?.purchaseItems) ? bill.purchaseItems[0] : null

  const companyName = toStringValue(bill?.companyNameSnapshot ?? bill?.company?.name)
  const companyAddress = toStringValue(bill?.company?.address)
  const companyPhone = toStringValue(bill?.company?.phone)
  const mandiAccountNumber = toStringValue(bill?.mandiAccountNumberSnapshot ?? bill?.company?.mandiAccountNumber)

  const farmerName = toStringValue(bill?.farmerNameSnapshot ?? bill?.farmer?.name)
  const farmerAddress = toStringValue(bill?.farmerAddressSnapshot ?? bill?.farmer?.address)
  const farmerContact = toStringValue(bill?.farmerContactSnapshot ?? bill?.farmer?.phone1)
  const krashakAnubandhNumber = toStringValue(bill?.krashakAnubandhSnapshot ?? bill?.farmer?.krashakAnubandhNumber)

  const productName = toStringValue(item?.productNameSnapshot ?? item?.product?.name)

  return {
    id: String(bill?.id || ''),
    billNo: String(bill?.billNo || ''),
    billDateIso: String(bill?.billDate || ''),
    billDateLabel: formatDisplayDate(toDateValue(bill?.billDate)),
    printDateLabel: formatDisplayDate(new Date()),
    companyName,
    companyAddress,
    companyPhone,
    mandiAccountNumber,
    farmerName,
    farmerAddress,
    farmerContact,
    krashakAnubandhNumber,
    productName,
    bags: Math.max(0, Math.round(toNumber(item?.bags, 0))),
    markaNo: toStringValue(item?.markaNo),
    qty: Math.max(0, toNumber(item?.qty, 0)),
    totalWeightQt: Math.max(0, toNumber(item?.totalWeightQt ?? item?.qty, 0)),
    rate: Math.max(0, toNumber(item?.rate, 0)),
    hammali: Math.max(0, toNumber(item?.hammali, 0)),
    amount: Math.max(0, toNumber(item?.amount, 0)),
    taxableAmount: Math.max(0, toNumber(item?.taxableAmount ?? item?.amount, 0)),
    gstRate: Math.max(0, toNumber(item?.gstRateSnapshot, 0)),
    itemGstAmount: Math.max(0, toNumber(item?.gstAmount, 0)),
    lineTotal: Math.max(0, toNumber(item?.lineTotal ?? item?.amount, 0)),
    subTotalAmount: Math.max(0, toNumber(bill?.subTotalAmount ?? item?.taxableAmount ?? item?.amount, 0)),
    gstAmount: Math.max(0, toNumber(bill?.gstAmount ?? item?.gstAmount, 0)),
    totalAmount: Math.max(0, toNumber(bill?.totalAmount, 0)),
    paidAmount: Math.max(0, toNumber(bill?.paidAmount, 0)),
    balanceAmount: Math.max(0, toNumber(bill?.balanceAmount, 0)),
    status: toStringValue(bill?.status, 'unpaid'),
    userUnitName: toStringValue(item?.userUnitName)
  }
}
