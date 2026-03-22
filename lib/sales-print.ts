export interface SalesPrintItem {
  id: string
  productName: string
  bags: number
  totalWeightQt: number
  weightPerBagQt: number
  ratePerQt: number
  amount: number
  taxableAmount: number
  gstRate: number
  gstAmount: number
  lineTotal: number
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
  otherAmount: number
  insuranceAmount: number
  items: SalesPrintItem[]
  totalBags: number
  totalWeightQt: number
  subTotalAmount: number
  gstAmount: number
  totalAmount: number
  receivedAmount: number
  balanceAmount: number
  status: string
}

type SalesPrintProduct = {
  name?: unknown
}

type SalesPrintItemSource = {
  id?: unknown
  product?: SalesPrintProduct | null
  bags?: unknown
  weight?: unknown
  qty?: unknown
  rate?: unknown
  amount?: unknown
  taxableAmount?: unknown
  gstRateSnapshot?: unknown
  gstAmount?: unknown
  lineTotal?: unknown
}

type SalesPrintTransportSource = {
  transportName?: unknown
  lorryNo?: unknown
  freightPerQt?: unknown
  freightAmount?: unknown
  advance?: unknown
  toPay?: unknown
  otherAmount?: unknown
  insuranceAmount?: unknown
}

type SalesPrintPartySource = {
  name?: unknown
  address?: unknown
  phone1?: unknown
}

type SalesPrintCompanySource = {
  name?: unknown
  address?: unknown
  phone?: unknown
}

type SalesBillPrintSource = {
  id?: unknown
  billNo?: unknown
  billDate?: unknown
  company?: SalesPrintCompanySource | null
  party?: SalesPrintPartySource | null
  salesItems?: SalesPrintItemSource[] | null
  transportBills?: SalesPrintTransportSource[] | null
  subTotalAmount?: unknown
  gstAmount?: unknown
  totalAmount?: unknown
  receivedAmount?: unknown
  balanceAmount?: unknown
  status?: unknown
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, parsed)
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

function mapSalesItems(items: SalesPrintItemSource[] | null | undefined): SalesPrintItem[] {
  if (!Array.isArray(items)) return []

  return items.map((item, index: number) => {
    const bags = toNonNegativeNumber(item?.bags, 0)
    const totalWeightQt = toNonNegativeNumber(item?.weight ?? item?.qty, 0)
    const weightPerBagQt = bags > 0 ? totalWeightQt / bags : 0

    return {
      id: String(item?.id || `line-${index + 1}`),
      productName: toStringValue(item?.product?.name, 'Item'),
      bags,
      totalWeightQt,
      weightPerBagQt,
      ratePerQt: toNonNegativeNumber(item?.rate, 0),
      amount: toNonNegativeNumber(item?.amount, 0),
      taxableAmount: toNonNegativeNumber(item?.taxableAmount ?? item?.amount, 0),
      gstRate: toNonNegativeNumber(item?.gstRateSnapshot, 0),
      gstAmount: toNonNegativeNumber(item?.gstAmount, 0),
      lineTotal: toNonNegativeNumber(item?.lineTotal ?? item?.amount, 0)
    }
  })
}

export function mapSalesBillToPrintData(bill: SalesBillPrintSource | null | undefined): SalesBillPrintData {
  const items = mapSalesItems(bill?.salesItems)
  const primaryTransport = Array.isArray(bill?.transportBills) ? bill.transportBills[0] : null
  const totalBags = items.reduce((sum, item) => sum + item.bags, 0)
  const totalWeightQt = items.reduce((sum, item) => sum + item.totalWeightQt, 0)

  return {
    id: String(bill?.id || ''),
    billNo: String(bill?.billNo || ''),
    billDateIso: String(bill?.billDate || ''),
    billDateLabel: formatDisplayDate(toDateValue(bill?.billDate)),
    printDateLabel: formatDisplayDate(new Date()),
    companyName: toStringValue(bill?.company?.name),
    companyAddress: toStringValue(bill?.company?.address),
    companyPhone: toStringValue(bill?.company?.phone),
    partyName: toStringValue(bill?.party?.name),
    partyAddress: toStringValue(bill?.party?.address),
    partyContact: toStringValue(bill?.party?.phone1),
    transportName: toStringValue(primaryTransport?.transportName),
    lorryNo: toStringValue(primaryTransport?.lorryNo),
    freightPerQt: toNonNegativeNumber(primaryTransport?.freightPerQt, 0),
    freightAmount: toNonNegativeNumber(primaryTransport?.freightAmount, 0),
    advance: toNonNegativeNumber(primaryTransport?.advance, 0),
    toPay: toNonNegativeNumber(primaryTransport?.toPay, 0),
    otherAmount: toNonNegativeNumber(primaryTransport?.otherAmount, 0),
    insuranceAmount: toNonNegativeNumber(primaryTransport?.insuranceAmount, 0),
    items,
    totalBags,
    totalWeightQt,
    subTotalAmount: toNonNegativeNumber(
      bill?.subTotalAmount,
      items.reduce((sum, item) => sum + item.taxableAmount, 0)
    ),
    gstAmount: toNonNegativeNumber(
      bill?.gstAmount,
      items.reduce((sum, item) => sum + item.gstAmount, 0)
    ),
    totalAmount: toNonNegativeNumber(bill?.totalAmount, 0),
    receivedAmount: toNonNegativeNumber(bill?.receivedAmount, 0),
    balanceAmount: toNonNegativeNumber(bill?.balanceAmount, 0),
    status: toStringValue(bill?.status, 'unpaid')
  }
}
