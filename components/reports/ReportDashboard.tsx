'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, Filter, RefreshCw, Search, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const BASE_HEADERS = [
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

const CSV_HEADERS = [...BASE_HEADERS, 'Bank_Name', 'Company_Name'] as const

type CsvHeader = (typeof CSV_HEADERS)[number]
type ReportScope = 'individual-trader' | 'company'
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
  salesBills: SalesBillRecord[]
  payments: PaymentRecord[]
  banks: BankRecord[]
}

type ReportRow = Record<CsvHeader, string | number> & {
  _status: string
  _modeBucket: ModeBucket
  _sortTs: number
}

interface ReportDashboardProps {
  initialCompanyId?: string
  embedded?: boolean
  onBackToDashboard?: () => void
}

const numberFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
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
  onBackToDashboard
}: ReportDashboardProps) {
  const today = useMemo(() => new Date(), [])
  const firstDay = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today])

  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [scope, setScope] = useState<ReportScope>(initialCompanyId ? 'company' : 'individual-trader')
  const [selectedCompanyId, setSelectedCompanyId] = useState(initialCompanyId || '')
  const [dateFrom, setDateFrom] = useState(toDateInputValue(firstDay))
  const [dateTo, setDateTo] = useState(toDateInputValue(today))
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [paymentModeFilter, setPaymentModeFilter] = useState<ModeFilter>('all')
  const [bankFilter, setBankFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [headerSearchTerm, setHeaderSearchTerm] = useState('')
  const [selectedHeaders, setSelectedHeaders] = useState<CsvHeader[]>([...CSV_HEADERS])

  const [generatedRows, setGeneratedRows] = useState<ReportRow[]>([])
  const [availableBanks, setAvailableBanks] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingCompanies, setLoadingCompanies] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [lastGeneratedAt, setLastGeneratedAt] = useState('')
  const [autoScopeFallbackDone, setAutoScopeFallbackDone] = useState(false)

  useEffect(() => {
    if (initialCompanyId) {
      setSelectedCompanyId(initialCompanyId)
      setScope('company')
    }
  }, [initialCompanyId])

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

    const targetCompanyIds =
      scope === 'company'
        ? selectedCompanyId
          ? [selectedCompanyId]
          : []
        : companies.map((company) => company.id)

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
          const [purchaseRes, salesRes, paymentRes, banksRes] = await Promise.all([
            fetch(`/api/purchase-bills?companyId=${encodeURIComponent(companyId)}&dateFrom=${queryFrom}&dateTo=${queryTo}`),
            fetch(`/api/sales-bills?companyId=${encodeURIComponent(companyId)}`),
            fetch(`/api/payments?companyId=${encodeURIComponent(companyId)}`),
            fetch(`/api/banks?companyId=${encodeURIComponent(companyId)}`)
          ])

          if (!purchaseRes.ok && !salesRes.ok) {
            throw new Error(`Failed to load bills for ${companyNameMap.get(companyId) || companyId}`)
          }

          const purchasePayload = purchaseRes.ok ? await purchaseRes.json().catch(() => []) : []
          const salesPayload = salesRes.ok ? await salesRes.json().catch(() => []) : []
          const paymentPayload = paymentRes.ok ? await paymentRes.json().catch(() => []) : []
          const bankPayload = banksRes.ok ? await banksRes.json().catch(() => []) : []

          return {
            companyId,
            companyName: companyNameMap.get(companyId) || companyId,
            purchaseBills: normalizeCollection<PurchaseBillRecord>(purchasePayload),
            salesBills: normalizeCollection<SalesBillRecord>(salesPayload),
            payments: normalizeCollection<PaymentRecord>(paymentPayload),
            banks: normalizeCollection<BankRecord>(bankPayload)
          } satisfies CompanyDataset
        })
      )

      const collectedBanks = new Set<string>()
      const reportRows: ReportRow[] = []

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
            Bank_Name: bankName,
            Company_Name: dataset.companyName,
            _status: status,
            _modeBucket: modeBucket,
            _sortTs: toTimestamp(latestPayment?.payDate) || toTimestamp(bill.billDate)
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
            Bank_Name: bankName,
            Company_Name: dataset.companyName,
            _status: status,
            _modeBucket: modeBucket,
            _sortTs: toTimestamp(latestPayment?.payDate) || toTimestamp(bill.billDate)
          }

          reportRows.push(row)
        }
      }

      reportRows.sort((a, b) => {
        const paymentDiff = b._sortTs - a._sortTs
        if (paymentDiff !== 0) return paymentDiff
        return String(a.Seller_Name).localeCompare(String(b.Seller_Name))
      })

      if (reportRows.length === 0 && scope === 'company' && companies.length > 1 && !autoScopeFallbackDone) {
        setAutoScopeFallbackDone(true)
        setScope('individual-trader')
        setErrorMessage('No records found for selected company. Switched to Individual Trader scope.')
        return
      }

      setGeneratedRows(reportRows)
      setAvailableBanks(Array.from(collectedBanks).sort((a, b) => a.localeCompare(b)))
      setLastGeneratedAt(new Date().toLocaleString('en-IN'))

      if (reportRows.length === 0) {
        setErrorMessage('No records found for selected filters. Try wider date range or Individual Trader scope.')
      } else {
        setErrorMessage('')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Report generation failed.'
      setErrorMessage(message)
      setGeneratedRows([])
      setAvailableBanks([])
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, scope, selectedCompanyId, companies, autoScopeFallbackDone])

  useEffect(() => {
    if (loadingCompanies) return
    if (scope === 'company' && !selectedCompanyId) return
    void generateReport()
  }, [loadingCompanies, scope, selectedCompanyId, dateFrom, dateTo, generateReport])

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
        String(row.Seller_Name).toLowerCase().includes(query) ||
        String(row.SellerMob).toLowerCase().includes(query) ||
        String(row.Anubandh_No).toLowerCase().includes(query) ||
        String(row.Bhugtan_No).toLowerCase().includes(query) ||
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
    () => CSV_HEADERS.filter((header) => selectedHeaders.includes(header)),
    [selectedHeaders]
  )

  const filteredSelectableHeaders = useMemo(() => {
    const query = headerSearchTerm.trim().toLowerCase()
    if (!query) return CSV_HEADERS
    return CSV_HEADERS.filter((header) => header.toLowerCase().includes(query))
  }, [headerSearchTerm])

  const toggleHeaderSelection = (header: CsvHeader) => {
    setSelectedHeaders((previous) => {
      if (previous.includes(header)) {
        return previous.filter((item) => item !== header)
      }
      return CSV_HEADERS.filter((item) => previous.includes(item) || item === header)
    })
  }

  const setAllHeaders = () => {
    setSelectedHeaders([...CSV_HEADERS])
  }

  const selectFilteredHeaders = () => {
    setSelectedHeaders((previous) => {
      const merged = new Set<CsvHeader>(previous)
      filteredSelectableHeaders.forEach((header) => {
        merged.add(header)
      })
      return CSV_HEADERS.filter((header) => merged.has(header))
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
      visibleHeaders.join(','),
      ...filteredRows.map((row) => visibleHeaders.map((header) => csvEscape(row[header])).join(','))
    ].join('\n')

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const scopeLabel = scope === 'individual-trader' ? 'individual-trader' : 'company'
    const fileName = `payment_history_${scopeLabel}_${dateFrom}_${dateTo}_${stamp}.csv`

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

  const clearOptionalFilters = () => {
    setStatusFilter('all')
    setPaymentModeFilter('all')
    setBankFilter('all')
    setSearchTerm('')
    setAutoScopeFallbackDone(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={embedded ? 'text-2xl font-bold text-slate-900' : 'text-3xl font-bold text-slate-900'}>Report</h2>
          <p className="text-sm text-slate-500">Connected to purchase + sales + payment attributes. CSV exports only selected headers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!embedded && onBackToDashboard && (
            <Button variant="outline" onClick={onBackToDashboard}>
              Back to Dashboard
            </Button>
          )}
          <Button variant="outline" onClick={clearOptionalFilters} disabled={loading}>
            <Filter className="mr-2 h-4 w-4" />
            Clear Filters
          </Button>
          <Button onClick={generateReport} disabled={loading || loadingCompanies}>
            {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}
            {loading ? 'Generating...' : 'Generate Report'}
          </Button>
          <Button variant="outline" onClick={downloadCsv} disabled={filteredRows.length === 0 || loading}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV (Selected Headers)
          </Button>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Filter Options</CardTitle>
          <CardDescription>Report auto-refreshes on company/scope/date changes.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label>Report Scope</Label>
              <Select
                value={scope}
                onValueChange={(value) => {
                  setScope(value as ReportScope)
                  setAutoScopeFallbackDone(false)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual-trader">Individual Trader (All Companies)</SelectItem>
                  <SelectItem value="company">Company Wise</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Company</Label>
              <Select
                value={selectedCompanyId || 'none'}
                onValueChange={(value) => {
                  setSelectedCompanyId(value === 'none' ? '' : value)
                  setAutoScopeFallbackDone(false)
                }}
                disabled={scope === 'individual-trader' || companies.length === 0}
              >
                <SelectTrigger>
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
              <Input id="dateFrom" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dateTo">Date To</Label>
              <Input id="dateTo" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Payment Mode</Label>
              <Select value={paymentModeFilter} onValueChange={(value) => setPaymentModeFilter(value as ModeFilter)}>
                <SelectTrigger>
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
                <SelectTrigger>
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
                <SelectTrigger>
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
              <Label htmlFor="searchReport">Search Seller</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  id="searchReport"
                  className="pl-9"
                  placeholder="Seller / Mobile / Anubandh"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1">Connected with sales + purchase bills + payments</span>
            <span className="rounded-full bg-slate-100 px-3 py-1">Selected headers: {visibleHeaders.length} / {CSV_HEADERS.length}</span>
            {lastGeneratedAt && <span className="rounded-full bg-slate-100 px-3 py-1">Last generated: {lastGeneratedAt}</span>}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-slate-500">Total Records</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{summary.totalRecords}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-slate-500">Farmer Payment</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{numberFormatter.format(summary.farmerPayment)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-slate-500">Cash Amount</p>
            <p className="mt-1 text-2xl font-semibold text-green-700">{numberFormatter.format(summary.cashAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-slate-500">Online + Bank</p>
            <p className="mt-1 text-2xl font-semibold text-blue-700">{numberFormatter.format(summary.onlineAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-slate-500">Pending / Banks</p>
            <p className="mt-1 text-2xl font-semibold text-amber-700">
              {numberFormatter.format(summary.pendingAmount)} / {summary.bankCount}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Table2 className="h-5 w-5" />
            Report Includes
          </CardTitle>
          <CardDescription>Search header and tick checkbox to control CSV/table columns.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9"
                placeholder="Search report header..."
                value={headerSearchTerm}
                onChange={(event) => setHeaderSearchTerm(event.target.value)}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={selectFilteredHeaders}>
              Select Search Result
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={setAllHeaders}>
              Select All
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={clearHeaderSelection}>
              Clear All
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {filteredSelectableHeaders.map((header) => {
              const checked = selectedHeaders.includes(header)
              return (
                <label
                  key={header}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                    checked ? 'border-blue-400 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleHeaderSelection(header)}
                    className="h-4 w-4 cursor-pointer rounded border-slate-300"
                  />
                  <span className="font-medium">{header}</span>
                </label>
              )
            })}
            {filteredSelectableHeaders.length === 0 && (
              <div className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">
                No header matches your search.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment History Table</CardTitle>
          <CardDescription>
            {filteredRows.length} rows after applied filters | Paid: {summary.paidCount} | Partial: {summary.partialCount} | Unpaid: {summary.unpaidCount}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table className="min-w-[1800px]">
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                {visibleHeaders.map((header) => (
                  <TableHead key={header}>{header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row, index) => (
                <TableRow key={`${row.Company_Name}-${row.Anubandh_No}-${index}`}>
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
        </CardContent>
      </Card>
    </div>
  )
}
