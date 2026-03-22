'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, FileText, Filter, RefreshCw, Search, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { printSimpleTableReport } from '@/lib/report-print'

const BASE_HEADERS = [
  'Party_Type',
  'Bill_No',
  'Seller_Name',
  'Seller_Address',
  'SellerMob',
  'Anubandh_No',
  'Anubandh_Date',
  'Bhugtan_No',
  'Bhugtan_Date',
  'Auction_Rate',
  'Actual_Weight',
  'Total_Hammali_Toul',
  'Farmer_Payment',
  'Payment_Mode',
  'CashAmount',
  'Cash_Payment_Date',
  'Online_Pay_Amount',
  'Online_Payment_Date',
  'IFSC_Code',
  'Farmer_BankAccount',
  'UTR',
  'ASFlag'
] as const

const CSV_HEADERS = [...BASE_HEADERS, 'Pending_Amount', 'Payment_Status', 'Bank_Name', 'Company_Name'] as const

type CsvHeader = (typeof CSV_HEADERS)[number]
type ReportType = 'main' | 'purchase' | 'sales'
type StatusFilter = 'all' | 'paid' | 'partial' | 'unpaid'
type ModeFilter = 'all' | 'cash' | 'online' | 'bank' | 'mixed' | 'none'
type ModeBucket = Exclude<ModeFilter, 'all'>

interface CompanyRecord {
  id: string
  name: string
}

interface BankRecord {
  name?: string
  ifscCode?: string
}

interface SupplierRecord {
  name?: string
  address?: string
  phone1?: string
  gstNumber?: string
  ifscCode?: string
  bankName?: string
  accountNo?: string
}

interface FarmerRecord {
  name?: string
  address?: string
  phone1?: string
  krashakAnubandhNumber?: string
  ifscCode?: string
  accountNo?: string
  bankName?: string
}

interface PartyRecord {
  name?: string
  address?: string
  phone1?: string
}

interface PurchaseItemRecord {
  qty?: number
  rate?: number
  hammali?: number
}

interface SalesItemRecord {
  weight?: number
  rate?: number
}

interface PurchaseBillRecord {
  id: string
  companyId: string
  billNo: string
  billDate: string
  totalAmount?: number
  paidAmount?: number
  status?: string
  farmerNameSnapshot?: string
  farmerAddressSnapshot?: string
  farmerContactSnapshot?: string
  krashakAnubandhSnapshot?: string
  farmer?: FarmerRecord
  purchaseItems?: PurchaseItemRecord[]
}

interface SpecialPurchaseItemRecord {
  weight?: number
  rate?: number
  otherAmount?: number
}

interface SpecialPurchaseBillRecord {
  id: string
  companyId: string
  supplierInvoiceNo: string
  billDate: string
  totalAmount?: number
  paidAmount?: number
  balanceAmount?: number
  status?: string
  supplier?: SupplierRecord
  specialPurchaseItems?: SpecialPurchaseItemRecord[]
}

interface SalesBillRecord {
  id: string
  companyId: string
  billNo: string
  billDate: string
  totalAmount?: number
  receivedAmount?: number
  status?: string
  party?: PartyRecord
  salesItems?: SalesItemRecord[]
}

interface PaymentRecord {
  id: string
  billType?: string
  billId: string
  billNo?: string
  payDate?: string
  amount?: number
  mode?: string
  status?: string
  cashAmount?: number
  cashPaymentDate?: string
  onlinePayAmount?: number
  onlinePaymentDate?: string
  ifscCode?: string
  beneficiaryBankAccount?: string
  bankNameSnapshot?: string
  txnRef?: string
  asFlag?: string
}

interface CompanyDataset {
  companyId: string
  companyName: string
  purchaseBills: PurchaseBillRecord[]
  specialPurchaseBills: SpecialPurchaseBillRecord[]
  salesBills: SalesBillRecord[]
  payments: PaymentRecord[]
  banks: BankRecord[]
}

type ReportRow = Record<CsvHeader, string | number> & {
  _status: string
  _modeBucket: ModeBucket
  _sortTs: number
  _source: 'purchase' | 'sales'
}

type AnalysisSnapshot = {
  purchaseTotal: number
  purchasePaid: number
  purchaseBalance: number
  purchaseWeightedRate: number
  purchaseWeight: number
  salesTotal: number
  salesReceived: number
  salesBalance: number
  salesWeightedRate: number
  salesWeight: number
}

interface ReportDashboardProps {
  initialCompanyId?: string
  embedded?: boolean
  onBackToDashboard?: () => void
  reportType?: ReportType
}

const MAIN_HEADERS: CsvHeader[] = [
  'Party_Type',
  'Bill_No',
  'Seller_Name',
  'Seller_Address',
  'SellerMob',
  'Anubandh_No',
  'Anubandh_Date',
  'Bhugtan_No',
  'Bhugtan_Date',
  'Auction_Rate',
  'Actual_Weight',
  'Farmer_Payment',
  'Payment_Mode',
  'CashAmount',
  'Online_Pay_Amount',
  'Pending_Amount',
  'Payment_Status',
  'Bank_Name',
  'Company_Name'
]

const SALES_HEADERS: CsvHeader[] = [
  'Bill_No',
  'Seller_Name',
  'Seller_Address',
  'SellerMob',
  'Anubandh_Date',
  'Bhugtan_No',
  'Bhugtan_Date',
  'Auction_Rate',
  'Actual_Weight',
  'Farmer_Payment',
  'Payment_Mode',
  'CashAmount',
  'Cash_Payment_Date',
  'Online_Pay_Amount',
  'Online_Payment_Date',
  'UTR',
  'Pending_Amount',
  'Payment_Status',
  'Bank_Name',
  'Company_Name'
]

const PURCHASE_HEADERS: CsvHeader[] = [...CSV_HEADERS]

const EMPTY_ANALYSIS_SNAPSHOT: AnalysisSnapshot = {
  purchaseTotal: 0,
  purchasePaid: 0,
  purchaseBalance: 0,
  purchaseWeightedRate: 0,
  purchaseWeight: 0,
  salesTotal: 0,
  salesReceived: 0,
  salesBalance: 0,
  salesWeightedRate: 0,
  salesWeight: 0
}

const getAvailableHeaders = (reportType: ReportType): CsvHeader[] => {
  if (reportType === 'sales') return SALES_HEADERS
  if (reportType === 'purchase') return PURCHASE_HEADERS
  return MAIN_HEADERS
}

const numberFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const countFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0
})

const normalizeAmount = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

const round2 = (value: number): number => Number(normalizeAmount(value).toFixed(2))
const round3 = (value: number): number => Number(normalizeAmount(value).toFixed(3))

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

const toTimestamp = (value: unknown): number => {
  const parsed = parseDate(value)
  return parsed ? parsed.getTime() : 0
}

const toDateInputValue = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const formatCompactDate = (value: unknown): string => {
  const date = parseDate(value)
  if (!date) return ''
  const day = date.getDate()
  const month = date.getMonth() + 1
  const year = String(date.getFullYear()).slice(-2)
  return `${day}/${month}/${year}`
}

