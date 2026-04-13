import { sanitizePrintCompanyAddress } from '@/lib/print-company'
import {
  summarizeSalesAdditionalCharges,
  type SalesAdditionalChargeInput,
} from '@/lib/sales-additional-charges'

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
  invoiceKind: string
  workflowStatus: string
  splitPartLabel: string | null
  splitSuffix: string | null
  parentBillId: string | null
  parentBillNo: string | null
  billDateIso: string
  billDateLabel: string
  printDateLabel: string
  companyName: string
  companyAddress: string
  companyPhone: string
  companyBankName: string
  companyBankBranch: string
  companyBankIfsc: string
  companyBankAccountNumber: string
  companyBankDisplay: string
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
  additionalCharges: Array<{
    chargeType: string
    amount: number
    remark: string | null
  }>
  additionalChargesTotal: number
  items: SalesPrintItem[]
  totalBags: number
  totalWeightQt: number
  subTotalAmount: number
  gstAmount: number
  totalAmount: number
  receivedAmount: number
  balanceAmount: number
  status: string
  childBills: Array<{
    id: string
    billNo: string
    totalAmount: number
    status: string
    splitPartLabel: string | null
    splitSuffix: string | null
  }>
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

type SalesPrintAdditionalChargeSource = SalesAdditionalChargeInput

type SalesPrintCompanySource = {
  name?: unknown
  address?: unknown
  phone?: unknown
  mandiAccountNumber?: unknown
  banks?: Array<{
    name?: unknown
    branch?: unknown
    ifscCode?: unknown
    accountNumber?: unknown
  }> | null
}

