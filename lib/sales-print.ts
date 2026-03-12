export interface SalesPrintItem {
  id: string
  productName: string
  bags: number
  totalWeightQt: number
  weightPerBagQt: number
  ratePerQt: number
  amount: number
}

export interface SalesBillPrintData {
  id: string
  billNo: string
  billDateIso: string
  billDateLabel: string
  printDateLabel: string
  companyName: string
  companyAddress: string
  companyPhone: string
  partyName: string
  partyAddress: string
  partyContact: string
  transportName: string
  lorryNo: string
  freightPerQt: number
  freightAmount: number
  advance: number
  toPay: number
  items: SalesPrintItem[]
  totalBags: number
  totalWeightQt: number
  totalAmount: number
  receivedAmount: number
  balanceAmount: number
  status: string
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, parsed)
}

export function formatDisplayDate(value: string | Date | null | undefined): string {
  const date = value ? new Date(value) : null
  if (!date || !Number.isFinite(date.getTime())) return '-'
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}-${month}-${year}`
}

function mapSalesItems(items: unknown): SalesPrintItem[] {
  if (!Array.isArray(items)) return []

  return items.map((item: any, index: number) => {
    const bags = toNonNegativeNumber(item?.bags, 0)
    const totalWeightQt = toNonNegativeNumber(item?.weight ?? item?.qty, 0)
    const weightPerBagQt = bags > 0 ? totalWeightQt / bags : 0

    return {
      id: String(item?.id || `line-${index + 1}`),
      productName: String(item?.product?.name || 'Item'),
      bags,
      totalWeightQt,
      weightPerBagQt,
      ratePerQt: toNonNegativeNumber(item?.rate, 0),
      amount: toNonNegativeNumber(item?.amount, 0)
    }
  })
}

export function mapSalesBillToPrintData(bill: any): SalesBillPrintData {
  const items = mapSalesItems(bill?.salesItems)
  const primaryTransport = Array.isArray(bill?.transportBills) ? bill.transportBills[0] : null
  const totalBags = items.reduce((sum, item) => sum + item.bags, 0)
  const totalWeightQt = items.reduce((sum, item) => sum + item.totalWeightQt, 0)

  return {
    id: String(bill?.id || ''),
    billNo: String(bill?.billNo || ''),
    billDateIso: String(bill?.billDate || ''),
    billDateLabel: formatDisplayDate(bill?.billDate),
    printDateLabel: formatDisplayDate(new Date()),
    companyName: String(bill?.company?.name || ''),
    companyAddress: String(bill?.company?.address || ''),
    companyPhone: String(bill?.company?.phone || ''),
    partyName: String(bill?.party?.name || ''),
    partyAddress: String(bill?.party?.address || ''),
    partyContact: String(bill?.party?.phone1 || ''),
    transportName: String(primaryTransport?.transportName || ''),
    lorryNo: String(primaryTransport?.lorryNo || ''),
    freightPerQt: toNonNegativeNumber(primaryTransport?.freightPerQt, 0),
    freightAmount: toNonNegativeNumber(primaryTransport?.freightAmount, 0),
    advance: toNonNegativeNumber(primaryTransport?.advance, 0),
    toPay: toNonNegativeNumber(primaryTransport?.toPay, 0),
    items,
    totalBags,
    totalWeightQt,
    totalAmount: toNonNegativeNumber(bill?.totalAmount, 0),
    receivedAmount: toNonNegativeNumber(bill?.receivedAmount, 0),
    balanceAmount: toNonNegativeNumber(bill?.balanceAmount, 0),
    status: String(bill?.status || 'unpaid')
  }
}