const normalizeCollection = <T,>(payload: unknown): T[] => {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: T[] }).data
  }
  return []
}

const csvEscape = (value: string | number): string => `"${String(value ?? '').replace(/"/g, '""')}"`

const getHeaderLabel = (header: CsvHeader, reportType: ReportType): string => {
  const labels: Record<CsvHeader, string> = {
    Party_Type: reportType === 'sales' ? 'Party Type' : 'Party Type',
    Bill_No: reportType === 'sales' ? 'Invoice No' : 'Bill / Invoice No',
    Seller_Name: reportType === 'sales' ? 'Party Name' : 'Seller / Party Name',
    Seller_Address: reportType === 'sales' ? 'Party Address' : 'Address',
    SellerMob: reportType === 'sales' ? 'Party Mobile' : 'Mobile',
    Anubandh_No: reportType === 'sales' ? 'Reference No' : 'Anubandh / Ref No',
    Anubandh_Date: reportType === 'sales' ? 'Invoice Date' : 'Bill Date',
    Bhugtan_No: 'Payment Ref No',
    Bhugtan_Date: 'Payment Date',
    Auction_Rate: reportType === 'sales' ? 'Average Sale Rate' : 'Average Rate',
    Actual_Weight: 'Weight',
    Total_Hammali_Toul: 'Hammali / Other',
    Farmer_Payment: reportType === 'sales' ? 'Invoice Amount' : 'Bill Amount',
    Payment_Mode: 'Payment Mode',
    CashAmount: 'Cash Amount',
    Cash_Payment_Date: 'Cash Payment Date',
    Online_Pay_Amount: 'Online + Bank Amount',
    Online_Payment_Date: 'Online / Bank Date',
    IFSC_Code: 'IFSC Code',
    Farmer_BankAccount: 'Bank Account',
    UTR: 'UTR / Ref',
    ASFlag: 'Status Flag',
    Pending_Amount: 'Pending Amount',
    Payment_Status: 'Payment Status',
    Bank_Name: 'Bank Name',
    Company_Name: 'Company Name'
  }

  return labels[header]
}

const calculateMarginPercent = (purchaseValue: number, salesValue: number): number | null => {
  if (salesValue <= 0) return null
  return ((salesValue - purchaseValue) / salesValue) * 100
}

const formatMargin = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '-'
  return `${value.toFixed(2)}%`
}

const resolveModeBucket = (mode: string | undefined | null): ModeBucket => {
  const normalized = String(mode || '').trim().toLowerCase()
  if (!normalized) return 'none'
  if (normalized === 'c' || normalized.includes('cash')) return 'cash'
  if (
    normalized === 'b' ||
    normalized.includes('bank') ||
    normalized.includes('neft') ||
    normalized.includes('rtgs') ||
    normalized.includes('imps')
  ) {
    return 'bank'
  }
  if (normalized === 'o' || normalized.includes('online') || normalized.includes('upi')) return 'online'
  return 'online'
}

const resolveModeCode = (bucket: ModeBucket): string => {
  if (bucket === 'cash') return 'C'
  if (bucket === 'online') return 'O'
  if (bucket === 'bank') return 'B'
  if (bucket === 'mixed') return 'MIXED'
  return 'N/A'
}

const statusToFlag = (status: string): string => {
  if (status === 'paid') return 'A'
  if (status === 'partial') return 'P'
  return 'U'
}

const passesDateRange = (value: string | undefined, from: Date | null, to: Date | null): boolean => {
  if (!from || !to) return true
  const date = parseDate(value)
  if (!date) return false
  return date >= from && date <= to
}

const derivePaymentSplit = (payment: PaymentRecord, modeBucket: ModeBucket): { cash: number; online: number } => {
  const amount = normalizeAmount(payment.amount)
  const explicitCash = normalizeAmount(payment.cashAmount)
  const explicitOnline = normalizeAmount(payment.onlinePayAmount)

  if (explicitCash > 0 || explicitOnline > 0) {
    return { cash: explicitCash, online: explicitOnline }
  }

  if (modeBucket === 'cash') return { cash: amount, online: 0 }
  if (modeBucket === 'online' || modeBucket === 'bank') return { cash: 0, online: amount }
  return { cash: 0, online: 0 }
}

