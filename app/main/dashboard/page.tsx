'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import DashboardLayout from '@/app/components/DashboardLayout'
import {
  ShoppingCart,
  Receipt,
  Package,
  CreditCard,
  FileText,
  Plus,
  Eye,
  Ruler,
  Wallet,
  Building2,
  Boxes,
  Scale,
  Landmark,
  Bell,
  Download
} from 'lucide-react'
import StockManagementTab from './components/StockManagementTab'
import PaymentTab from './components/PaymentTab'
import ReportsTab from './components/ReportsTab'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { stripCompanyParamsFromUrl } from '@/lib/company-context'

type ActiveTab = 'purchase' | 'sales' | 'stock' | 'payment' | 'report'
const DASHBOARD_CACHE_AGE_MS = 15_000

type PurchaseBill = {
  id: string
  companyId?: string
  billNo: string
  billDate: string
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  status: string
  farmer?: { name?: string }
}

type SalesBill = {
  id: string
  companyId?: string
  billNo: string
  billDate: string
  totalAmount: number
  receivedAmount: number
  balanceAmount: number
  status: string
  party?: { name?: string }
}

type Payment = {
  companyId?: string
  billType: 'purchase' | 'sales'
  amount: number
  payDate?: string
  billDate?: string
}

type StockLedgerItem = {
  id: string
  companyId?: string
  entryDate?: string
  qtyIn?: number
  qtyOut?: number
  type?: 'purchase' | 'sales' | 'adjustment'
  product?: {
    id: string
    name: string
    unit: string
  }
}

type MasterRecord = {
  id: string
  companyId?: string
}

type CompanyOption = {
  id: string
  name: string
  locked?: boolean
}

type DashboardData = {
  purchaseBills: PurchaseBill[]
  salesBills: SalesBill[]
  payments: Payment[]
  products: MasterRecord[]
  parties: MasterRecord[]
  units: MasterRecord[]
  stockLedger: StockLedgerItem[]
}

const emptyData: DashboardData = {
  purchaseBills: [],
  salesBills: [],
  payments: [],
  products: [],
  parties: [],
  units: [],
  stockLedger: []
}

