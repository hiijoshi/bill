'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import DashboardLayout from '@/app/components/DashboardLayout'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
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
  Bell,
  Download,
  ShieldAlert,
  ShieldCheck,
  Trophy,
  ChevronRight,
  Activity,
  ArrowUpRight,
  Clock3
} from 'lucide-react'
import StockManagementTab from './components/StockManagementTab'
import PaymentTab from './components/PaymentTab'
import ReportsTab from './components/ReportsTab'
import { getClientCache, getOrLoadClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { APP_COMPANY_CHANGED_EVENT, notifyAppCompanyChanged, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { getReadablePermissionModules, resolveFirstAccessibleAppRoute } from '@/lib/app-default-route'
import { loadClientPermissions } from '@/lib/client-permissions'
import { matchesAppDataChange, subscribeAppDataChanged } from '@/lib/app-live-data'

type ActiveTab = 'purchase' | 'sales' | 'stock' | 'payment' | 'report'
const DASHBOARD_CACHE_AGE_MS = 15_000
const COMPANIES_CACHE_AGE_MS = 5 * 60_000
const AUTH_CACHE_AGE_MS = 5 * 60_000
const ACTIVE_COMPANY_CACHE_AGE_MS = 5 * 60_000
const COMPANIES_CACHE_KEY = 'shell:companies'
const AUTH_CACHE_KEY = 'shell:auth-me'
const ACTIVE_COMPANY_CACHE_KEY = 'shell:active-company-id'
const DASHBOARD_CACHE_PREFIX = 'main-dashboard:'
const currencyFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

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
  id: string
  companyId?: string
  billType: 'purchase' | 'sales'
  billId?: string
  amount: number
  payDate?: string
  billDate?: string
  mode?: 'cash' | 'online' | 'bank' | string
  txnRef?: string | null
  note?: string | null
  party?: {
    name?: string
  } | null
  farmer?: {
    name?: string
  } | null
}

type ProductRecord = {
  id: string
  companyId?: string
  name?: string
  unit?: {
    symbol?: string
  } | null
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

type CompanyOption = {
  id: string
  name: string
  locked?: boolean
}

function buildFallbackCompanyOption(companyId: string): CompanyOption {
  return {
    id: companyId,
    name: companyId
  }
}

function buildDashboardCacheKey(companyIds: string[]): string {
  return `${DASHBOARD_CACHE_PREFIX}${companyIds.slice().sort().join(',')}`
}

function areCompanyOptionsEqual(left: CompanyOption[], right: CompanyOption[]): boolean {
  if (left.length !== right.length) return false
  return left.every((item, index) => {
    const other = right[index]
    return item?.id === other?.id && item?.name === other?.name && Boolean(item?.locked) === Boolean(other?.locked)
  })
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

type AuthCompanyPayload = {
  company?: {
    id?: string | null
    name?: string | null
  } | null
  user?: {
    companyId?: string | null
    assignedCompanyId?: string | null
  } | null
}

type DashboardData = {
  purchaseBills: PurchaseBill[]
  salesBills: SalesBill[]
  payments: Payment[]
  products: ProductRecord[]
  parties: Array<{ id: string; companyId?: string }>
  units: Array<{ id: string; companyId?: string }>
  stockLedger: StockLedgerItem[]
}

type DashboardSummary = {
  purchase: {
    total: number
    paid: number
    pending: number
    count: number
  }
  sales: {
    total: number
    received: number
    pending: number
    count: number
  }
  cashflow: {
    inAmount: number
    outAmount: number
    net: number
    count: number
  }
  masterRecords: {
    products: number
    parties: number
    units: number
  }
  inventory: {
    stockEntries: number
    lowStock: number
    lowStockItems: Array<{ name: string; balance: number }>
  }
  notifications: {
    pendingBills: number
  }
}

type CompanyPerformanceRow = {
  id: string
  name: string
  purchaseTotal: number
  salesTotal: number
  paymentIn: number
  paymentOut: number
  purchaseBills: number
  salesBills: number
  cashflow: number
}

type TrendRow = {
  day: string
  purchase: number
  sales: number
  payment: number
}

type DashboardPayload = DashboardData & {
  summary: DashboardSummary
  companyPerformance: CompanyPerformanceRow[]
  trendData: TrendRow[]
}

const emptyDashboardPayload: DashboardPayload = {
  purchaseBills: [],
  salesBills: [],
  payments: [],
  products: [],
  parties: [],
  units: [],
  stockLedger: [],
  summary: {
    purchase: { total: 0, paid: 0, pending: 0, count: 0 },
    sales: { total: 0, received: 0, pending: 0, count: 0 },
    cashflow: { inAmount: 0, outAmount: 0, net: 0, count: 0 },
    masterRecords: { products: 0, parties: 0, units: 0 },
    inventory: { stockEntries: 0, lowStock: 0, lowStockItems: [] },
    notifications: { pendingBills: 0 }
  },
  companyPerformance: [],
  trendData: []
}

const clampNonNegative = (value: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

const formatCurrency = (value: number) => `₹${currencyFormatter.format(clampNonNegative(value))}`

export default function MainDashboardPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<ActiveTab>('purchase')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DashboardPayload>(emptyDashboardPayload)
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([])
  const [primaryCompanyId, setPrimaryCompanyId] = useState<string>('')
  const [dashboardAccessResolved, setDashboardAccessResolved] = useState(false)
  const [hasDashboardAccess, setHasDashboardAccess] = useState(false)
  const [uiMessage, setUiMessage] = useState<string | null>(null)
  const [uiError, setUiError] = useState<string | null>(null)
  const [fetchFailures, setFetchFailures] = useState<string[]>([])
  const [reloadNonce, setReloadNonce] = useState(0)
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

  const redirectToAccessibleRoute = useCallback(async (companyId?: string) => {
    const normalizedCompanyId = String(companyId || '').trim()
    if (!normalizedCompanyId) {
      router.replace('/main/profile')
      return
    }

    try {
      const payload = await loadClientPermissions(normalizedCompanyId)
      const permissions = payload.permissions
      const nextRoute = resolveFirstAccessibleAppRoute(permissions, normalizedCompanyId)
      router.replace(nextRoute.startsWith('/main/dashboard') ? '/main/profile' : nextRoute)
    } catch {
      router.replace('/main/profile')
    }
  }, [router])

  const checkDashboardAccess = useCallback(async (companyId?: string, force = false) => {
    const normalizedCompanyId = String(companyId || '').trim()
    if (!normalizedCompanyId) {
      setHasDashboardAccess(false)
      setDashboardAccessResolved(true)
      return false
    }

    try {
      const payload = await loadClientPermissions(normalizedCompanyId, { force })
      const permissions = payload.permissions
      const allowed = new Set(getReadablePermissionModules(permissions)).has('DASHBOARD')
      setHasDashboardAccess(allowed)
      setDashboardAccessResolved(true)
      return allowed
    } catch {
      setHasDashboardAccess(false)
      setDashboardAccessResolved(true)
      return false
    }
  }, [])

  useEffect(() => {
    stripCompanyParamsFromUrl()
  }, [])

  const primeDashboardFromCache = useCallback((companyIds: string[]): boolean => {
    if (companyIds.length === 0) return false

    const cached = getClientCache<DashboardPayload>(buildDashboardCacheKey(companyIds), DASHBOARD_CACHE_AGE_MS)
    if (!cached) return false

    setData(cached)
    setFetchFailures([])
    return true
  }, [])

  const getCachedCurrentCompanyOption = useCallback((companyList: CompanyOption[] = []): CompanyOption | null => {
    const cachedActiveCompanyId = getClientCache<string>(ACTIVE_COMPANY_CACHE_KEY, ACTIVE_COMPANY_CACHE_AGE_MS)
    const cachedAuthPayload = getClientCache<AuthCompanyPayload>(AUTH_CACHE_KEY, AUTH_CACHE_AGE_MS)
    const companyId = String(
      cachedActiveCompanyId ||
      cachedAuthPayload?.company?.id ||
      cachedAuthPayload?.user?.companyId ||
      cachedAuthPayload?.user?.assignedCompanyId ||
      ''
    ).trim()

    if (!companyId) return null

    const companyNameFromAuth =
      String(cachedAuthPayload?.company?.id || '').trim() === companyId
        ? String(cachedAuthPayload?.company?.name || '').trim()
        : ''

    return {
      id: companyId,
      name: companyNameFromAuth || companyList.find((item) => item.id === companyId)?.name || companyId
    }
  }, [])

  const applyCompanySelection = useCallback((input: {
    list: CompanyOption[]
    currentCompany: CompanyOption | null
    queryCompanyId: string
    queryCompanyIds: string[]
  }) => {
    const { list, currentCompany, queryCompanyId, queryCompanyIds } = input

    const activeCompanyId = currentCompany?.id || ''
    const mergedList = list.length > 0
      ? list
      : currentCompany
        ? [currentCompany]
        : []

    setCompanies((previous) => (areCompanyOptionsEqual(previous, mergedList) ? previous : mergedList))

    const availableIds = new Set(mergedList.map((item) => item.id))
    let nextSelected = queryCompanyIds.filter((id) => availableIds.has(id))

    if (nextSelected.length === 0 && queryCompanyId && availableIds.has(queryCompanyId)) {
      nextSelected = [queryCompanyId]
    }
    if (nextSelected.length === 0 && activeCompanyId && availableIds.has(activeCompanyId)) {
      nextSelected = [activeCompanyId]
    }
    if (nextSelected.length === 0 && queryCompanyId && mergedList.length === 0) {
      nextSelected = [queryCompanyId]
      const fallbackCompanies = [buildFallbackCompanyOption(queryCompanyId)]
      setCompanies((previous) => (areCompanyOptionsEqual(previous, fallbackCompanies) ? previous : fallbackCompanies))
    }
    if (nextSelected.length === 0) {
      const defaultCompanyId = mergedList.find((item) => !item.locked)?.id || mergedList[0]?.id || ''
      nextSelected = defaultCompanyId ? [defaultCompanyId] : []
    }

    const nextPrimary = availableIds.has(queryCompanyId) && nextSelected.includes(queryCompanyId)
      ? queryCompanyId
      : activeCompanyId && nextSelected.includes(activeCompanyId)
        ? activeCompanyId
        : (nextSelected[0] || '')

    setSelectedCompanyIds((previous) => (areStringArraysEqual(previous, nextSelected) ? previous : nextSelected))
    setPrimaryCompanyId((previous) => (previous === nextPrimary ? previous : nextPrimary))
    setUiError(null)
    setUiMessage(nextSelected.length === 0 ? 'No company is assigned to this account yet. Ask Super Admin to assign access.' : null)

    return {
      selectedCompanyIds: nextSelected,
      primaryCompanyId: nextPrimary
    }
  }, [])

  const loadCompanies = useCallback(async (force = false) => {
    try {
      return await getOrLoadClientCache<CompanyOption[]>(
        COMPANIES_CACHE_KEY,
        COMPANIES_CACHE_AGE_MS,
        async () => {
          const res = await fetch('/api/companies', { cache: 'no-store' })
          if (!res.ok) {
            if (res.status === 401) {
              router.push('/login')
            }
            const raw = await res.text().catch(() => '')
            if (res.status >= 500) {
              console.error('Failed to load companies API', {
                status: res.status,
                preview: raw.slice(0, 120)
              })
            }
            throw new Error('Failed to load companies')
          }
          const contentType = res.headers.get('content-type') || ''
          if (!contentType.includes('application/json')) {
            return []
          }
          const rows = await parseApiJson<Array<Record<string, unknown>>>(res, [])
          return Array.isArray(rows)
            ? rows.map((row) => ({
                id: String(row.id),
                name: String(row.name || row.id),
                locked: Boolean(row.locked)
              }))
            : []
        },
        {
          persist: true,
          force,
          shouldCache: (data) => Array.isArray(data)
        }
      )
    } catch {
      return getClientCache<CompanyOption[]>(COMPANIES_CACHE_KEY, COMPANIES_CACHE_AGE_MS) || []
    }
  }, [router])

  const loadCurrentCompanyOption = useCallback(async (force = false): Promise<CompanyOption | null> => {
    const cachedCompanies = force ? [] : getClientCache<CompanyOption[]>(COMPANIES_CACHE_KEY, COMPANIES_CACHE_AGE_MS) || []
    const cachedCurrentCompany = force ? null : getCachedCurrentCompanyOption(cachedCompanies)
    if (cachedCurrentCompany) {
      return cachedCurrentCompany
    }

    try {
      const companyId = await getOrLoadClientCache<string>(
        ACTIVE_COMPANY_CACHE_KEY,
        ACTIVE_COMPANY_CACHE_AGE_MS,
        async () => {
          try {
            const activeResponse = await fetch('/api/auth/company', { cache: 'no-store' })
            if (activeResponse.ok) {
              const activePayload = await parseApiJson<AuthCompanyPayload>(activeResponse, {})
              const activeCompanyId = String(activePayload.company?.id || '').trim()
              if (activeCompanyId) {
                return activeCompanyId
              }
            }
          } catch {
            // fall through to /api/auth/me
          }

          const authPayload = await getOrLoadClientCache<AuthCompanyPayload | null>(
            AUTH_CACHE_KEY,
            AUTH_CACHE_AGE_MS,
            async () => {
              const authResponse = await fetch('/api/auth/me', { cache: 'no-store' })
              if (authResponse.status === 401) {
                router.push('/login')
                return null
              }
              if (!authResponse.ok) {
                throw new Error('Failed to load auth session')
              }
              return await parseApiJson<AuthCompanyPayload>(authResponse, {})
            },
            {
              persist: true,
              force,
              shouldCache: (data) => Boolean(data && (data.user || data.company))
            }
          )

          const fallbackCompanyId = String(
            authPayload?.company?.id ||
            authPayload?.user?.companyId ||
            authPayload?.user?.assignedCompanyId ||
            ''
          ).trim()

          if (!fallbackCompanyId) {
            throw new Error('No active company')
          }

          return fallbackCompanyId
        },
        {
          persist: true,
          force,
          shouldCache: (value) => Boolean(String(value || '').trim())
        }
      )

      if (!companyId) {
        return null
      }

      const authPayload = getClientCache<AuthCompanyPayload>(AUTH_CACHE_KEY, AUTH_CACHE_AGE_MS)
      return {
        id: companyId,
        name:
          (String(authPayload?.company?.id || '').trim() === companyId
            ? String(authPayload?.company?.name || '').trim()
            : '') ||
          cachedCompanies.find((company) => company.id === companyId)?.name ||
          companyId
      }
    } catch {
      return null
    }
  }, [getCachedCurrentCompanyOption, router])

  useEffect(() => {
    const triggerReload = () => {
      setReloadNonce((current) => current + 1)
    }

    window.addEventListener('sessionRefreshed', triggerReload)
    window.addEventListener(APP_COMPANY_CHANGED_EVENT, triggerReload)

    return () => {
      window.removeEventListener('sessionRefreshed', triggerReload)
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, triggerReload)
    }
  }, [])

  useIsomorphicLayoutEffect(() => {
    if (!dashboardAccessResolved || !hasDashboardAccess) {
      return
    }

    const queryParams = new URLSearchParams(window.location.search)
    const queryCompanyId = queryParams.get('companyId') || ''
    const queryCompanyIds = (queryParams.get('companyIds') || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
    const cachedCompanies = getClientCache<CompanyOption[]>(COMPANIES_CACHE_KEY, COMPANIES_CACHE_AGE_MS) || []
    const cachedCurrentCompany = getCachedCurrentCompanyOption(cachedCompanies)

    if (cachedCompanies.length === 0 && !cachedCurrentCompany?.id) {
      return
    }

    const cachedSelection = applyCompanySelection({
      list: cachedCompanies,
      currentCompany: cachedCurrentCompany,
      queryCompanyId,
      queryCompanyIds
    })

    if (primeDashboardFromCache(cachedSelection.selectedCompanyIds)) {
      setLoading(false)
    }
  }, [applyCompanySelection, dashboardAccessResolved, getCachedCurrentCompanyOption, hasDashboardAccess, primeDashboardFromCache])

  const fetchDashboardData = useCallback(async (companyIds: string[], options: { force?: boolean } = {}) => {
    if (companyIds.length === 0) {
      setData(emptyDashboardPayload)
      setFetchFailures([])
      return
    }
    const params = new URLSearchParams()
    params.append('include', 'purchaseBills')
    params.append('include', 'salesBills')
    if (companyIds.length === 1) {
      params.set('companyId', companyIds[0])
    } else {
      params.set('companyIds', companyIds.join(','))
    }

    const cacheKey = buildDashboardCacheKey(companyIds)

    try {
      const nextData = await getOrLoadClientCache<DashboardPayload>(
        cacheKey,
        DASHBOARD_CACHE_AGE_MS,
        async () => {
          const response = await fetch(`/api/main-dashboard/overview?${params.toString()}`, { cache: 'no-store' })
          const payload = await parseApiJson<Partial<DashboardPayload> & { error?: string }>(response, {})
          if (!response.ok) {
            const error = new Error(payload.error || 'dashboard overview') as Error & { status?: number }
            error.status = response.status
            throw error
          }

          return {
            purchaseBills: Array.isArray(payload.purchaseBills) ? payload.purchaseBills : [],
            salesBills: Array.isArray(payload.salesBills) ? payload.salesBills : [],
            payments: Array.isArray(payload.payments) ? payload.payments : [],
            products: Array.isArray(payload.products) ? payload.products : [],
            parties: Array.isArray(payload.parties) ? payload.parties : [],
            units: Array.isArray(payload.units) ? payload.units : [],
            stockLedger: Array.isArray(payload.stockLedger) ? payload.stockLedger : [],
            summary: {
              purchase: {
                total: clampNonNegative(payload.summary?.purchase?.total ?? 0),
                paid: clampNonNegative(payload.summary?.purchase?.paid ?? 0),
                pending: clampNonNegative(payload.summary?.purchase?.pending ?? 0),
                count: clampNonNegative(payload.summary?.purchase?.count ?? 0)
              },
              sales: {
                total: clampNonNegative(payload.summary?.sales?.total ?? 0),
                received: clampNonNegative(payload.summary?.sales?.received ?? 0),
                pending: clampNonNegative(payload.summary?.sales?.pending ?? 0),
                count: clampNonNegative(payload.summary?.sales?.count ?? 0)
              },
              cashflow: {
                inAmount: clampNonNegative(payload.summary?.cashflow?.inAmount ?? 0),
                outAmount: clampNonNegative(payload.summary?.cashflow?.outAmount ?? 0),
                net: clampNonNegative(payload.summary?.cashflow?.net ?? 0),
                count: clampNonNegative(payload.summary?.cashflow?.count ?? 0)
              },
              masterRecords: {
                products: clampNonNegative(payload.summary?.masterRecords?.products ?? 0),
                parties: clampNonNegative(payload.summary?.masterRecords?.parties ?? 0),
                units: clampNonNegative(payload.summary?.masterRecords?.units ?? 0)
              },
              inventory: {
                stockEntries: clampNonNegative(payload.summary?.inventory?.stockEntries ?? 0),
                lowStock: clampNonNegative(payload.summary?.inventory?.lowStock ?? 0),
                lowStockItems: Array.isArray(payload.summary?.inventory?.lowStockItems)
                  ? payload.summary.inventory.lowStockItems.map((item) => ({
                      name: String(item?.name || 'Unknown Product'),
                      balance: Number(item?.balance || 0)
                    }))
                  : []
              },
              notifications: {
                pendingBills: clampNonNegative(payload.summary?.notifications?.pendingBills ?? 0)
              }
            },
            companyPerformance: Array.isArray(payload.companyPerformance)
              ? payload.companyPerformance.map((row) => ({
                  id: String(row.id || ''),
                  name: String(row.name || 'Unknown Company'),
                  purchaseTotal: clampNonNegative(row.purchaseTotal || 0),
                  salesTotal: clampNonNegative(row.salesTotal || 0),
                  paymentIn: clampNonNegative(row.paymentIn || 0),
                  paymentOut: clampNonNegative(row.paymentOut || 0),
                  purchaseBills: clampNonNegative(row.purchaseBills || 0),
                  salesBills: clampNonNegative(row.salesBills || 0),
                  cashflow: clampNonNegative(row.cashflow || 0)
                }))
              : [],
            trendData: Array.isArray(payload.trendData)
              ? payload.trendData.map((row) => ({
                  day: String(row.day || ''),
                  purchase: clampNonNegative(row.purchase || 0),
                  sales: clampNonNegative(row.sales || 0),
                  payment: clampNonNegative(row.payment || 0)
                }))
              : []
          }
        },
        {
          persist: true,
          force: options.force,
          shouldCache: (payload) => Boolean(payload)
        }
      )
      setData(nextData)
      setFetchFailures([])
    } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status || 0) : 0
      if (status === 403) {
        setHasDashboardAccess(false)
        setDashboardAccessResolved(true)
        setData(emptyDashboardPayload)
        setFetchFailures([])
        await redirectToAccessibleRoute(companyIds[0] || primaryCompanyId)
        return
      }
      const fallback = getClientCache<DashboardPayload>(cacheKey, DASHBOARD_CACHE_AGE_MS)
      if (fallback) {
        setData(fallback)
      } else {
        setData(emptyDashboardPayload)
      }
      setFetchFailures([error instanceof Error ? error.message : 'dashboard overview'])
    }
  }, [primaryCompanyId, redirectToAccessibleRoute])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const forceRefresh = reloadNonce > 0
      const queryParams = new URLSearchParams(window.location.search)
      const queryCompanyId = queryParams.get('companyId') || ''
      const queryCompanyIds = (queryParams.get('companyIds') || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
      const cachedCompanies = getClientCache<CompanyOption[]>(COMPANIES_CACHE_KEY, COMPANIES_CACHE_AGE_MS) || []
      const cachedCurrentCompany = getCachedCurrentCompanyOption(cachedCompanies)

      try {
        const [list, currentCompany] = await Promise.all([
          loadCompanies(forceRefresh),
          loadCurrentCompanyOption(forceRefresh)
        ])
        if (cancelled) return
        const selection = applyCompanySelection({
          list,
          currentCompany,
          queryCompanyId,
          queryCompanyIds
        })
        if (selection.selectedCompanyIds.length === 0) {
          setDashboardAccessResolved(true)
          setHasDashboardAccess(true)
          return
        }
        const allowed = await checkDashboardAccess(
          selection.primaryCompanyId || selection.selectedCompanyIds[0],
          forceRefresh
        )
        if (cancelled) return
        if (!allowed) {
          setData(emptyDashboardPayload)
          setFetchFailures([])
          setLoading(false)
          await redirectToAccessibleRoute(selection.primaryCompanyId || selection.selectedCompanyIds[0])
          return
        }
        if (selection.selectedCompanyIds.length > 0) {
          primeDashboardFromCache(selection.selectedCompanyIds)
        }
      } catch (error) {
        if (cancelled) return
        void error
        const fallbackCompany = cachedCurrentCompany || await loadCurrentCompanyOption(forceRefresh)
        if (fallbackCompany?.id) {
          const allowed = await checkDashboardAccess(fallbackCompany.id, forceRefresh)
          if (cancelled) return
          if (!allowed) {
            setData(emptyDashboardPayload)
            setFetchFailures([])
            setLoading(false)
            await redirectToAccessibleRoute(fallbackCompany.id)
            return
          }
          setCompanies([fallbackCompany])
          setSelectedCompanyIds([fallbackCompany.id])
          setPrimaryCompanyId(fallbackCompany.id)
          setUiError(null)
          setUiMessage(null)
          primeDashboardFromCache([fallbackCompany.id])
          return
        }
        if (queryCompanyId) {
          const allowed = await checkDashboardAccess(queryCompanyId, forceRefresh)
          if (cancelled) return
          if (!allowed) {
            setData(emptyDashboardPayload)
            setFetchFailures([])
            setLoading(false)
            await redirectToAccessibleRoute(queryCompanyId)
            return
          }
          setCompanies([buildFallbackCompanyOption(queryCompanyId)])
          setSelectedCompanyIds([queryCompanyId])
          setPrimaryCompanyId(queryCompanyId)
          setUiError(null)
          primeDashboardFromCache([queryCompanyId])
        } else {
          setDashboardAccessResolved(true)
          setHasDashboardAccess(true)
          setUiError('Failed to load company list')
          setUiMessage(null)
        }
      } finally {
        if (cancelled) return
        setLoading(false)
      }
    })().catch(() => {
      if (cancelled) return
      setLoading(false)
      setUiError('Failed to load company list')
    })
    return () => {
      cancelled = true
    }
  }, [applyCompanySelection, checkDashboardAccess, getCachedCurrentCompanyOption, loadCompanies, loadCurrentCompanyOption, primeDashboardFromCache, redirectToAccessibleRoute, reloadNonce])

  useEffect(() => {
    if (!dashboardAccessResolved || !hasDashboardAccess) return undefined
    if (selectedCompanyIds.length === 0) return undefined

    const unsubscribe = subscribeAppDataChanged((detail) => {
      const shouldRefresh = selectedCompanyIds.some((companyId) =>
        matchesAppDataChange(detail, companyId, ['purchase-bills', 'sales-bills', 'payments', 'products', 'all'])
      )

      if (!shouldRefresh) return
      void fetchDashboardData(selectedCompanyIds, { force: true })
    })

    return unsubscribe
  }, [dashboardAccessResolved, fetchDashboardData, hasDashboardAccess, selectedCompanyIds])

  useEffect(() => {
    if (!dashboardAccessResolved || !hasDashboardAccess) return
    if (selectedCompanyIds.length === 0 && !primaryCompanyId) return
    stripCompanyParamsFromUrl()
  }, [dashboardAccessResolved, hasDashboardAccess, primaryCompanyId, selectedCompanyIds])

  useEffect(() => {
    if (!dashboardAccessResolved || !hasDashboardAccess) return
    if (selectedCompanyIds.length === 0) return

    const primary = selectedCompanyIds.includes(primaryCompanyId) ? primaryCompanyId : selectedCompanyIds[0]
    if (primary !== primaryCompanyId) {
      setPrimaryCompanyId(primary)
      return
    }

    const cacheKey = buildDashboardCacheKey(selectedCompanyIds)
    const cached = getClientCache<DashboardPayload>(cacheKey, DASHBOARD_CACHE_AGE_MS)
    if (cached) {
      setData(cached)
      setLoading(false)
    }

    let cancelled = false
    ;(async () => {
      if (!cached) {
        setLoading(true)
      }
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
  }, [dashboardAccessResolved, fetchDashboardData, hasDashboardAccess, primaryCompanyId, selectedCompanyIds])

  useEffect(() => {
    if (!dashboardAccessResolved || !hasDashboardAccess) return
    if (!primaryCompanyId) return
    const activeCompanyId = getClientCache<string>(ACTIVE_COMPANY_CACHE_KEY, ACTIVE_COMPANY_CACHE_AGE_MS)
    if (activeCompanyId === primaryCompanyId) {
      return
    }
    void fetch('/api/auth/company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: primaryCompanyId, force: true })
    }).then((response) => {
      if (response.ok) {
        setClientCache(ACTIVE_COMPANY_CACHE_KEY, primaryCompanyId, { persist: true })
        notifyAppCompanyChanged(primaryCompanyId)
      }
    }).catch(() => undefined)
  }, [dashboardAccessResolved, hasDashboardAccess, primaryCompanyId])

  const handleNavigation = async (path: string) => {
    if (!primaryCompanyId) return
    const primaryCompany = companies.find((item) => item.id === primaryCompanyId)
    if (primaryCompany?.locked) {
      setUiError(`"${primaryCompany.name}" is locked by Super Admin. Switch active company to continue.`)
      return
    }

    try {
      const response = await fetch('/api/auth/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: primaryCompanyId, force: true })
      })
      if (response.ok) {
        setClientCache(ACTIVE_COMPANY_CACHE_KEY, primaryCompanyId, { persist: true })
        notifyAppCompanyChanged(primaryCompanyId)
      }
    } catch (error) {
      void error
    }

    router.push(path)
  }

  const purchaseStats = data.summary.purchase
  const salesStats = data.summary.sales
  const cashflow = data.summary.cashflow
  const masterRecords = data.summary.masterRecords
  const inventorySummary = data.summary.inventory

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

  const companyPerformance = data.companyPerformance
  const topCompany = companyPerformance[0]
  const topGrowthCompany = [...companyPerformance].sort((a, b) => b.cashflow - a.cashflow)[0]
  const trendData = data.trendData

  const chartMax = useMemo(() => {
    return Math.max(
      1,
      ...trendData.map((item) => Math.max(item.purchase, item.sales, item.payment))
    )
  }, [trendData])

  const notifications = useMemo(() => {
    return {
      lowStock: inventorySummary.lowStock,
      pendingBills: data.summary.notifications.pendingBills,
      failedEntries: fetchFailures.length,
      lowStockItems: inventorySummary.lowStockItems
    }
  }, [data.summary.notifications.pendingBills, fetchFailures.length, inventorySummary.lowStock, inventorySummary.lowStockItems])
  const notificationCount = notifications.lowStock + notifications.pendingBills + notifications.failedEntries

  const topKpis = useMemo(() => {
    return [
      {
        label: 'Business Volume',
        value: formatCurrency(purchaseStats.total + salesStats.total),
        hint: 'Purchase + Sales',
        trend: `${purchaseStats.count + salesStats.count} bills tracked`,
        icon: Building2,
        className: 'border-slate-200 bg-white',
        iconTone: 'bg-slate-900 text-white',
        trendTone: 'text-slate-500'
      },
      {
        label: 'Net Cash Flow',
        value: formatCurrency(cashflow.net),
        hint: 'Cash In vs Cash Out',
        trend: cashflow.inAmount >= cashflow.outAmount ? 'Inflow ahead' : 'Watch payouts',
        icon: Wallet,
        className: 'border-slate-200 bg-white',
        iconTone: 'bg-slate-100 text-slate-700',
        trendTone: 'text-slate-500'
      },
      {
        label: 'Master Records',
        value: `${masterRecords.products + masterRecords.parties + masterRecords.units}`,
        hint: `${masterRecords.products} products, ${masterRecords.parties} parties`,
        trend: `${masterRecords.units} units configured`,
        icon: Boxes,
        className: 'border-slate-200 bg-white',
        iconTone: 'bg-slate-100 text-slate-700',
        trendTone: 'text-slate-500'
      },
      {
        label: 'Stock Entries',
        value: `${inventorySummary.stockEntries}`,
        hint: 'Ledger records',
        trend: notifications.lowStock > 0 ? `${notifications.lowStock} low stock alerts` : 'Stock position stable',
        icon: Scale,
        className: 'border-slate-200 bg-white',
        iconTone: notifications.lowStock > 0 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700',
        trendTone: 'text-slate-500'
      }
    ]
  }, [cashflow.inAmount, cashflow.net, cashflow.outAmount, inventorySummary.stockEntries, masterRecords.parties, masterRecords.products, masterRecords.units, notifications.lowStock, purchaseStats.count, purchaseStats.total, salesStats.count, salesStats.total])

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
      ['Products', masterRecords.products],
      ['Parties', masterRecords.parties],
      ['Units', masterRecords.units],
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

  const getTabDescription = (tab: ActiveTab) => {
    switch (tab) {
      case 'purchase': return 'Supplier intake, bills and payable control'
      case 'sales': return 'Dispatch, invoicing and receivable follow-up'
      case 'stock': return 'Ledger movements, balances and shortage control'
      case 'payment': return 'Cash, bank and bill settlement visibility'
      case 'report': return 'Exports, summaries and decision-ready reporting'
    }
  }

  if (loading || !dashboardAccessResolved) {
    return <AppLoaderShell kind="dashboard" companyId={primaryCompanyId} />
  }

  if (!hasDashboardAccess) {
    return (
      <AppLoaderShell
        kind="access"
        companyId={primaryCompanyId}
        title="Checking dashboard access"
        message="Verifying privileges and company scope before showing sensitive dashboard insights."
      />
    )
  }

  const headerActions = (
    <>
      <Button
        onClick={() => handleNavigation('/purchase/entry')}
        className="h-10 rounded-2xl bg-slate-950 px-5 text-sm text-white transition-colors hover:bg-slate-800"
      >
        <Plus className="mr-2 h-4 w-4" />
        Quick Bill
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => document.getElementById('notification-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        className="relative h-10 w-10 rounded-2xl border-slate-200 bg-white transition-colors hover:bg-slate-50"
      >
        <Bell className="h-4 w-4" />
        {notificationCount > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {Math.min(notificationCount, 99)}
          </span>
        ) : null}
      </Button>
    </>
  )

  const primaryCompanyName = companies.find((item) => item.id === primaryCompanyId)?.name || 'None'
  const executiveIndicators = [
    {
      label: 'Companies',
      value: `${selectedCompanyIds.length}`,
      hint: selectedCompanyIds.length === 1 ? 'currently in scope' : 'currently in scope',
      icon: Building2,
      tone: 'border-slate-200 bg-slate-50',
      iconTone: 'bg-slate-900 text-white'
    },
    {
      label: 'Collections',
      value: formatCurrency(cashflow.inAmount),
      hint: 'sales payments recorded',
      icon: Wallet,
      tone: 'border-slate-200 bg-slate-50',
      iconTone: 'bg-slate-100 text-slate-700'
    },
    {
      label: 'Attention',
      value: `${notifications.pendingBills + notifications.lowStock}`,
      hint: 'open bills and stock alerts',
      icon: ShieldAlert,
      tone: 'border-slate-200 bg-slate-50',
      iconTone: 'bg-slate-100 text-slate-700'
    }
  ] as const
  const quickActions = [
    {
      label: 'Purchase Entry',
      hint: 'Capture supplier purchases fast',
      icon: ShoppingCart,
      path: '/purchase/entry',
      tone: 'border-slate-200 bg-white text-slate-950',
      iconTone: 'bg-slate-900 text-white'
    },
    {
      label: 'Sales Entry',
      hint: 'Create dispatch bills in one flow',
      icon: Receipt,
      path: '/sales/entry',
      tone: 'border-slate-200 bg-white text-slate-950',
      iconTone: 'bg-slate-100 text-slate-700'
    },
    {
      label: 'Payments',
      hint: 'Track settlements and pending dues',
      icon: CreditCard,
      path: '/payment/dashboard',
      tone: 'border-slate-200 bg-white text-slate-950',
      iconTone: 'bg-slate-100 text-slate-700'
    },
    {
      label: 'Reports',
      hint: 'Open operational and export views',
      icon: FileText,
      path: '/reports/main',
      tone: 'border-slate-200 bg-white text-slate-950',
      iconTone: 'bg-slate-100 text-slate-700'
    }
  ] as const
  const healthHighlights = [
    {
      label: 'Sales Collection',
      value: `${health.salesCollectionRate.toFixed(1)}%`,
      progress: health.salesCollectionRate,
      accent: 'bg-emerald-500'
    },
    {
      label: 'Purchase Clearance',
      value: `${health.purchaseClearanceRate.toFixed(1)}%`,
      progress: health.purchaseClearanceRate,
      accent: 'bg-sky-500'
    }
  ] as const

  return (
    <DashboardLayout companyId={primaryCompanyId} headerActions={headerActions}>
      <div className="min-h-full bg-[#f5f5f7]">
        <div className="mx-auto max-w-7xl space-y-8 p-6 md:p-8">
          <section className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
            <div className="rounded-[2rem] border border-black/5 bg-white p-8 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.22)]">
              <p className="text-sm font-medium text-slate-500">Dashboard</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 md:text-[3.2rem]">
                Business Overview
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 md:text-lg">
                A clear view of purchase, sales, stock and payments across the companies you manage.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <Badge className="rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-slate-700 hover:bg-slate-50">
                  {selectedCompanyIds.length} {selectedCompanyIds.length === 1 ? 'company' : 'companies'}
                </Badge>
                <Badge className="rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-slate-700 hover:bg-slate-50">
                  Primary: {primaryCompanyName}
                </Badge>
                <Badge className="rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-slate-700 hover:bg-slate-50">
                  {fetchFailures.length === 0 ? 'All sources connected' : `${fetchFailures.length} source warnings`}
                </Badge>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {executiveIndicators.map((item) => (
                  <div key={item.label} className={`rounded-[1.35rem] border p-4 ${item.tone}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl ${item.iconTone}`}>
                        <item.icon className="h-4 w-4" />
                      </span>
                      <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">{item.label}</span>
                    </div>
                    <p className="mt-6 text-3xl font-semibold tracking-tight text-slate-950">{item.value}</p>
                    <p className="mt-2 text-sm text-slate-500">{item.hint}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button
                  onClick={handleExportBackup}
                  className="h-11 rounded-2xl bg-slate-950 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export Backup
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => document.getElementById('notification-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="h-11 rounded-2xl border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Bell className="mr-2 h-4 w-4" />
                  View Alerts
                </Button>
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-900 bg-[#101113] p-6 text-white shadow-[0_28px_80px_-44px_rgba(15,23,42,0.48)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Live Snapshot</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Today</h2>
                </div>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-medium text-slate-300">
                  Updated live
                </span>
              </div>

              <div className="mt-8 space-y-5">
                <div className="border-b border-white/10 pb-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Top company</p>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-lg font-medium text-white">{topCompany?.name || 'N/A'}</p>
                      <p className="mt-1 text-sm text-slate-400">{topCompany?.salesBills || 0} sales bills</p>
                    </div>
                    <p className="text-lg font-medium text-white">{formatCurrency(topCompany?.salesTotal || 0)}</p>
                  </div>
                </div>

                <div className="border-b border-white/10 pb-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Cash position</p>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-lg font-medium text-white">{topGrowthCompany?.name || 'N/A'}</p>
                      <p className="mt-1 text-sm text-slate-400">Best net cash flow</p>
                    </div>
                    <p className="text-lg font-medium text-white">{formatCurrency(topGrowthCompany?.cashflow || 0)}</p>
                  </div>
                </div>

                <div className="border-b border-white/10 pb-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Open issues</p>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-lg font-medium text-white">{notificationCount} items need attention</p>
                      <p className="mt-1 text-sm text-slate-400">Pending bills, stock alerts and source checks</p>
                    </div>
                    <p className="text-lg font-medium text-white">{notifications.pendingBills}/{notifications.lowStock}</p>
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                  <Activity className="h-4 w-4" />
                  Active companies
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedCompanyNames.slice(0, 5).map((name) => (
                    <span key={name} className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                      {name}
                    </span>
                  ))}
                  {selectedCompanyNames.length > 5 && (
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                      +{selectedCompanyNames.length - 5} more
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
              <CardContent className="p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Company Scope</p>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Assigned access</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                      This dashboard shows only the companies assigned by Super Admin. The current primary company is {primaryCompanyName}.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedCompanyNames.slice(0, 6).map((name) => (
                      <Badge
                        key={name}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700 hover:bg-slate-50"
                      >
                        {name}
                      </Badge>
                    ))}
                    {selectedCompanyNames.length > 6 && (
                      <Badge className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700 hover:bg-slate-50">
                        +{selectedCompanyNames.length - 6} more
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">System Status</p>
                    <h2 className="mt-3 text-xl font-semibold text-slate-950">
                      {fetchFailures.length === 0 ? 'All critical feeds are connected' : `${fetchFailures.length} data sources need review`}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {notificationCount === 0 ? 'No urgent operational issues right now.' : `${notificationCount} items still need attention.`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {uiMessage && (
            <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50/90 p-4 text-sm text-emerald-700 shadow-sm">
              {uiMessage}
            </div>
          )}
          {uiError && (
            <div className="rounded-[1.35rem] border border-rose-200 bg-rose-50/90 p-4 text-sm text-rose-700 shadow-sm">
              {uiError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
            {topKpis.map((kpi) => (
              <Card
                key={kpi.label}
                className={`group rounded-[1.5rem] border shadow-[0_20px_50px_-40px_rgba(15,23,42,0.2)] transition-colors duration-200 hover:border-slate-300 ${kpi.className}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <span className={`inline-flex h-12 w-12 items-center justify-center rounded-[1.1rem] ${kpi.iconTone}`}>
                      <kpi.icon className="h-5 w-5" />
                    </span>
                    <span className={`text-right text-xs font-medium ${kpi.trendTone}`}>
                      {kpi.trend}
                    </span>
                  </div>
                  <div className="mt-8">
                    <p className="text-sm font-medium text-slate-500">{kpi.label}</p>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <p className="text-3xl font-semibold tracking-tight text-slate-950">{kpi.value}</p>
                      <ArrowUpRight className="h-4 w-4 text-slate-300" />
                    </div>
                    <p className="mt-3 text-sm text-slate-500">{kpi.hint}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="overflow-hidden rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
              <CardHeader className="border-b border-slate-100 pb-5">
                <CardTitle className="text-2xl tracking-tight text-slate-950">Mandi Pulse</CardTitle>
                <p className="text-sm text-slate-500">Core commercial signals from the active mandi workspace.</p>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 p-6 md:grid-cols-3">
                <div className="rounded-[1.35rem] border border-slate-200 bg-white p-5">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                      <Trophy className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Top Trading Company</p>
                      <p className="mt-1 text-base font-semibold text-slate-950">{topCompany?.name || 'N/A'}</p>
                    </div>
                  </div>
                  <p className="mt-6 text-2xl font-semibold text-slate-950">{formatCurrency(topCompany?.salesTotal || 0)}</p>
                  <p className="mt-2 text-sm text-slate-500">Sales across {topCompany?.salesBills || 0} bills</p>
                </div>
                <div className="rounded-[1.35rem] border border-slate-200 bg-white p-5">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                      <Wallet className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Best Cash Position</p>
                      <p className="mt-1 text-base font-semibold text-slate-950">{topGrowthCompany?.name || 'N/A'}</p>
                    </div>
                  </div>
                  <p className="mt-6 text-2xl font-semibold text-slate-950">{formatCurrency(topGrowthCompany?.cashflow || 0)}</p>
                  <p className="mt-2 text-sm text-slate-500">Cashflow lead in active companies</p>
                </div>
                <div className="rounded-[1.35rem] border border-slate-200 bg-white p-5">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                      <ShieldAlert className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Risk Snapshot</p>
                      <p className="mt-1 text-base font-semibold text-slate-950">{notifications.pendingBills} pending bills</p>
                    </div>
                  </div>
                  <p className="mt-6 text-2xl font-semibold text-slate-950">{notifications.lowStock}</p>
                  <p className="mt-2 text-sm text-slate-500">Low stock alerts need review</p>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
              <CardHeader className="border-b border-slate-100 pb-5">
                <CardTitle className="text-2xl tracking-tight text-slate-950">Top Companies</CardTitle>
                <p className="text-sm text-slate-500">Leaderboard based on live sales volume and bill count.</p>
              </CardHeader>
              <CardContent className="space-y-3 p-6">
                {companyPerformance.slice(0, 5).map((row, index) => {
                  const relativeWidth = topCompany?.salesTotal ? Math.max(12, (row.salesTotal / topCompany.salesTotal) * 100) : 12
                  return (
                    <div
                      key={row.id}
                      className="rounded-[1.35rem] border border-slate-200 bg-white p-4"
                    >
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm font-semibold text-slate-950">{row.name}</p>
                            <p className="text-sm font-semibold text-slate-700">{formatCurrency(row.salesTotal)}</p>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">Bills {row.purchaseBills + row.salesBills} • Cashflow {formatCurrency(row.cashflow)}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-300" />
                      </div>
                      <div className="mt-3 h-1.5 rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,#0f172a_0%,#14b8a6_100%)]"
                          style={{ width: `${relativeWidth}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
                {companyPerformance.length === 0 && <p className="text-sm text-slate-500">No company data yet</p>}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="overflow-hidden rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
              <CardHeader className="border-b border-slate-100 pb-5">
                <CardTitle className="text-2xl tracking-tight text-slate-950">7-Day Trends</CardTitle>
                <p className="text-sm text-slate-500">Daily purchase, sales and payment movement across the active scope.</p>
              </CardHeader>
              <CardContent className="p-6">
                <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Weekly trend</p>
                      <p className="mt-2 text-lg font-semibold text-slate-950">Last 7 days of movement</p>
                    </div>
                    <Badge className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:bg-white">
                      Chart max {formatCurrency(chartMax)}
                    </Badge>
                  </div>
                  <div className="mt-6 grid grid-cols-7 gap-3">
                    {trendData.map((row) => {
                      const purchaseHeight = Math.max(8, (row.purchase / chartMax) * 126)
                      const salesHeight = Math.max(8, (row.sales / chartMax) * 126)
                      const paymentHeight = Math.max(8, (row.payment / chartMax) * 126)
                      return (
                        <div key={row.day} className="flex flex-col items-center gap-3">
                          <div className="flex h-36 w-full items-end justify-center gap-1.5 rounded-[1.25rem] bg-white px-2 py-3 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)]">
                            <div className="w-2.5 rounded-full bg-orange-400/95" style={{ height: `${purchaseHeight}px` }} />
                            <div className="w-2.5 rounded-full bg-emerald-400/95" style={{ height: `${salesHeight}px` }} />
                            <div className="w-2.5 rounded-full bg-sky-400/95" style={{ height: `${paymentHeight}px` }} />
                          </div>
                          <div className="text-center">
                            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                              {new Date(row.day).toLocaleDateString(undefined, { weekday: 'short' })}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-400">{new Date(row.day).getDate()}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-5 flex flex-wrap gap-4 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-orange-400" />Purchase</span>
                    <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />Sales</span>
                    <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-sky-400" />Payments</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-6">
              <Card className="overflow-hidden rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
                <CardHeader className="border-b border-slate-100 pb-5">
                  <CardTitle className="text-2xl tracking-tight text-slate-950">Quick Launch</CardTitle>
                  <p className="text-sm text-slate-500">Jump into the workflows the team uses most.</p>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2">
                  {quickActions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => handleNavigation(action.path)}
                      className={`group rounded-[1.35rem] border p-4 text-left transition-colors duration-200 hover:border-slate-300 hover:bg-slate-50 ${action.tone}`}
                    >
                      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${action.iconTone}`}>
                        <action.icon className="h-5 w-5" />
                      </span>
                      <div className="mt-6 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold">{action.label}</p>
                          <p className="mt-2 text-sm text-slate-600">{action.hint}</p>
                        </div>
                        <ArrowUpRight className="mt-0.5 h-4 w-4 text-slate-300" />
                      </div>
                    </button>
                  ))}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-1">
                <Card id="notification-center" className="overflow-hidden rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
                  <CardHeader className="border-b border-slate-100 pb-5">
                    <CardTitle className="text-2xl tracking-tight text-slate-950">Business Health</CardTitle>
                    <p className="text-sm text-slate-500">Collection and payout rhythm across the active scope.</p>
                  </CardHeader>
                  <CardContent className="space-y-5 p-6">
                    {healthHighlights.map((item) => (
                      <div key={item.label}>
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-700">{item.label}</span>
                          <span className="font-semibold text-slate-950">{item.value}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full transition-all ${item.accent}`}
                            style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 p-4 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Cash In</span>
                        <span className="font-semibold text-emerald-600">₹{cashflow.inAmount.toFixed(2)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-slate-500">Cash Out</span>
                        <span className="font-semibold text-rose-600">₹{cashflow.outAmount.toFixed(2)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="overflow-hidden rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
                  <CardHeader className="border-b border-slate-100 pb-5">
                    <CardTitle className="flex items-center gap-2 text-2xl tracking-tight text-slate-950">
                      <Bell className="h-5 w-5 text-amber-600" />
                      Notification Center
                    </CardTitle>
                    <p className="text-sm text-slate-500">Operational issues that need attention before they compound.</p>
                  </CardHeader>
                  <CardContent className="space-y-3 p-6 text-sm">
                    <div className="flex items-center justify-between rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3">
                      <span className="font-medium text-slate-700">Low Stock Alerts</span>
                      <Badge variant={notifications.lowStock > 0 ? 'destructive' : 'default'}>
                        {notifications.lowStock}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3">
                      <span className="font-medium text-slate-700">Pending Bills</span>
                      <Badge variant={notifications.pendingBills > 0 ? 'destructive' : 'default'}>
                        {notifications.pendingBills}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3">
                      <span className="font-medium text-slate-700">Failed Data Sources</span>
                      <Badge variant={notifications.failedEntries > 0 ? 'destructive' : 'default'}>
                        {notifications.failedEntries}
                      </Badge>
                    </div>
                    {notifications.lowStockItems.length > 0 && (
                      <div className="rounded-[1.15rem] border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                        Low stock on: {notifications.lowStockItems.map((item) => item.name).join(', ')}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          <Card className="overflow-hidden rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
            <CardHeader className="border-b border-slate-100 pb-5">
              <CardTitle className="text-2xl tracking-tight text-slate-950">Recent Activity</CardTitle>
              <p className="text-sm text-slate-500">Latest purchase and sales moves across your active companies.</p>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {recentActivity.length === 0 && (
                  <p className="text-sm text-slate-500">No recent bills available.</p>
                )}
                {recentActivity.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-[1.35rem] border border-slate-200 bg-white p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        <Clock3 className="h-3.5 w-3.5" />
                        {entry.type} activity
                      </div>
                      <Badge className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:bg-white">
                        {entry.companyName}
                      </Badge>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-4">
                      <div>
                        <p className="text-base font-semibold text-slate-950">
                          {entry.type} #{entry.no}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">{entry.name}</p>
                        <p className="mt-2 text-xs text-slate-400">{entry.date.toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold text-slate-950">₹{entry.amount.toFixed(2)}</p>
                        <p className="mt-1 text-xs text-slate-400">Latest entry</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <section className="space-y-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Operational Modules</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  Open a live workspace without leaving the dashboard
                </h2>
              </div>
              <p className="max-w-xl text-sm leading-6 text-slate-600">
                Move between purchase, sales, stock, payment and reports while keeping the same company context and executive view.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
              {(['purchase', 'sales', 'stock', 'payment', 'report'] as ActiveTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-[1.35rem] border p-4 text-left transition-colors duration-200 ${
                    activeTab === tab
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl ${
                      activeTab === tab ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {getTabIcon(tab)}
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{getTabLabel(tab)}</p>
                      <p className={`mt-1 text-xs leading-5 ${activeTab === tab ? 'text-slate-300' : 'text-slate-500'}`}>
                        {getTabDescription(tab)}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <div className="rounded-[2rem] border border-black/5 bg-white p-4 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.16)] md:p-6">

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
            <ReportsTab
              companyId={primaryCompanyId}
              companyOptions={companies.map((company) => ({ id: company.id, name: company.name }))}
            />
          )}
        </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