export default function ReportDashboard({
  initialCompanyId,
  embedded = false,
  onBackToDashboard,
  reportType = 'main'
}: ReportDashboardProps) {
  const today = useMemo(() => new Date(), [])
  const firstDay = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today])

  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState(initialCompanyId || '')
  const [dateFrom, setDateFrom] = useState(toDateInputValue(firstDay))
  const [dateTo, setDateTo] = useState(toDateInputValue(today))
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [paymentModeFilter, setPaymentModeFilter] = useState<ModeFilter>('all')
  const [bankFilter, setBankFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [headerSearchTerm, setHeaderSearchTerm] = useState('')
  const [selectedHeaders, setSelectedHeaders] = useState<CsvHeader[]>(() => [...getAvailableHeaders(reportType)])

  const [generatedRows, setGeneratedRows] = useState<ReportRow[]>([])
  const [analysisSnapshot, setAnalysisSnapshot] = useState<AnalysisSnapshot>(EMPTY_ANALYSIS_SNAPSHOT)
  const [availableBanks, setAvailableBanks] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingCompanies, setLoadingCompanies] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [lastGeneratedAt, setLastGeneratedAt] = useState('')
  const selectedCompanyName = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId)?.name || selectedCompanyId || 'Selected company',
    [companies, selectedCompanyId]
  )

  useEffect(() => {
    if (initialCompanyId) {
      setSelectedCompanyId(initialCompanyId)
    }
  }, [initialCompanyId])

  const availableHeaders = useMemo(() => getAvailableHeaders(reportType), [reportType])

  useEffect(() => {
    setSelectedHeaders([...availableHeaders])
  }, [availableHeaders])

  useEffect(() => {
    let cancelled = false

    const loadCompanies = async () => {
      setLoadingCompanies(true)
      try {
        const response = await fetch('/api/companies', { cache: 'no-store' })
        if (!response.ok) {
          throw new Error('Unable to load companies')
        }

        const payload = await response.json().catch(() => [])
        const rows = normalizeCollection<CompanyRecord>(payload)

        if (cancelled) return

        setCompanies(rows)

        const availableIds = new Set(rows.map((row) => row.id))
        setSelectedCompanyId((previous) => {
          if (initialCompanyId && availableIds.has(initialCompanyId)) {
            return initialCompanyId
          }
          if (previous && availableIds.has(previous)) {
            return previous
          }
          return rows[0]?.id || ''
        })
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load companies'
          setErrorMessage(message)
          setCompanies([])
        }
      } finally {
        if (!cancelled) {
          setLoadingCompanies(false)
        }
      }
    }

    void loadCompanies()

    return () => {
      cancelled = true
    }
  }, [initialCompanyId])

  const generateReport = useCallback(async () => {
    if (!dateFrom || !dateTo) {
      setErrorMessage('Please select date range before generating the report.')
      return
    }

    const fromDate = parseDate(`${dateFrom}T00:00:00`)
    const toDate = parseDate(`${dateTo}T23:59:59`)
    if (!fromDate || !toDate || fromDate > toDate) {
      setErrorMessage('Invalid date range selected.')
      return
    }

    const targetCompanyIds = selectedCompanyId ? [selectedCompanyId] : []

    if (targetCompanyIds.length === 0) {
      setErrorMessage('No company available for the selected report scope.')
      return
    }

    setLoading(true)

    try {
      const companyNameMap = new Map(companies.map((company) => [company.id, company.name]))
      const queryFrom = encodeURIComponent(dateFrom)
      const queryTo = encodeURIComponent(dateTo)

      const datasets = await Promise.all(
        targetCompanyIds.map(async (companyId) => {
          const [purchaseRes, specialPurchaseRes, salesRes, paymentRes, banksRes] = await Promise.all([
            fetch(`/api/purchase-bills?companyId=${encodeURIComponent(companyId)}&dateFrom=${queryFrom}&dateTo=${queryTo}`),
            fetch(`/api/special-purchase-bills?companyId=${encodeURIComponent(companyId)}&dateFrom=${queryFrom}&dateTo=${queryTo}`),
            fetch(`/api/sales-bills?companyId=${encodeURIComponent(companyId)}`),
            fetch(`/api/payments?companyId=${encodeURIComponent(companyId)}`),
            fetch(`/api/banks?companyId=${encodeURIComponent(companyId)}`)
          ])

          if (reportType === 'purchase' && (!purchaseRes.ok || !specialPurchaseRes.ok)) {
            throw new Error(`Failed to load purchase bills for ${companyNameMap.get(companyId) || companyId}`)
          }

          if (reportType === 'sales' && !salesRes.ok) {
            throw new Error(`Failed to load sales bills for ${companyNameMap.get(companyId) || companyId}`)
          }

          if (reportType === 'main' && !purchaseRes.ok && !specialPurchaseRes.ok && !salesRes.ok) {
            throw new Error(`Failed to load bills for ${companyNameMap.get(companyId) || companyId}`)
          }

          const purchasePayload = purchaseRes.ok ? await purchaseRes.json().catch(() => []) : []
          const specialPurchasePayload = specialPurchaseRes.ok ? await specialPurchaseRes.json().catch(() => []) : []
          const salesPayload = salesRes.ok ? await salesRes.json().catch(() => []) : []
          const paymentPayload = paymentRes.ok ? await paymentRes.json().catch(() => []) : []
          const bankPayload = banksRes.ok ? await banksRes.json().catch(() => []) : []

          return {
            companyId,
            companyName: companyNameMap.get(companyId) || companyId,
            purchaseBills: normalizeCollection<PurchaseBillRecord>(purchasePayload),
            specialPurchaseBills: normalizeCollection<SpecialPurchaseBillRecord>(specialPurchasePayload),
            salesBills: normalizeCollection<SalesBillRecord>(salesPayload),
            payments: normalizeCollection<PaymentRecord>(paymentPayload),
            banks: normalizeCollection<BankRecord>(bankPayload)
          } satisfies CompanyDataset
        })
      )

      const collectedBanks = new Set<string>()
      const reportRows: ReportRow[] = []
      const analysisAccumulator: AnalysisSnapshot = { ...EMPTY_ANALYSIS_SNAPSHOT }

      for (const dataset of datasets) {
        const paymentsByBill = new Map<string, PaymentRecord[]>()

        for (const payment of dataset.payments) {
          const billType = String(payment.billType || '').toLowerCase()
          const key = `${billType}:${payment.billId}`
          const rows = paymentsByBill.get(key) || []
          rows.push(payment)
          paymentsByBill.set(key, rows)
        }

        const bankNameByIfsc = new Map<string, string>()
        for (const bank of dataset.banks) {
          const ifsc = String(bank.ifscCode || '').trim().toUpperCase()
          const name = String(bank.name || '').trim()
          if (ifsc && name) {
            bankNameByIfsc.set(ifsc, name)
            collectedBanks.add(name)
          }
        }

        for (const bill of dataset.purchaseBills) {
          const farmer = bill.farmer || {}
          const purchaseItems = Array.isArray(bill.purchaseItems) ? bill.purchaseItems : []
          const totalWeight = purchaseItems.reduce((acc, item) => acc + normalizeAmount(item.qty), 0)
          const totalHammali = purchaseItems.reduce((acc, item) => acc + normalizeAmount(item.hammali), 0)
          const weightedRate = purchaseItems.reduce(
            (acc, item) => acc + normalizeAmount(item.qty) * normalizeAmount(item.rate),
            0
          )

          const allPayments = (paymentsByBill.get(`purchase:${bill.id}`) || []).sort(
            (a, b) => toTimestamp(b.payDate) - toTimestamp(a.payDate)
          )
          const paymentsInRange = allPayments.filter((payment) => passesDateRange(payment.payDate, fromDate, toDate))
          const billInRange = passesDateRange(bill.billDate, fromDate, toDate)
          if (!billInRange && paymentsInRange.length === 0) continue

          if (billInRange) {
            const purchaseTotal = normalizeAmount(bill.totalAmount)
            const purchasePaid = normalizeAmount(bill.paidAmount)
            analysisAccumulator.purchaseTotal += purchaseTotal
            analysisAccumulator.purchasePaid += purchasePaid
            analysisAccumulator.purchaseBalance += Math.max(0, purchaseTotal - purchasePaid)
            analysisAccumulator.purchaseWeightedRate += weightedRate
            analysisAccumulator.purchaseWeight += totalWeight
          }

          if (reportType === 'sales') continue

          const effectivePayments = paymentsInRange

          let cashAmount = 0
          let onlineAmount = 0
          let bankAmount = 0
          let cashPaymentDate = ''
          let onlinePaymentDate = ''
          let bankPaymentDate = ''

          for (const payment of effectivePayments) {
            const modeBucket = resolveModeBucket(payment.mode)
            const split = derivePaymentSplit(payment, modeBucket)

            if (modeBucket === 'cash') {
              cashAmount += split.cash
              if (!cashPaymentDate) cashPaymentDate = formatCompactDate(payment.cashPaymentDate || payment.payDate)
            } else if (modeBucket === 'bank') {
              bankAmount += split.online
              if (!bankPaymentDate) bankPaymentDate = formatCompactDate(payment.onlinePaymentDate || payment.payDate)
            } else if (modeBucket === 'online') {
              onlineAmount += split.online
              if (!onlinePaymentDate) onlinePaymentDate = formatCompactDate(payment.onlinePaymentDate || payment.payDate)
            }
          }

          if (effectivePayments.length === 0 && normalizeAmount(bill.paidAmount) > 0) {
            cashAmount = normalizeAmount(bill.paidAmount)
            cashPaymentDate = formatCompactDate(bill.billDate)
          }

          const netOnlineAmount = onlineAmount + bankAmount
          const latestPayment = effectivePayments[0]

          let modeBucket: ModeBucket = 'none'
          if (cashAmount > 0 && netOnlineAmount > 0) modeBucket = 'mixed'
          else if (cashAmount > 0) modeBucket = 'cash'
          else if (bankAmount > 0) modeBucket = 'bank'
          else if (onlineAmount > 0) modeBucket = 'online'

          const purchaseTotal = normalizeAmount(bill.totalAmount)
          const purchasePaid = normalizeAmount(bill.paidAmount)
          const status = purchaseTotal > 0 && purchasePaid >= purchaseTotal ? 'paid' : purchasePaid > 0 ? 'partial' : 'unpaid'
          const sellerIfsc = String(farmer.ifscCode || latestPayment?.ifscCode || '').trim().toUpperCase()
          const bankName =
            String(farmer.bankName || latestPayment?.bankNameSnapshot || '').trim() ||
            (sellerIfsc ? bankNameByIfsc.get(sellerIfsc) || '' : '') ||
            'Not Available'

          if (bankName && bankName !== 'Not Available') collectedBanks.add(bankName)

          const row: ReportRow = {
            Party_Type: 'Farmer',
            Bill_No: String(bill.billNo || '').trim(),
            Seller_Name: String(bill.farmerNameSnapshot || farmer.name || '').trim(),
            Seller_Address: String(bill.farmerAddressSnapshot || farmer.address || '').trim(),
            SellerMob: String(bill.farmerContactSnapshot || farmer.phone1 || '').trim(),
            Anubandh_No: String(bill.krashakAnubandhSnapshot || farmer.krashakAnubandhNumber || '').trim(),
            Anubandh_Date: formatCompactDate(bill.billDate),
            Bhugtan_No: String(latestPayment?.billNo || bill.billNo || '').trim(),
            Bhugtan_Date: formatCompactDate(latestPayment?.payDate),
            Auction_Rate: round2(totalWeight > 0 ? weightedRate / totalWeight : normalizeAmount(purchaseItems[0]?.rate)),
            Actual_Weight: round3(totalWeight),
            Total_Hammali_Toul: round2(totalHammali),
            Farmer_Payment: round2(normalizeAmount(bill.totalAmount)),
            Payment_Mode: resolveModeCode(modeBucket),
            CashAmount: round2(cashAmount),
            Cash_Payment_Date: cashPaymentDate,
            Online_Pay_Amount: round2(netOnlineAmount),
            Online_Payment_Date: onlinePaymentDate || bankPaymentDate,
            IFSC_Code: sellerIfsc || '0',
            Farmer_BankAccount: String(farmer.accountNo || latestPayment?.beneficiaryBankAccount || '').trim() || '0',
            UTR: String(latestPayment?.txnRef || '').trim() || '0',
            ASFlag: String(latestPayment?.asFlag || '').trim() || statusToFlag(status),
            Pending_Amount: round2(Math.max(0, purchaseTotal - purchasePaid)),
            Payment_Status: status,
            Bank_Name: bankName,
            Company_Name: dataset.companyName,
            _status: status,
            _modeBucket: modeBucket,
            _sortTs: toTimestamp(latestPayment?.payDate) || toTimestamp(bill.billDate),
            _source: 'purchase'
          }

          reportRows.push(row)
        }

        for (const bill of dataset.specialPurchaseBills) {
          const supplier = bill.supplier || {}
          const specialItems = Array.isArray(bill.specialPurchaseItems) ? bill.specialPurchaseItems : []
          const totalWeight = specialItems.reduce((acc, item) => acc + normalizeAmount(item.weight), 0)
          const totalOtherAmount = specialItems.reduce((acc, item) => acc + normalizeAmount(item.otherAmount), 0)
          const weightedRate = specialItems.reduce(
            (acc, item) => acc + normalizeAmount(item.weight) * normalizeAmount(item.rate),
            0
          )

          const allPayments = (paymentsByBill.get(`purchase:${bill.id}`) || []).sort(
            (a, b) => toTimestamp(b.payDate) - toTimestamp(a.payDate)
          )
          const paymentsInRange = allPayments.filter((payment) => passesDateRange(payment.payDate, fromDate, toDate))
          const billInRange = passesDateRange(bill.billDate, fromDate, toDate)
          if (!billInRange && paymentsInRange.length === 0) continue

          if (billInRange) {
            const specialTotal = normalizeAmount(bill.totalAmount)
            const specialPaid = normalizeAmount(bill.paidAmount)
            analysisAccumulator.purchaseTotal += specialTotal
            analysisAccumulator.purchasePaid += specialPaid
            analysisAccumulator.purchaseBalance += Math.max(0, specialTotal - specialPaid)
            analysisAccumulator.purchaseWeightedRate += weightedRate
            analysisAccumulator.purchaseWeight += totalWeight
          }

          if (reportType === 'sales') continue

          const effectivePayments = paymentsInRange

          let cashAmount = 0
          let onlineAmount = 0
          let bankAmount = 0
          let cashPaymentDate = ''
          let onlinePaymentDate = ''
          let bankPaymentDate = ''

          for (const payment of effectivePayments) {
            const modeBucket = resolveModeBucket(payment.mode)
            const split = derivePaymentSplit(payment, modeBucket)

            if (modeBucket === 'cash') {
              cashAmount += split.cash
              if (!cashPaymentDate) cashPaymentDate = formatCompactDate(payment.cashPaymentDate || payment.payDate)
            } else if (modeBucket === 'bank') {
              bankAmount += split.online
              if (!bankPaymentDate) bankPaymentDate = formatCompactDate(payment.onlinePaymentDate || payment.payDate)
            } else if (modeBucket === 'online') {
              onlineAmount += split.online
              if (!onlinePaymentDate) onlinePaymentDate = formatCompactDate(payment.onlinePaymentDate || payment.payDate)
            }
          }

          const specialTotal = normalizeAmount(bill.totalAmount)
          const specialPaid = normalizeAmount(bill.paidAmount)

          if (effectivePayments.length === 0 && specialPaid > 0) {
            cashAmount = specialPaid
            cashPaymentDate = formatCompactDate(bill.billDate)
          }

          const netOnlineAmount = onlineAmount + bankAmount
          const latestPayment = effectivePayments[0]

          let modeBucket: ModeBucket = 'none'
          if (cashAmount > 0 && netOnlineAmount > 0) modeBucket = 'mixed'
          else if (cashAmount > 0) modeBucket = 'cash'
          else if (bankAmount > 0) modeBucket = 'bank'
          else if (onlineAmount > 0) modeBucket = 'online'

          const status = specialTotal > 0 && specialPaid >= specialTotal ? 'paid' : specialPaid > 0 ? 'partial' : 'unpaid'
          const sellerIfsc = String(supplier.ifscCode || latestPayment?.ifscCode || '').trim().toUpperCase()
          const bankName =
            String(supplier.bankName || latestPayment?.bankNameSnapshot || '').trim() ||
            (sellerIfsc ? bankNameByIfsc.get(sellerIfsc) || '' : '') ||
            'Not Available'

          if (bankName && bankName !== 'Not Available') collectedBanks.add(bankName)

          const row: ReportRow = {
            Party_Type: 'Supplier',
            Bill_No: String(bill.supplierInvoiceNo || '').trim(),
            Seller_Name: String(supplier.name || '').trim(),
            Seller_Address: String(supplier.address || '').trim(),
            SellerMob: String(supplier.phone1 || '').trim(),
            Anubandh_No: String(supplier.gstNumber || bill.supplierInvoiceNo || '').trim(),
            Anubandh_Date: formatCompactDate(bill.billDate),
            Bhugtan_No: String(latestPayment?.billNo || bill.supplierInvoiceNo || '').trim(),
            Bhugtan_Date: formatCompactDate(latestPayment?.payDate),
            Auction_Rate: round2(totalWeight > 0 ? weightedRate / totalWeight : normalizeAmount(specialItems[0]?.rate)),
            Actual_Weight: round3(totalWeight),
            Total_Hammali_Toul: round2(totalOtherAmount),
            Farmer_Payment: round2(specialTotal),
            Payment_Mode: resolveModeCode(modeBucket),
            CashAmount: round2(cashAmount),
            Cash_Payment_Date: cashPaymentDate,
            Online_Pay_Amount: round2(netOnlineAmount),
            Online_Payment_Date: onlinePaymentDate || bankPaymentDate,
            IFSC_Code: sellerIfsc || '0',
            Farmer_BankAccount: String(supplier.accountNo || latestPayment?.beneficiaryBankAccount || '').trim() || '0',
            UTR: String(latestPayment?.txnRef || '').trim() || '0',
            ASFlag: String(latestPayment?.asFlag || '').trim() || statusToFlag(status),
            Pending_Amount: round2(Math.max(0, specialTotal - specialPaid)),
            Payment_Status: status,
            Bank_Name: bankName,
            Company_Name: dataset.companyName,
            _status: status,
            _modeBucket: modeBucket,
            _sortTs: toTimestamp(latestPayment?.payDate) || toTimestamp(bill.billDate),
            _source: 'purchase'
          }

          reportRows.push(row)
        }

        for (const bill of dataset.salesBills) {
          const party = bill.party || {}
          const salesItems = Array.isArray(bill.salesItems) ? bill.salesItems : []
          const totalWeight = salesItems.reduce((acc, item) => acc + normalizeAmount(item.weight), 0)
          const weightedRate = salesItems.reduce(
            (acc, item) => acc + normalizeAmount(item.weight) * normalizeAmount(item.rate),
            0
          )

          const allPayments = (paymentsByBill.get(`sales:${bill.id}`) || []).sort(
            (a, b) => toTimestamp(b.payDate) - toTimestamp(a.payDate)
          )
          const paymentsInRange = allPayments.filter((payment) => passesDateRange(payment.payDate, fromDate, toDate))
          const billInRange = passesDateRange(bill.billDate, fromDate, toDate)
          if (!billInRange && paymentsInRange.length === 0) continue

          if (billInRange) {
            const salesTotal = normalizeAmount(bill.totalAmount)
            const salesReceived = normalizeAmount(bill.receivedAmount)
            analysisAccumulator.salesTotal += salesTotal
            analysisAccumulator.salesReceived += salesReceived
            analysisAccumulator.salesBalance += Math.max(0, salesTotal - salesReceived)
            analysisAccumulator.salesWeightedRate += weightedRate
            analysisAccumulator.salesWeight += totalWeight
          }

          if (reportType === 'purchase') continue

          const effectivePayments = paymentsInRange

          let cashAmount = 0
          let onlineAmount = 0
          let bankAmount = 0
          let cashPaymentDate = ''
          let onlinePaymentDate = ''
          let bankPaymentDate = ''

          for (const payment of effectivePayments) {
            const modeBucket = resolveModeBucket(payment.mode)
            const split = derivePaymentSplit(payment, modeBucket)

            if (modeBucket === 'cash') {
              cashAmount += split.cash
              if (!cashPaymentDate) cashPaymentDate = formatCompactDate(payment.cashPaymentDate || payment.payDate)
            } else if (modeBucket === 'bank') {
              bankAmount += split.online
              if (!bankPaymentDate) bankPaymentDate = formatCompactDate(payment.onlinePaymentDate || payment.payDate)
            } else if (modeBucket === 'online') {
              onlineAmount += split.online
              if (!onlinePaymentDate) onlinePaymentDate = formatCompactDate(payment.onlinePaymentDate || payment.payDate)
            }
          }

          if (effectivePayments.length === 0 && normalizeAmount(bill.receivedAmount) > 0) {
            cashAmount = normalizeAmount(bill.receivedAmount)
            cashPaymentDate = formatCompactDate(bill.billDate)
          }

          const netOnlineAmount = onlineAmount + bankAmount
          const latestPayment = effectivePayments[0]

          let modeBucket: ModeBucket = 'none'
          if (cashAmount > 0 && netOnlineAmount > 0) modeBucket = 'mixed'
          else if (cashAmount > 0) modeBucket = 'cash'
          else if (bankAmount > 0) modeBucket = 'bank'
          else if (onlineAmount > 0) modeBucket = 'online'

          const salesTotal = normalizeAmount(bill.totalAmount)
          const salesReceived = normalizeAmount(bill.receivedAmount)
          const status = salesTotal > 0 && salesReceived >= salesTotal ? 'paid' : salesReceived > 0 ? 'partial' : 'unpaid'
          const sellerIfsc = String(latestPayment?.ifscCode || '').trim().toUpperCase()
          const bankName =
            String(latestPayment?.bankNameSnapshot || '').trim() ||
            (sellerIfsc ? bankNameByIfsc.get(sellerIfsc) || '' : '') ||
            'Not Available'

          if (bankName && bankName !== 'Not Available') collectedBanks.add(bankName)

          const row: ReportRow = {
            Party_Type: 'Buyer',
            Bill_No: String(bill.billNo || '').trim(),
            Seller_Name: String(party.name || '').trim(),
            Seller_Address: String(party.address || '').trim(),
            SellerMob: String(party.phone1 || '').trim(),
            Anubandh_No: String(bill.billNo || '').trim(),
            Anubandh_Date: formatCompactDate(bill.billDate),
            Bhugtan_No: String(latestPayment?.billNo || bill.billNo || '').trim(),
            Bhugtan_Date: formatCompactDate(latestPayment?.payDate),
            Auction_Rate: round2(totalWeight > 0 ? weightedRate / totalWeight : normalizeAmount(salesItems[0]?.rate)),
            Actual_Weight: round3(totalWeight),
            Total_Hammali_Toul: 0,
            Farmer_Payment: round2(normalizeAmount(bill.totalAmount)),
            Payment_Mode: resolveModeCode(modeBucket),
            CashAmount: round2(cashAmount),
            Cash_Payment_Date: cashPaymentDate,
            Online_Pay_Amount: round2(netOnlineAmount),
            Online_Payment_Date: onlinePaymentDate || bankPaymentDate,
            IFSC_Code: sellerIfsc || '0',
            Farmer_BankAccount: String(latestPayment?.beneficiaryBankAccount || '').trim() || '0',
            UTR: String(latestPayment?.txnRef || '').trim() || '0',
            ASFlag: String(latestPayment?.asFlag || '').trim() || statusToFlag(status),
            Pending_Amount: round2(Math.max(0, salesTotal - salesReceived)),
            Payment_Status: status,
            Bank_Name: bankName,
            Company_Name: dataset.companyName,
            _status: status,
            _modeBucket: modeBucket,
            _sortTs: toTimestamp(latestPayment?.payDate) || toTimestamp(bill.billDate),
            _source: 'sales'
          }

          reportRows.push(row)
        }
      }

      reportRows.sort((a, b) => {
        const paymentDiff = b._sortTs - a._sortTs
        if (paymentDiff !== 0) return paymentDiff
        return String(a.Seller_Name).localeCompare(String(b.Seller_Name))
      })

      setGeneratedRows(reportRows)
      setAnalysisSnapshot(analysisAccumulator)
      setAvailableBanks(Array.from(collectedBanks).sort((a, b) => a.localeCompare(b)))
      setLastGeneratedAt(new Date().toLocaleString('en-IN'))

      if (reportRows.length === 0) {
        setErrorMessage('No records found for selected filters.')
      } else {
        setErrorMessage('')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Report generation failed.'
      setErrorMessage(message)
      setGeneratedRows([])
      setAnalysisSnapshot(EMPTY_ANALYSIS_SNAPSHOT)
      setAvailableBanks([])
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, selectedCompanyId, companies, reportType])

  useEffect(() => {
    if (loadingCompanies) return
    if (!selectedCompanyId) return
    void generateReport()
  }, [loadingCompanies, selectedCompanyId, dateFrom, dateTo, generateReport])

  const filteredRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()

    return generatedRows.filter((row) => {
      if (statusFilter !== 'all' && row._status !== statusFilter) return false

      if (paymentModeFilter !== 'all') {
        if (paymentModeFilter === 'online') {
          if (!(row._modeBucket === 'online' || row._modeBucket === 'mixed')) return false
        } else if (paymentModeFilter === 'bank') {
          if (!(row._modeBucket === 'bank' || row._modeBucket === 'mixed')) return false
        } else if (row._modeBucket !== paymentModeFilter) {
          return false
        }
      }

      if (bankFilter !== 'all' && row.Bank_Name !== bankFilter) return false

      if (!query) return true

      return (
        String(row.Party_Type).toLowerCase().includes(query) ||
        String(row.Seller_Name).toLowerCase().includes(query) ||
        String(row.SellerMob).toLowerCase().includes(query) ||
        String(row.Bill_No).toLowerCase().includes(query) ||
        String(row.Anubandh_No).toLowerCase().includes(query) ||
        String(row.Bhugtan_No).toLowerCase().includes(query) ||
        String(row.Payment_Status).toLowerCase().includes(query) ||
        String(row.Farmer_BankAccount).toLowerCase().includes(query) ||
        String(row.Company_Name).toLowerCase().includes(query)
      )
    })
  }, [generatedRows, statusFilter, paymentModeFilter, bankFilter, searchTerm])

  const summary = useMemo(() => {
    const totals = filteredRows.reduce(
      (acc, row) => {
        acc.farmerPayment += normalizeAmount(row.Farmer_Payment)
        acc.cashAmount += normalizeAmount(row.CashAmount)
        acc.onlineAmount += normalizeAmount(row.Online_Pay_Amount)
        if (row._status === 'paid') acc.paidCount += 1
        if (row._status === 'partial') acc.partialCount += 1
        if (row._status === 'unpaid') acc.unpaidCount += 1
        acc.banks.add(String(row.Bank_Name))
        return acc
      },
      {
        farmerPayment: 0,
        cashAmount: 0,
        onlineAmount: 0,
        paidCount: 0,
        partialCount: 0,
        unpaidCount: 0,
        banks: new Set<string>()
      }
    )

    return {
      totalRecords: filteredRows.length,
      farmerPayment: totals.farmerPayment,
      cashAmount: totals.cashAmount,
      onlineAmount: totals.onlineAmount,
      pendingAmount: Math.max(0, totals.farmerPayment - (totals.cashAmount + totals.onlineAmount)),
      paidCount: totals.paidCount,
      partialCount: totals.partialCount,
      unpaidCount: totals.unpaidCount,
      bankCount: totals.banks.has('Not Available') ? totals.banks.size - 1 : totals.banks.size
    }
  }, [filteredRows])

  const visibleHeaders = useMemo(
    () => availableHeaders.filter((header) => selectedHeaders.includes(header)),
    [availableHeaders, selectedHeaders]
  )

  const filteredSelectableHeaders = useMemo(() => {
    const query = headerSearchTerm.trim().toLowerCase()
    if (!query) return availableHeaders
    return availableHeaders.filter((header) => {
      const label = getHeaderLabel(header, reportType).toLowerCase()
      return header.toLowerCase().includes(query) || label.includes(query)
    })
  }, [availableHeaders, headerSearchTerm, reportType])

  const toggleHeaderSelection = (header: CsvHeader) => {
    setSelectedHeaders((previous) => {
      if (previous.includes(header)) {
        return previous.filter((item) => item !== header)
      }
      return availableHeaders.filter((item) => previous.includes(item) || item === header)
    })
  }

  const setAllHeaders = () => {
    setSelectedHeaders([...availableHeaders])
  }

  const selectFilteredHeaders = () => {
    setSelectedHeaders((previous) => {
      const merged = new Set<CsvHeader>(previous)
      filteredSelectableHeaders.forEach((header) => {
        merged.add(header)
      })
      return availableHeaders.filter((header) => merged.has(header))
    })
  }

  const clearHeaderSelection = () => {
    setSelectedHeaders([])
  }

  const downloadCsv = () => {
    if (filteredRows.length === 0) {
      setErrorMessage('No rows available to export. Generate report first.')
      return
    }

    if (visibleHeaders.length === 0) {
      setErrorMessage('Select at least one header checkbox before exporting CSV.')
      return
    }

    const csv = [
      visibleHeaders.map((header) => csvEscape(getHeaderLabel(header, reportType))).join(','),
      ...filteredRows.map((row) => visibleHeaders.map((header) => csvEscape(row[header])).join(','))
    ].join('\n')

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const scopeLabel = selectedCompanyId || 'company'
    const fileName = `${reportType}_report_${scopeLabel}_${dateFrom}_${dateTo}_${stamp}.csv`

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const downloadPdf = () => {
    if (filteredRows.length === 0) {
      setErrorMessage('No rows available to export. Generate report first.')
      return
    }

    if (visibleHeaders.length === 0) {
      setErrorMessage('Select at least one header checkbox before exporting PDF.')
      return
    }

    printSimpleTableReport(
      reportTitle,
      `${selectedCompanyName || 'Selected company'} | ${dateFrom} to ${dateTo}`,
      visibleHeaders.map((header) => getHeaderLabel(header, reportType)),
      filteredRows.map((row) => visibleHeaders.map((header) => String(row[header] ?? '-')))
    )
  }

  const clearOptionalFilters = () => {
    setStatusFilter('all')
    setPaymentModeFilter('all')
    setBankFilter('all')
    setSearchTerm('')
  }

  const reportTitle =
    reportType === 'purchase'
      ? 'Purchase Report'
      : reportType === 'sales'
        ? 'Sales Report'
        : 'Report Dashboard'

  const reportDescription =
    reportType === 'purchase'
      ? 'See total purchase, paid amount, pending amount, and payment details.'
      : reportType === 'sales'
        ? 'See total sales, received amount, pending amount, and collection details.'
        : 'See purchase, sales, paid, received, and pending amounts in one place.'

  const searchLabel = reportType === 'sales' ? 'Search Party' : 'Search Seller'
  const searchPlaceholder = reportType === 'sales' ? 'Party / Mobile / Invoice / Payment Ref' : 'Seller / Mobile / Anubandh'
  const surfaceCardClass = 'rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]'
  const mutedPillClass = 'rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600'

  const analysisRows = useMemo(() => {
    const purchaseAverageRate =
      analysisSnapshot.purchaseWeight > 0
        ? analysisSnapshot.purchaseWeightedRate / analysisSnapshot.purchaseWeight
        : 0
    const salesAverageRate =
      analysisSnapshot.salesWeight > 0 ? analysisSnapshot.salesWeightedRate / analysisSnapshot.salesWeight : 0

    return [
      {
        label: 'Total Amount',
        purchase: analysisSnapshot.purchaseTotal,
        sales: analysisSnapshot.salesTotal
      },
      {
        label: 'Average Rate',
        purchase: purchaseAverageRate,
        sales: salesAverageRate
      },
      {
        label: 'Paid / Received',
        purchase: analysisSnapshot.purchasePaid,
        sales: analysisSnapshot.salesReceived
      },
      {
        label: 'Pending Amount',
        purchase: analysisSnapshot.purchaseBalance,
        sales: analysisSnapshot.salesBalance
      }
    ].map((row) => {
      const profitLoss = row.sales - row.purchase
      return {
        ...row,
        profitLoss,
        margin: calculateMarginPercent(row.purchase, row.sales)
      }
    })
  }, [analysisSnapshot])

  const summaryCards = useMemo(() => {
    const totals = filteredRows.reduce(
      (acc, row) => {
        const totalAmount = normalizeAmount(row.Farmer_Payment)
        const pendingAmount = normalizeAmount(row.Pending_Amount)
        const clearedAmount = Math.max(0, totalAmount - pendingAmount)

        if (row._source === 'sales') {
          acc.salesTotal += totalAmount
          acc.salesReceived += clearedAmount
          acc.salesPending += pendingAmount
        } else {
          acc.purchaseTotal += totalAmount
          acc.purchasePaid += clearedAmount
          acc.purchasePending += pendingAmount
        }

        return acc
      },
      {
        salesTotal: 0,
        salesReceived: 0,
        salesPending: 0,
        purchaseTotal: 0,
        purchasePaid: 0,
        purchasePending: 0
      }
    )

    if (reportType === 'sales') {
      return [
        { label: 'Total Sales', helper: 'Total bill amount', value: round2(totals.salesTotal), tone: 'text-slate-900', format: 'amount' as const },
        { label: 'Received', helper: 'Money collected', value: round2(totals.salesReceived), tone: 'text-emerald-700', format: 'amount' as const },
        { label: 'Pending', helper: 'Money still to collect', value: round2(totals.salesPending), tone: 'text-amber-700', format: 'amount' as const },
        { label: 'Bills', helper: 'Bills in this report', value: summary.totalRecords, tone: 'text-sky-700', format: 'count' as const }
      ]
    }

    if (reportType === 'purchase') {
      return [
        { label: 'Total Purchase', helper: 'Total bill amount', value: round2(totals.purchaseTotal), tone: 'text-slate-900', format: 'amount' as const },
        { label: 'Paid', helper: 'Money already paid', value: round2(totals.purchasePaid), tone: 'text-rose-700', format: 'amount' as const },
        { label: 'Pending', helper: 'Money still to pay', value: round2(totals.purchasePending), tone: 'text-amber-700', format: 'amount' as const },
        { label: 'Bills', helper: 'Bills in this report', value: summary.totalRecords, tone: 'text-sky-700', format: 'count' as const }
      ]
    }

    return [
      { label: 'Sales Total', helper: 'All sales bills', value: round2(totals.salesTotal), tone: 'text-slate-900', format: 'amount' as const },
      { label: 'Purchase Total', helper: 'All purchase bills', value: round2(totals.purchaseTotal), tone: 'text-slate-900', format: 'amount' as const },
      { label: 'Received', helper: 'Money collected', value: round2(totals.salesReceived), tone: 'text-emerald-700', format: 'amount' as const },
      { label: 'Paid', helper: 'Money already paid', value: round2(totals.purchasePaid), tone: 'text-rose-700', format: 'amount' as const },
      { label: 'Sales Pending', helper: 'Still to collect', value: round2(totals.salesPending), tone: 'text-amber-700', format: 'amount' as const },
      { label: 'Purchase Pending', helper: 'Still to pay', value: round2(totals.purchasePending), tone: 'text-sky-700', format: 'amount' as const }
    ]
  }, [filteredRows, reportType, summary.totalRecords])

  return (
    <div className="space-y-6">
      <section className={`${surfaceCardClass} p-6 md:p-8`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-3xl">
            <h2 className={embedded ? 'mt-3 text-2xl font-semibold tracking-tight text-slate-950' : 'mt-3 text-3xl font-semibold tracking-tight text-slate-950'}>
              {reportTitle}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{reportDescription}</p>
          </div>

          <div className="flex flex-wrap gap-2 xl:justify-end">
            {!embedded && onBackToDashboard && (
              <Button variant="outline" onClick={onBackToDashboard} className="rounded-2xl border-slate-200 bg-white hover:bg-slate-50">
                Back to Dashboard
              </Button>
            )}
            <Button variant="outline" onClick={clearOptionalFilters} disabled={loading} className="rounded-2xl border-slate-200 bg-white hover:bg-slate-50">
              <Filter className="mr-2 h-4 w-4" />
              Clear
            </Button>
            <Button onClick={generateReport} disabled={loading || loadingCompanies} className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800">
              {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}
              {loading ? 'Generating...' : 'Refresh'}
            </Button>
            <Button
              variant="outline"
              onClick={downloadCsv}
              disabled={filteredRows.length === 0 || loading}
              className="rounded-2xl border-slate-200 bg-white hover:bg-slate-50"
            >
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button
              variant="outline"
              onClick={downloadPdf}
              disabled={filteredRows.length === 0 || loading}
              className="rounded-2xl border-slate-200 bg-white hover:bg-slate-50"
            >
              <FileText className="mr-2 h-4 w-4" />
              PDF
            </Button>
          </div>
        </div>
      </section>

      {errorMessage && (
        <div className="rounded-[1.25rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <Card className={surfaceCardClass}>
        <CardHeader className="border-b border-slate-100 pb-5">
          <CardTitle className="text-2xl tracking-tight text-slate-950">Report Filters</CardTitle>
          <CardDescription>Choose company, dates, and filters to see the report.</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label>Company</Label>
              <Select
                value={selectedCompanyId || 'none'}
                onValueChange={(value) => setSelectedCompanyId(value === 'none' ? '' : value)}
                disabled={companies.length === 0}
              >
                <SelectTrigger className="rounded-2xl border-slate-200 bg-white">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.length === 0 && <SelectItem value="none">No company found</SelectItem>}
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dateFrom">Date From</Label>
              <Input id="dateFrom" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="rounded-2xl border-slate-200 bg-white" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dateTo">Date To</Label>
              <Input id="dateTo" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="rounded-2xl border-slate-200 bg-white" />
            </div>

            <div className="space-y-2">
              <Label>Payment Mode</Label>
              <Select value={paymentModeFilter} onValueChange={(value) => setPaymentModeFilter(value as ModeFilter)}>
                <SelectTrigger className="rounded-2xl border-slate-200 bg-white">
                  <SelectValue placeholder="All payment modes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Modes</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="online">Online / UPI</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                  <SelectItem value="none">No Payment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                <SelectTrigger className="rounded-2xl border-slate-200 bg-white">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Bank</Label>
              <Select value={bankFilter} onValueChange={setBankFilter}>
                <SelectTrigger className="rounded-2xl border-slate-200 bg-white">
                  <SelectValue placeholder="All banks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Banks</SelectItem>
                  {availableBanks.map((bankName) => (
                    <SelectItem key={bankName} value={bankName}>
                      {bankName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="searchReport">{searchLabel}</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  id="searchReport"
                  className="rounded-2xl border-slate-200 bg-white pl-9"
                  placeholder={searchPlaceholder}
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className={mutedPillClass}>
              {reportType === 'purchase'
                ? 'Shows purchase bills and paid amounts'
                : reportType === 'sales'
                  ? 'Shows sales bills and received payments'
                  : 'Shows sales, purchase, paid, received, and pending amounts'}
            </span>
            <span className={mutedPillClass}>Columns selected: {visibleHeaders.length} / {availableHeaders.length}</span>
            {lastGeneratedAt && <span className={mutedPillClass}>Updated: {lastGeneratedAt}</span>}
          </div>
        </CardContent>
      </Card>

      {reportType === 'main' ? (
        <Card className={surfaceCardClass}>
        <CardHeader className="border-b border-slate-100 pb-5">
          <CardTitle className="text-2xl tracking-tight text-slate-950">Purchase vs Sales Summary</CardTitle>
          <CardDescription>
            Compare purchase amount, sales amount, paid, received, and pending totals for the selected period.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            This table helps you quickly compare what you bought, what you sold, and what is still pending.
          </div>
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Purchase</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Profit / Loss</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysisRows.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="font-medium text-slate-800">{row.label}</TableCell>
                    <TableCell className="text-right">{numberFormatter.format(row.purchase)}</TableCell>
                    <TableCell className="text-right">{numberFormatter.format(row.sales)}</TableCell>
                    <TableCell className={`text-right font-medium ${row.profitLoss >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {numberFormatter.format(row.profitLoss)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-slate-700">{formatMargin(row.margin)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        </Card>
      ) : null}

      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${reportType === 'main' ? 'xl:grid-cols-6' : 'xl:grid-cols-4'}`}>
        {summaryCards.map((card) => (
          <Card key={card.label} className={surfaceCardClass}>
            <CardContent className="pt-6">
              <p className="text-xs font-medium text-slate-500">{card.label}</p>
              <p className={`mt-1 text-2xl font-semibold ${card.tone}`}>
                {card.format === 'count' ? countFormatter.format(card.value) : numberFormatter.format(card.value)}
              </p>
              <p className="mt-2 text-xs text-slate-500">{card.helper}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className={surfaceCardClass}>
        <CardHeader className="border-b border-slate-100 pb-5">
          <CardTitle className="flex items-center gap-2 text-2xl tracking-tight text-slate-950">
            <Table2 className="h-5 w-5" />
            Columns to Show
          </CardTitle>
          <CardDescription>Choose which columns you want in the table and CSV file.</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="rounded-2xl border-slate-200 bg-white pl-9"
                placeholder="Search report header..."
                value={headerSearchTerm}
                onChange={(event) => setHeaderSearchTerm(event.target.value)}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={selectFilteredHeaders} className="rounded-2xl border-slate-200 bg-white hover:bg-slate-50">
              Select Search Result
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={setAllHeaders} className="rounded-2xl border-slate-200 bg-white hover:bg-slate-50">
              Select All
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={clearHeaderSelection} className="rounded-2xl border-slate-200 bg-white hover:bg-slate-50">
              Clear All
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {filteredSelectableHeaders.map((header) => {
              const checked = selectedHeaders.includes(header)
              return (
                <label
                  key={header}
                  className={`flex cursor-pointer items-center gap-2 rounded-[1rem] border px-3 py-3 text-sm transition-colors ${
                    checked ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleHeaderSelection(header)}
                    className="h-4 w-4 cursor-pointer rounded border-slate-300"
                  />
                  <span className="font-medium">{getHeaderLabel(header, reportType)}</span>
                </label>
              )
            })}
            {filteredSelectableHeaders.length === 0 && (
              <div className="rounded-[1rem] border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">
                No header matches your search.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className={surfaceCardClass}>
        <CardHeader className="border-b border-slate-100 pb-5">
          <CardTitle className="text-2xl tracking-tight text-slate-950">
            {reportType === 'purchase'
              ? 'Purchase Report Table'
              : reportType === 'sales'
                ? 'Sales Report Table'
                : 'Payment History Table'}
          </CardTitle>
          <CardDescription>
            {filteredRows.length} rows after filters | Paid: {summary.paidCount} | Partial: {summary.partialCount} | Unpaid: {summary.unpaidCount}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="overflow-x-auto rounded-[1.35rem] border border-slate-200">
            <Table className="min-w-[1800px] bg-white">
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  {visibleHeaders.map((header) => (
                    <TableHead key={header}>{getHeaderLabel(header, reportType)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row, index) => (
                  <TableRow key={`${row.Company_Name}-${row.Bill_No}-${index}`}>
                    <TableCell>{index + 1}</TableCell>
                    {visibleHeaders.map((header) => (
                      <TableCell key={`${header}-${index}`}>{String(row[header])}</TableCell>
                    ))}
                  </TableRow>
                ))}

                {filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={Math.max(2, visibleHeaders.length + 1)} className="text-center text-slate-500">
                      {loading ? 'Generating report...' : 'No rows found. Update filters and click Generate Report.'}
                    </TableCell>
                  </TableRow>
                )}
                {filteredRows.length > 0 && visibleHeaders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-slate-500">
                      Select at least one header in Report Includes to preview table columns.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