const clampNonNegative = (value: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

export default function MainDashboardPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<ActiveTab>('purchase')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DashboardData>(emptyData)
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([])
  const [primaryCompanyId, setPrimaryCompanyId] = useState<string>('')
  const [uiMessage, setUiMessage] = useState<string | null>(null)
  const [uiError, setUiError] = useState<string | null>(null)
  const [fetchFailures, setFetchFailures] = useState<string[]>([])
  const selectedCompanyNames = useMemo(() => {
    const map = new Map(companies.map((item) => [item.id, item.name]))
    return selectedCompanyIds.map((id) => map.get(id) || id)
  }, [companies, selectedCompanyIds])

  const parseApiJson = async <T,>(response: Response, fallback: T): Promise<T> => {
    const raw = await response.text()
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  useEffect(() => {
    stripCompanyParamsFromUrl()
  }, [])

  const loadCompanies = async () => {
    const res = await fetch('/api/companies', { cache: 'no-store' })
    if (!res.ok) {
      if (res.status === 401) {
        router.push('/login')
        return []
      }
      const raw = await res.text().catch(() => '')
      if (res.status >= 500) {
        console.error('Failed to load companies API', {
          status: res.status,
          preview: raw.slice(0, 120)
        })
      }
      return []
    }
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      return []
    }
    const rows = await parseApiJson<any[]>(res, [])
    return Array.isArray(rows)
      ? rows.map((row) => ({
          id: String(row.id),
          name: String(row.name || row.id),
          locked: Boolean(row.locked)
        }))
      : []
  }

  const fetchDashboardData = async (companyIds: string[]) => {
    if (companyIds.length === 0) {
      setData(emptyData)
      setFetchFailures([])
      return
    }
    const failures: string[] = []
    const companyNameMap = new Map(companies.map((item) => [item.id, item.name]))
    const fetchJson = async <T,>(name: string, url: string): Promise<T> => {
      try {
        const res = await fetch(url)
        if (!res.ok) {
          failures.push(name)
          return [] as T
        }
        return res.json()
      } catch {
        failures.push(name)
        return [] as T
      }
    }

    const perCompanyData = await Promise.all(
      companyIds.map(async (id) => {
        const companyLabel = companyNameMap.get(id) || id
        const [purchaseBills, salesBills, payments, products, parties, units, stockLedger] = await Promise.all([
          fetchJson<PurchaseBill[]>(`purchase bills (${companyLabel})`, `/api/purchase-bills?companyId=${id}`),
          fetchJson<SalesBill[]>(`sales bills (${companyLabel})`, `/api/sales-bills?companyId=${id}`),
          fetchJson<Payment[]>(`payments (${companyLabel})`, `/api/payments?companyId=${id}`),
          fetchJson<MasterRecord[]>(`products (${companyLabel})`, `/api/products?companyId=${id}`),
          fetchJson<MasterRecord[]>(`parties (${companyLabel})`, `/api/parties?companyId=${id}`),
          fetchJson<MasterRecord[]>(`units (${companyLabel})`, `/api/units?companyId=${id}`),
          fetchJson<StockLedgerItem[]>(`stock ledger (${companyLabel})`, `/api/stock-ledger?companyId=${id}`)
        ])

        return {
          purchaseBills: Array.isArray(purchaseBills) ? purchaseBills.map((row) => ({ ...row, companyId: row.companyId || id })) : [],
          salesBills: Array.isArray(salesBills) ? salesBills.map((row) => ({ ...row, companyId: row.companyId || id })) : [],
          payments: Array.isArray(payments) ? payments.map((row) => ({ ...row, companyId: row.companyId || id })) : [],
          products: Array.isArray(products) ? products.map((row) => ({ ...row, companyId: row.companyId || id })) : [],
          parties: Array.isArray(parties) ? parties.map((row) => ({ ...row, companyId: row.companyId || id })) : [],
          units: Array.isArray(units) ? units.map((row) => ({ ...row, companyId: row.companyId || id })) : [],
          stockLedger: Array.isArray(stockLedger) ? stockLedger.map((row) => ({ ...row, companyId: row.companyId || id })) : []
        }
      })
    )

    const nextData: DashboardData = {
      purchaseBills: perCompanyData.flatMap((item) => item.purchaseBills),
      salesBills: perCompanyData.flatMap((item) => item.salesBills),
      payments: perCompanyData.flatMap((item) => item.payments),
      products: perCompanyData.flatMap((item) => item.products),
      parties: perCompanyData.flatMap((item) => item.parties),
      units: perCompanyData.flatMap((item) => item.units),
      stockLedger: perCompanyData.flatMap((item) => item.stockLedger)
    }

    setData(nextData)
    setFetchFailures(failures)
    setClientCache(`main-dashboard:${companyIds.slice().sort().join(',')}`, nextData)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const queryParams = new URLSearchParams(window.location.search)
      const queryCompanyId = queryParams.get('companyId') || ''
      const queryCompanyIds = (queryParams.get('companyIds') || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)

      try {
        const list: CompanyOption[] = await loadCompanies()
        if (cancelled) return
        setCompanies(list)

        const availableIds = new Set(list.map((item) => item.id))
        let nextSelected = queryCompanyIds.filter((id) => availableIds.has(id))
        if (nextSelected.length === 0 && queryCompanyId && availableIds.has(queryCompanyId)) {
          nextSelected = [queryCompanyId]
        }
        if (nextSelected.length === 0 && queryCompanyId && list.length === 0) {
          nextSelected = [queryCompanyId]
          setCompanies([{ id: queryCompanyId, name: 'Current Company' }])
        }
        if (nextSelected.length === 0) {
          nextSelected = list.map((item) => item.id)
        }
        const nextPrimary = availableIds.has(queryCompanyId) && nextSelected.includes(queryCompanyId)
          ? queryCompanyId
          : (nextSelected[0] || '')
        setSelectedCompanyIds(nextSelected)
        setPrimaryCompanyId(nextPrimary)
      } catch (error) {
        if (cancelled) return
        void error
        if (queryCompanyId) {
          setCompanies([{ id: queryCompanyId, name: 'Current Company' }])
          setSelectedCompanyIds([queryCompanyId])
          setPrimaryCompanyId(queryCompanyId)
        } else {
          setUiError('Failed to load company list')
        }
      } finally {
        if (cancelled) return
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (selectedCompanyIds.length === 0) return

    const primary = selectedCompanyIds.includes(primaryCompanyId) ? primaryCompanyId : selectedCompanyIds[0]
    if (primary !== primaryCompanyId) {
      setPrimaryCompanyId(primary)
      return
    }

    const normalizedIds = selectedCompanyIds.slice().sort()
    const cacheKey = `main-dashboard:${normalizedIds.join(',')}`
    const cached = getClientCache<DashboardData>(cacheKey, DASHBOARD_CACHE_AGE_MS)
    if (cached) {
      setData(cached)
      setLoading(false)
    }

    stripCompanyParamsFromUrl()

    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        await fetchDashboardData(selectedCompanyIds)
      } finally {
        if (cancelled) return
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedCompanyIds.join(','), primaryCompanyId, companies])

  useEffect(() => {
    if (!primaryCompanyId) return
    void fetch('/api/auth/company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: primaryCompanyId, force: true })
    })
  }, [primaryCompanyId])

  const handleNavigation = async (path: string) => {
    if (!primaryCompanyId) return
    const primaryCompany = companies.find((item) => item.id === primaryCompanyId)
    if (primaryCompany?.locked) {
      setUiError(`"${primaryCompany.name}" is locked by Super Admin. Switch active company to continue.`)
      return
    }

    try {
      await fetch('/api/auth/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: primaryCompanyId, force: true })
      })
    } catch (error) {
      void error
    }

    router.push(path)
  }

  const purchaseStats = useMemo(() => {
    const total = data.purchaseBills.reduce((sum, bill) => sum + clampNonNegative(Number(bill.totalAmount || 0)), 0)
    const paid = data.purchaseBills.reduce((sum, bill) => sum + clampNonNegative(Number(bill.paidAmount || 0)), 0)
    const pending = data.purchaseBills.reduce((sum, bill) => sum + clampNonNegative(Number(bill.balanceAmount || 0)), 0)
    return { total, paid, pending, count: data.purchaseBills.length }
  }, [data.purchaseBills])

  const salesStats = useMemo(() => {
    const total = data.salesBills.reduce((sum, bill) => sum + clampNonNegative(Number(bill.totalAmount || 0)), 0)
    const received = data.salesBills.reduce((sum, bill) => sum + clampNonNegative(Number(bill.receivedAmount || 0)), 0)
    const pending = data.salesBills.reduce((sum, bill) => sum + clampNonNegative(Number(bill.balanceAmount || 0)), 0)
    return { total, received, pending, count: data.salesBills.length }
  }, [data.salesBills])

  const cashflow = useMemo(() => {
    const inAmount = data.payments
      .filter((item) => item.billType === 'sales')
      .reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const outAmount = data.payments
      .filter((item) => item.billType === 'purchase')
      .reduce((sum, item) => sum + Number(item.amount || 0), 0)
    return {
      inAmount: clampNonNegative(inAmount),
      outAmount: clampNonNegative(outAmount),
      net: clampNonNegative(inAmount - outAmount)
    }
  }, [data.payments])

  const health = useMemo(() => {
    const salesCollectionRate = salesStats.total > 0 ? (salesStats.received / salesStats.total) * 100 : 0
    const purchaseClearanceRate = purchaseStats.total > 0 ? (purchaseStats.paid / purchaseStats.total) * 100 : 0
    return {
      salesCollectionRate,
      purchaseClearanceRate
    }
  }, [purchaseStats, salesStats])

  const recentActivity = useMemo(() => {
    const companyNameMap = new Map(companies.map((item) => [item.id, item.name]))
    const purchase = data.purchaseBills.map((bill) => ({
      id: `p-${bill.id}`,
      type: 'Purchase',
      no: bill.billNo,
      name: bill.farmer?.name || 'Farmer',
      companyName: companyNameMap.get(bill.companyId || '') || 'Unknown Company',
      amount: clampNonNegative(Number(bill.totalAmount || 0)),
      date: new Date(bill.billDate)
    }))

    const sales = data.salesBills.map((bill) => ({
      id: `s-${bill.id}`,
      type: 'Sales',
      no: bill.billNo,
      name: bill.party?.name || 'Party',
      companyName: companyNameMap.get(bill.companyId || '') || 'Unknown Company',
      amount: clampNonNegative(Number(bill.totalAmount || 0)),
      date: new Date(bill.billDate)
    }))

    return [...purchase, ...sales]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 8)
  }, [companies, data.purchaseBills, data.salesBills])

  const topKpis = useMemo(() => {
    return [
      {
        label: 'Business Volume',
        value: `₹${(purchaseStats.total + salesStats.total).toFixed(2)}`,
        hint: 'Purchase + sales',
        icon: Building2,
        className: 'border-slate-200 bg-white'
      },
      {
        label: 'Net Cash Flow',
        value: `₹${cashflow.net.toFixed(2)}`,
        hint: cashflow.net > 0 ? 'Positive movement' : 'Balanced movement',
        icon: Wallet,
        className: 'border-slate-200 bg-white'
      },
      {
        label: 'Master Records',
        value: `${data.products.length + data.parties.length + data.units.length}`,
        hint: `${data.products.length} products, ${data.parties.length} parties`,
        icon: Boxes,
        className: 'border-slate-200 bg-white'
      },
      {
        label: 'Stock Entries',
        value: `${data.stockLedger.length}`,
        hint: 'Ledger records',
        icon: Scale,
        className: 'border-slate-200 bg-white'
      }
    ]
  }, [cashflow.net, data.parties.length, data.products.length, data.stockLedger.length, data.units.length, purchaseStats.total, salesStats.total])

  const companyPerformance = useMemo(() => {
    const map = new Map<string, {
      id: string
      name: string
      purchaseTotal: number
      salesTotal: number
      paymentIn: number
      paymentOut: number
      purchaseBills: number
      salesBills: number
    }>()

    companies.forEach((company) => {
      if (!selectedCompanyIds.includes(company.id)) return
      map.set(company.id, {
        id: company.id,
        name: company.name,
        purchaseTotal: 0,
        salesTotal: 0,
        paymentIn: 0,
        paymentOut: 0,
        purchaseBills: 0,
        salesBills: 0
      })
    })

    data.purchaseBills.forEach((bill) => {
      const id = bill.companyId || ''
      const row = map.get(id)
      if (!row) return
      row.purchaseTotal += Number(bill.totalAmount || 0)
      row.purchaseBills += 1
    })

    data.salesBills.forEach((bill) => {
      const id = bill.companyId || ''
      const row = map.get(id)
      if (!row) return
      row.salesTotal += Number(bill.totalAmount || 0)
      row.salesBills += 1
    })

    data.payments.forEach((payment) => {
      const id = payment.companyId || ''
      const row = map.get(id)
      if (!row) return
      if (payment.billType === 'sales') row.paymentIn += clampNonNegative(Number(payment.amount || 0))
      if (payment.billType === 'purchase') row.paymentOut += clampNonNegative(Number(payment.amount || 0))
    })

    return Array.from(map.values())
      .map((row) => ({
        ...row,
        purchaseTotal: clampNonNegative(row.purchaseTotal),
        salesTotal: clampNonNegative(row.salesTotal),
        paymentIn: clampNonNegative(row.paymentIn),
        paymentOut: clampNonNegative(row.paymentOut),
        cashflow: clampNonNegative(row.paymentIn - row.paymentOut)
      }))
      .sort((a, b) => b.salesTotal - a.salesTotal)
  }, [companies, data.payments, data.purchaseBills, data.salesBills, selectedCompanyIds])
  const topCompany = companyPerformance[0]
  const topGrowthCompany = [...companyPerformance].sort((a, b) => b.cashflow - a.cashflow)[0]

  const trendData = useMemo(() => {
    const days: string[] = []
    const purchaseByDay = new Map<string, number>()
    const salesByDay = new Map<string, number>()
    const paymentByDay = new Map<string, number>()
    const now = new Date()

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(now.getDate() - i)
      const key = date.toISOString().slice(0, 10)
      days.push(key)
      purchaseByDay.set(key, 0)
      salesByDay.set(key, 0)
      paymentByDay.set(key, 0)
    }

    data.purchaseBills.forEach((bill) => {
      const key = new Date(bill.billDate).toISOString().slice(0, 10)
      if (purchaseByDay.has(key)) {
        purchaseByDay.set(key, (purchaseByDay.get(key) || 0) + Number(bill.totalAmount || 0))
      }
    })

    data.salesBills.forEach((bill) => {
      const key = new Date(bill.billDate).toISOString().slice(0, 10)
      if (salesByDay.has(key)) {
        salesByDay.set(key, (salesByDay.get(key) || 0) + Number(bill.totalAmount || 0))
      }
    })

    data.payments.forEach((payment) => {
      const key = new Date(payment.payDate || payment.billDate || new Date()).toISOString().slice(0, 10)
      if (paymentByDay.has(key)) {
        paymentByDay.set(key, (paymentByDay.get(key) || 0) + Number(payment.amount || 0))
      }
    })

    const rows = days.map((day) => ({
      day,
      purchase: purchaseByDay.get(day) || 0,
      sales: salesByDay.get(day) || 0,
      payment: paymentByDay.get(day) || 0
    }))

    return rows
  }, [data.payments, data.purchaseBills, data.salesBills])

  const chartMax = useMemo(() => {
    return Math.max(
      1,
      ...trendData.map((item) => Math.max(item.purchase, item.sales, item.payment))
    )
  }, [trendData])

  const stockNotifications = useMemo(() => {
    const productBalances: Record<string, { name: string; balance: number }> = {}
    data.stockLedger.forEach((entry) => {
      const key = entry.product?.id || 'unknown'
      const name = entry.product?.name || 'Unknown Product'
      if (!productBalances[key]) {
        productBalances[key] = { name, balance: 0 }
      }
      productBalances[key].balance += Number(entry.qtyIn || 0) - Number(entry.qtyOut || 0)
    })
    return Object.values(productBalances).filter((item) => item.balance <= 0)
  }, [data.stockLedger])

  const notifications = useMemo(() => {
    const pendingBills = data.purchaseBills.filter((b) => Number(b.balanceAmount || 0) > 0).length +
      data.salesBills.filter((b) => Number(b.balanceAmount || 0) > 0).length
    return {
      lowStock: stockNotifications.length,
      pendingBills,
      failedEntries: fetchFailures.length,
      lowStockItems: stockNotifications.slice(0, 5)
    }
  }, [data.purchaseBills, data.salesBills, fetchFailures.length, stockNotifications])

  const downloadTextFile = (name: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const csvEscape = (value: string | number) => {
    const str = String(value ?? '')
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const handleExportBackup = () => {
    const date = new Date()
    const stamp = date.toISOString().slice(0, 10)
    const summaryRows = [
      ['Metric', 'Value'],
      ['Selected Companies', selectedCompanyNames.join(' | ') || 'None'],
      ['Primary Company', companies.find((item) => item.id === primaryCompanyId)?.name || primaryCompanyId || 'None'],
      ['Total Purchase', purchaseStats.total.toFixed(2)],
      ['Total Sales', salesStats.total.toFixed(2)],
      ['Net Cashflow', clampNonNegative(cashflow.net).toFixed(2)],
      ['Products', data.products.length],
      ['Parties', data.parties.length],
      ['Units', data.units.length],
      ['Low Stock Alerts', notifications.lowStock],
      ['Pending Bills', notifications.pendingBills],
      ['Failed Data Sources', notifications.failedEntries]
    ]
    const trendRows = [
      ['Date', 'Purchase', 'Sales', 'Payments'],
      ...trendData.map((row) => [row.day, row.purchase.toFixed(2), row.sales.toFixed(2), row.payment.toFixed(2)])
    ]
    const csvText = [...summaryRows, [], ...trendRows]
      .map((line) => line.map(csvEscape).join(','))
      .join('\n')

    downloadTextFile(`daily-backup-${stamp}.csv`, csvText, 'text/csv;charset=utf-8;')

    const jsonPayload = {
      exportedAt: date.toISOString(),
      selectedCompanyIds,
      primaryCompanyId,
      summary: {
        purchase: purchaseStats,
        sales: salesStats,
        cashflow,
        notifications
      },
      trends: trendData,
      data
    }
    downloadTextFile(`daily-backup-${stamp}.json`, JSON.stringify(jsonPayload, null, 2), 'application/json;charset=utf-8;')
    setUiMessage('Daily backup exported (CSV + JSON).')
  }

  const getTabIcon = (tab: ActiveTab) => {
    switch (tab) {
      case 'purchase': return <ShoppingCart className="w-4 h-4" />
      case 'sales': return <Receipt className="w-4 h-4" />
      case 'stock': return <Package className="w-4 h-4" />
      case 'payment': return <CreditCard className="w-4 h-4" />
      case 'report': return <FileText className="w-4 h-4" />
    }
  }

  const getTabLabel = (tab: ActiveTab) => {
    switch (tab) {
      case 'purchase': return 'Purchase'
      case 'sales': return 'Sales'
      case 'stock': return 'Stock Management'
      case 'payment': return 'Payment'
      case 'report': return 'Reports'
    }
  }

  if (loading) {
    return (
      <DashboardLayout companyId={primaryCompanyId}>
        <div className="flex justify-center items-center h-64">
          <div className="text-lg">Loading...</div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout companyId={primaryCompanyId}>
      <div className="p-6 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="h-1 rounded-t-2xl bg-gradient-to-r from-slate-700 via-slate-500 to-slate-700" />
            <div className="p-6 md:p-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm text-slate-500">Dashboard</p>
                  <h1 className="text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">Business Overview</h1>
                  <p className="mt-2 text-sm text-slate-600">
                    Track purchase, sales, stock and payments across selected companies.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{selectedCompanyIds.length} companies selected</Badge>
                  <Badge variant="outline">Primary: {companies.find((item) => item.id === primaryCompanyId)?.name || 'None'}</Badge>
                  <Button onClick={() => handleNavigation('/purchase/entry')}>
                    <Plus className="mr-2 h-4 w-4" />
                    Quick Bill
                  </Button>
                  <Button variant="outline" onClick={handleExportBackup}>
                    <Download className="mr-2 h-4 w-4" />
                    Daily Backup
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <Card>
            <CardContent className="pt-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Company Scope</p>
                  <p className="text-xs text-slate-500">
                    Company access is controlled by Super Admin. This dashboard shows assigned company data only.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedCompanyNames.slice(0, 3).map((name) => (
                    <Badge key={name} variant="outline">{name}</Badge>
                  ))}
                  {selectedCompanyNames.length > 3 && (
                    <Badge variant="outline">+{selectedCompanyNames.length - 3} more</Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {uiMessage && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{uiMessage}</div>
          )}
          {uiError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{uiError}</div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {topKpis.map((kpi) => (
              <Card key={kpi.label} className={`shadow-sm ${kpi.className}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-slate-600">{kpi.label}</p>
                      <p className="mt-1 text-2xl font-bold text-slate-900">{kpi.value}</p>
                      <p className="text-xs text-slate-500">{kpi.hint}</p>
                    </div>
                    <kpi.icon className="h-8 w-8 text-slate-400" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Mandi Pulse</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-lg border bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Top Trading Company</p>
                  <p className="text-sm font-semibold text-slate-900">{topCompany?.name || 'N/A'}</p>
                  <p className="text-xs text-slate-600">Sales ₹{clampNonNegative(topCompany?.salesTotal || 0).toFixed(2)}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Best Cash Position</p>
                  <p className="text-sm font-semibold text-slate-900">{topGrowthCompany?.name || 'N/A'}</p>
                  <p className="text-xs text-emerald-700">Cashflow ₹{clampNonNegative(topGrowthCompany?.cashflow || 0).toFixed(2)}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Risk Snapshot</p>
                  <p className="text-sm font-semibold text-slate-900">{notifications.pendingBills} pending bills</p>
                  <p className="text-xs text-rose-700">{notifications.lowStock} low stock alerts</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Top Companies</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {companyPerformance.slice(0, 4).map((row) => (
                  <div key={row.id} className="rounded-md border p-2">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <p className="text-xs text-slate-500">Sales ₹{clampNonNegative(row.salesTotal).toFixed(0)} | Bills {row.purchaseBills + row.salesBills}</p>
                  </div>
                ))}
                {companyPerformance.length === 0 && <p className="text-sm text-slate-500">No company data yet</p>}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">7-Day Trends</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-7 gap-2">
                  {trendData.map((row) => {
                    const purchaseHeight = Math.max(4, (row.purchase / chartMax) * 110)
                    const salesHeight = Math.max(4, (row.sales / chartMax) * 110)
                    const paymentHeight = Math.max(4, (row.payment / chartMax) * 110)
                    return (
                      <div key={row.day} className="flex flex-col items-center gap-2">
                        <div className="flex h-28 items-end gap-1">
                          <div className="w-2 rounded-sm bg-orange-400" style={{ height: `${purchaseHeight}px` }} />
                          <div className="w-2 rounded-sm bg-emerald-500" style={{ height: `${salesHeight}px` }} />
                          <div className="w-2 rounded-sm bg-sky-500" style={{ height: `${paymentHeight}px` }} />
                        </div>
                        <p className="text-[10px] text-gray-500">{new Date(row.day).toLocaleDateString(undefined, { weekday: 'short' })}</p>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-600">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-400" />Purchase</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />Sales</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" />Payments</span>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Fast Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Button onClick={() => handleNavigation('/purchase/entry')} className="justify-start"><ShoppingCart className="mr-2 h-4 w-4" />Purchase Entry</Button>
                  <Button onClick={() => handleNavigation('/sales/entry')} className="justify-start"><Receipt className="mr-2 h-4 w-4" />Sales Entry</Button>
                  <Button variant="outline" onClick={() => handleNavigation('/payment/dashboard')} className="justify-start"><CreditCard className="mr-2 h-4 w-4" />Payments</Button>
                  <Button variant="outline" onClick={() => handleNavigation('/stock/dashboard')} className="justify-start"><Package className="mr-2 h-4 w-4" />Stock</Button>
                  <Button variant="outline" onClick={() => handleNavigation('/master/product')} className="justify-start"><Boxes className="mr-2 h-4 w-4" />Products</Button>
                  <Button variant="outline" onClick={() => handleNavigation('/master/party')} className="justify-start"><Landmark className="mr-2 h-4 w-4" />Parties</Button>
                  <Button variant="outline" onClick={() => handleNavigation('/master/unit')} className="justify-start"><Ruler className="mr-2 h-4 w-4" />Units</Button>
                  <Button variant="outline" onClick={() => handleNavigation('/reports/main')} className="justify-start"><FileText className="mr-2 h-4 w-4" />Reports</Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Business Health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span>Sales Collection</span>
                    <span className="font-semibold">{health.salesCollectionRate.toFixed(1)}%</span>
                  </div>
                  <Progress value={health.salesCollectionRate} />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span>Purchase Clearance</span>
                    <span className="font-semibold">{health.purchaseClearanceRate.toFixed(1)}%</span>
                  </div>
                  <Progress value={health.purchaseClearanceRate} />
                </div>
                <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between">
                    <span>Cash In</span>
                    <span className="font-semibold text-emerald-600">₹{cashflow.inAmount.toFixed(2)}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span>Cash Out</span>
                    <span className="font-semibold text-rose-600">₹{cashflow.outAmount.toFixed(2)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Bell className="h-5 w-5 text-amber-600" />
                  Notification Center
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-md border p-2">
                  <span>Low Stock Alerts</span>
                  <Badge variant={notifications.lowStock > 0 ? 'destructive' : 'default'}>
                    {notifications.lowStock}
                  </Badge>
                </div>
                <div className="flex items-center justify-between rounded-md border p-2">
                  <span>Pending Bills</span>
                  <Badge variant={notifications.pendingBills > 0 ? 'destructive' : 'default'}>
                    {notifications.pendingBills}
                  </Badge>
                </div>
                <div className="flex items-center justify-between rounded-md border p-2">
                  <span>Failed Data Sources</span>
                  <Badge variant={notifications.failedEntries > 0 ? 'destructive' : 'default'}>
                    {notifications.failedEntries}
                  </Badge>
                </div>
                {notifications.lowStockItems.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                    {notifications.lowStockItems.map((item) => item.name).join(', ')}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {recentActivity.length === 0 && (
                  <p className="text-sm text-gray-500">No recent bills available.</p>
                )}
                {recentActivity.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">
                        {entry.type} #{entry.no}
                      </p>
                      <p className="text-xs text-gray-500">{entry.name}</p>
                      <p className="text-xs text-slate-400">{entry.companyName}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">₹{entry.amount.toFixed(2)}</p>
                      <p className="text-xs text-gray-500">{entry.date.toLocaleDateString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex space-x-1 border-b">
            {(['purchase', 'sales', 'stock', 'payment', 'report'] as ActiveTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-2 px-4 py-2 font-medium text-sm ${
                  activeTab === tab
                    ? 'border-b-2 border-slate-900 text-slate-900 bg-slate-100'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {getTabIcon(tab)}
                {getTabLabel(tab)}
              </button>
            ))}
          </div>

          {/* Purchase Tab */}
          {activeTab === 'purchase' && (
            <div className="space-y-6">
              <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Ruler className="w-5 h-5 text-blue-700" />
                    Universal Unit Precision Engine
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="rounded-md bg-white p-3 border">
                      <p className="font-semibold">Universal Base</p>
                      <p>1 Quintal = 100.00 KG (system constant)</p>
                    </div>
                    <div className="rounded-md bg-white p-3 border">
                      <p className="font-semibold">User Unit Table</p>
                      <p>Define bag/packing units with KG conversion.</p>
                    </div>
                    <div className="rounded-md bg-white p-3 border">
                      <p className="font-semibold">Accurate Purchase Math</p>
                      <p>Entry unit converts to KG/QT before stock and payable calculations.</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button variant="outline" onClick={() => handleNavigation('/master/unit')}>
                      Open Unit Master
                    </Button>
                    <Button variant="outline" onClick={() => handleNavigation('/purchase/entry')}>
                      Open High-Speed Purchase Entry
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-sm text-gray-600">Total Purchase</p>
                    <p className="text-2xl font-bold text-blue-600">₹{purchaseStats.total.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-sm text-gray-600">Paid Amount</p>
                    <p className="text-2xl font-bold text-green-600">₹{purchaseStats.paid.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-sm text-gray-600">Pending Amount</p>
                    <p className="text-2xl font-bold text-red-600">₹{purchaseStats.pending.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-sm text-gray-600">Total Bills</p>
                    <p className="text-2xl font-bold text-purple-600">{purchaseStats.count}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="flex gap-2">
                <Button onClick={() => handleNavigation('/purchase/entry')}>
                  <Plus className="w-4 h-4 mr-2" />
                  New Purchase Bill
                </Button>
                <Button variant="outline" onClick={() => handleNavigation('/purchase/list')}>
                  <Eye className="w-4 h-4 mr-2" />
                  View All Bills
                </Button>
                <Button variant="outline" onClick={() => handleNavigation('/purchase/list')}>
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  Purchase Module
                </Button>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Recent Purchase Bills</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bill No</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.purchaseBills.slice(0, 8).map((bill) => (
                        <TableRow key={bill.id}>
                          <TableCell className="font-medium">{bill.billNo}</TableCell>
                          <TableCell>{new Date(bill.billDate).toLocaleDateString()}</TableCell>
                          <TableCell>{bill.farmer?.name || '-'}</TableCell>
                          <TableCell>₹{clampNonNegative(Number(bill.totalAmount || 0)).toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant={bill.balanceAmount > 0 ? 'destructive' : 'default'}>
                              {bill.balanceAmount > 0 ? 'Pending' : 'Paid'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {data.purchaseBills.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-gray-500">
                            No purchase bills found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Sales Tab */}
          {activeTab === 'sales' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-sm text-gray-600">Total Sales</p>
                    <p className="text-2xl font-bold text-blue-600">₹{salesStats.total.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-sm text-gray-600">Received Amount</p>
                    <p className="text-2xl font-bold text-green-600">₹{salesStats.received.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-sm text-gray-600">Pending Amount</p>
                    <p className="text-2xl font-bold text-red-600">₹{salesStats.pending.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-sm text-gray-600">Total Invoices</p>
                    <p className="text-2xl font-bold text-purple-600">{salesStats.count}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="flex gap-2">
                <Button onClick={() => handleNavigation('/sales/entry')}>
                  <Plus className="w-4 h-4 mr-2" />
                  New Sales Bill
                </Button>
                <Button variant="outline" onClick={() => handleNavigation('/sales/list')}>
                  <Eye className="w-4 h-4 mr-2" />
                  View All Bills
                </Button>
                <Button variant="outline" onClick={() => handleNavigation('/sales/list')}>
                  <Receipt className="w-4 h-4 mr-2" />
                  Sales Module
                </Button>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Recent Sales Bills</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice No</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Party</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.salesBills.slice(0, 8).map((bill) => (
                        <TableRow key={bill.id}>
                          <TableCell className="font-medium">{bill.billNo}</TableCell>
                          <TableCell>{new Date(bill.billDate).toLocaleDateString()}</TableCell>
                          <TableCell>{bill.party?.name || '-'}</TableCell>
                          <TableCell>₹{clampNonNegative(Number(bill.totalAmount || 0)).toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant={bill.balanceAmount > 0 ? 'destructive' : 'default'}>
                              {bill.balanceAmount > 0 ? 'Pending' : 'Received'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {data.salesBills.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-gray-500">
                            No sales bills found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Stock Tab */}
          {activeTab === 'stock' && (
            <StockManagementTab companyId={primaryCompanyId} />
          )}

          {/* Payment Tab */}
          {activeTab === 'payment' && (
            <PaymentTab companyId={primaryCompanyId} />
          )}

          {/* Reports Tab */}
          {activeTab === 'report' && (
            <ReportsTab companyId={primaryCompanyId} />
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