type SalesBillPrintSource = {
  id?: unknown
  billNo?: unknown
  invoiceKind?: unknown
  workflowStatus?: unknown
  splitPartLabel?: unknown
  splitSuffix?: unknown
  billDate?: unknown
  parentSalesBill?: {
    id?: unknown
    billNo?: unknown
  } | null
  childSalesBills?: Array<{
    id?: unknown
    billNo?: unknown
    totalAmount?: unknown
    status?: unknown
    splitPartLabel?: unknown
    splitSuffix?: unknown
  }> | null
  company?: SalesPrintCompanySource | null
  party?: SalesPrintPartySource | null
  salesItems?: SalesPrintItemSource[] | null
  transportBills?: SalesPrintTransportSource[] | null
  additionalCharges?: SalesPrintAdditionalChargeSource[] | null
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

function resolveCompanyBankDetails(company: SalesPrintCompanySource | null | undefined) {
  const firstBank = Array.isArray(company?.banks) ? company?.banks[0] : null
  const companyBankName = toStringValue(firstBank?.name).trim()
  const companyBankBranch = toStringValue(firstBank?.branch).trim()
  const companyBankIfsc = toStringValue(firstBank?.ifscCode).trim().toUpperCase()
  const companyBankAccountNumber =
    toStringValue(firstBank?.accountNumber).trim() || toStringValue(company?.mandiAccountNumber).trim()

  const companyBankDisplay = [
    companyBankName,
    companyBankBranch ? `Branch: ${companyBankBranch}` : '',
    companyBankAccountNumber ? `A/c: ${companyBankAccountNumber}` : '',
    companyBankIfsc ? `IFSC: ${companyBankIfsc}` : ''
  ]
    .filter(Boolean)
    .join(' | ')

  return {
    companyBankName,
    companyBankBranch,
    companyBankIfsc,
    companyBankAccountNumber,
    companyBankDisplay
  }
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

function mapAdditionalCharges(
  charges: SalesPrintAdditionalChargeSource[] | null | undefined,
  fallbackTransport: SalesPrintTransportSource | null | undefined
) {
  if (Array.isArray(charges) && charges.length > 0) {
    return charges
      .map((charge) => ({
        chargeType: String(charge?.chargeType || '').trim(),
        amount: toNonNegativeNumber(charge?.amount, 0),
        remark: charge?.remark == null ? null : String(charge.remark).trim() || null,
      }))
      .filter((charge) => charge.chargeType && charge.amount > 0)
  }

  const legacyCharges = [
    {
      chargeType: 'Other Amount',
      amount: toNonNegativeNumber(fallbackTransport?.otherAmount, 0),
      remark: null,
    },
    {
      chargeType: 'Insurance',
      amount: toNonNegativeNumber(fallbackTransport?.insuranceAmount, 0),
      remark: null,
    },
  ]

  return legacyCharges.filter((charge) => charge.amount > 0)
}

export function mapSalesBillToPrintData(bill: SalesBillPrintSource | null | undefined): SalesBillPrintData {
  const items = mapSalesItems(bill?.salesItems)
  const primaryTransport = Array.isArray(bill?.transportBills) ? bill.transportBills[0] : null
  const additionalCharges = mapAdditionalCharges(bill?.additionalCharges, primaryTransport)
  const additionalChargeSummary = summarizeSalesAdditionalCharges(additionalCharges)
  const totalBags = items.reduce((sum, item) => sum + item.bags, 0)
  const totalWeightQt = items.reduce((sum, item) => sum + item.totalWeightQt, 0)
  const companyBankDetails = resolveCompanyBankDetails(bill?.company)

  return {
    id: String(bill?.id || ''),
    billNo: String(bill?.billNo || ''),
    invoiceKind: toStringValue(bill?.invoiceKind, 'regular'),
    workflowStatus: toStringValue(bill?.workflowStatus, 'posted'),
    splitPartLabel: bill?.splitPartLabel == null ? null : toStringValue(bill.splitPartLabel, '').trim() || null,
    splitSuffix: bill?.splitSuffix == null ? null : toStringValue(bill.splitSuffix, '').trim() || null,
    parentBillId: bill?.parentSalesBill?.id == null ? null : toStringValue(bill.parentSalesBill.id),
    parentBillNo: bill?.parentSalesBill?.billNo == null ? null : toStringValue(bill.parentSalesBill.billNo),
    billDateIso: String(bill?.billDate || ''),
    billDateLabel: formatDisplayDate(toDateValue(bill?.billDate)),
    printDateLabel: formatDisplayDate(new Date()),
    companyName: toStringValue(bill?.company?.name),
    companyAddress: sanitizePrintCompanyAddress(bill?.company?.address),
    companyPhone: toStringValue(bill?.company?.phone),
    companyBankName: companyBankDetails.companyBankName,
    companyBankBranch: companyBankDetails.companyBankBranch,
    companyBankIfsc: companyBankDetails.companyBankIfsc,
    companyBankAccountNumber: companyBankDetails.companyBankAccountNumber,
    companyBankDisplay: companyBankDetails.companyBankDisplay,
    partyName: toStringValue(bill?.party?.name),
    partyAddress: toStringValue(bill?.party?.address),
    partyContact: toStringValue(bill?.party?.phone1),
    transportName: toStringValue(primaryTransport?.transportName),
    lorryNo: toStringValue(primaryTransport?.lorryNo),
    freightPerQt: toNonNegativeNumber(primaryTransport?.freightPerQt, 0),
    freightAmount: toNonNegativeNumber(primaryTransport?.freightAmount, 0),
    advance: toNonNegativeNumber(primaryTransport?.advance, 0),
    toPay: toNonNegativeNumber(primaryTransport?.toPay, 0),
    otherAmount: additionalChargeSummary.otherAmount,
    insuranceAmount: additionalChargeSummary.insuranceAmount,
    additionalCharges,
    additionalChargesTotal: additionalChargeSummary.totalAmount,
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
    status: toStringValue(bill?.status, 'unpaid'),
    childBills: Array.isArray(bill?.childSalesBills)
      ? bill.childSalesBills.map((child) => ({
          id: toStringValue(child?.id),
          billNo: toStringValue(child?.billNo),
          totalAmount: toNonNegativeNumber(child?.totalAmount, 0),
          status: toStringValue(child?.status, 'unpaid'),
          splitPartLabel: child?.splitPartLabel == null ? null : toStringValue(child.splitPartLabel, '').trim() || null,
          splitSuffix: child?.splitSuffix == null ? null : toStringValue(child.splitSuffix, '').trim() || null,
        }))
      : []
  }
}
