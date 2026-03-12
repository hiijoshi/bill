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
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  status: string
  userUnitName: string
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

export function formatDisplayDate(value: string | Date | null | undefined): string {
  const date = value ? new Date(value) : null
  if (!date || !Number.isFinite(date.getTime())) return '-'
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}-${month}-${year}`
}

export function mapPurchaseBillToPrintData(bill: any): PurchaseBillPrintData {
  const item = Array.isArray(bill?.purchaseItems) ? bill.purchaseItems[0] : null

  const companyName = bill?.companyNameSnapshot || bill?.company?.name || ''
  const companyAddress = bill?.company?.address || ''
  const companyPhone = bill?.company?.phone || ''
  const mandiAccountNumber = bill?.mandiAccountNumberSnapshot || bill?.company?.mandiAccountNumber || ''

  const farmerName = bill?.farmerNameSnapshot || bill?.farmer?.name || ''
  const farmerAddress = bill?.farmerAddressSnapshot || bill?.farmer?.address || ''
  const farmerContact = bill?.farmerContactSnapshot || bill?.farmer?.phone1 || ''
  const krashakAnubandhNumber = bill?.krashakAnubandhSnapshot || bill?.farmer?.krashakAnubandhNumber || ''

  const productName = item?.productNameSnapshot || item?.product?.name || ''

  return {
    id: String(bill?.id || ''),
    billNo: String(bill?.billNo || ''),
    billDateIso: String(bill?.billDate || ''),
    billDateLabel: formatDisplayDate(bill?.billDate),
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
    markaNo: String(item?.markaNo || ''),
    qty: Math.max(0, toNumber(item?.qty, 0)),
    totalWeightQt: Math.max(0, toNumber(item?.totalWeightQt ?? item?.qty, 0)),
    rate: Math.max(0, toNumber(item?.rate, 0)),
    hammali: Math.max(0, toNumber(item?.hammali, 0)),
    amount: Math.max(0, toNumber(item?.amount, 0)),
    totalAmount: Math.max(0, toNumber(bill?.totalAmount, 0)),
    paidAmount: Math.max(0, toNumber(bill?.paidAmount, 0)),
    balanceAmount: Math.max(0, toNumber(bill?.balanceAmount, 0)),
    status: String(bill?.status || 'unpaid'),
    userUnitName: String(item?.userUnitName || '')
  }
}
