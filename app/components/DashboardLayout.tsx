'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, CalendarRange, Layers3, LogOut, Menu, ShieldCheck, User } from 'lucide-react'
import Sidebar from './Sidebar'
import HeaderAccountPanel from '@/components/account/HeaderAccountPanel'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { clearClientCache, getOrLoadClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { APP_COMPANY_CHANGED_EVENT, notifyAppCompanyChanged, stripCompanyParamsFromUrl } from '@/lib/company-context'
import {
  loadShellBootstrap,
  SHELL_ACTIVE_COMPANY_CACHE_KEY,
  SHELL_AUTH_CACHE_KEY,
  SHELL_COMPANIES_CACHE_KEY
} from '@/lib/client-shell-data'
import { switchClientFinancialYear } from '@/lib/client-financial-years'
import { useClientFinancialYear } from '@/lib/use-client-financial-year'
import type { DashboardLayoutInitialData, SubscriptionBannerPayload } from '@/lib/app-shell-types'
import { usePlatformClasses } from '@/lib/platform'

interface DashboardLayoutProps {
  children: React.ReactNode
  companyId: string
  headerActions?: React.ReactNode
  lockViewport?: boolean
  hidePageIntro?: boolean
  initialData?: DashboardLayoutInitialData | null
}

type AuthMePayload = {
  user?: {
    userId?: string | null
    name?: string | null
    role?: string | null
    companyId?: string | null
  } | null
  company?: {
    id?: string | null
    name?: string | null
  } | null
}

type CompanySummary = {
  id: string
  name: string
  locked?: boolean
}

const SUBSCRIPTION_CACHE_KEY = 'shell:subscription-current'
const SUBSCRIPTION_CACHE_AGE_MS = 60_000
const APP_SHELL_AUTH_LOADED_EVENT = 'app-shell-auth-loaded'

export default function DashboardLayout({
  children,
  companyId,
  headerActions,
  lockViewport = false,
  hidePageIntro = false,
  initialData = null
}: DashboardLayoutProps) {
  const initialShellBootstrap = initialData?.shellBootstrap || null
  const initialAuthPayload = (initialShellBootstrap?.auth as AuthMePayload | null) || null
  const initialAvailableCompanies = initialShellBootstrap?.companies || []
  const initialResolvedCompanyId =
    String(companyId || initialShellBootstrap?.activeCompanyId || initialAuthPayload?.company?.id || '').trim()
  const initialCompanyName =
    (String(initialAuthPayload?.company?.id || '').trim() === initialResolvedCompanyId
      ? String(initialAuthPayload?.company?.name || '').trim()
      : '') ||
    initialAvailableCompanies.find((row) => row.id === initialResolvedCompanyId)?.name ||
    (initialResolvedCompanyId ? 'Selected company' : null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<string | null>(initialAuthPayload?.user?.userId || null)
  const [currentUserName, setCurrentUserName] = useState<string | null>(initialAuthPayload?.user?.name || null)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(initialAuthPayload?.user?.role || null)
  const [availableCompanies, setAvailableCompanies] = useState<CompanySummary[]>(initialAvailableCompanies)
  const [resolvedCompanyId, setResolvedCompanyId] = useState(initialResolvedCompanyId)
  const [currentCompanyName, setCurrentCompanyName] = useState<string | null>(initialCompanyName)
  const [isSwitchingCompany, setIsSwitchingCompany] = useState(false)
  const [companySwitchError, setCompanySwitchError] = useState<string | null>(null)
  const [isSwitchingFinancialYear, setIsSwitchingFinancialYear] = useState(false)
  const [financialYearSwitchError, setFinancialYearSwitchError] = useState<string | null>(null)
  const [subscriptionBanner, setSubscriptionBanner] = useState<SubscriptionBannerPayload | null>(initialData?.subscriptionBanner || null)
  const {
    payload: financialYearPayload,
    financialYear,
    reload: reloadFinancialYears
  } = useClientFinancialYear({
    initialPayload: initialData?.financialYearPayload || undefined
  })
  const { profile, container, shellPadding, topBarHeight } = usePlatformClasses()
  const router = useRouter()

  const loadShellContext = useCallback(async (force = false) => {
    try {
      if (!force && initialShellBootstrap) {
        setAvailableCompanies(initialShellBootstrap.companies)
        setSubscriptionBanner(initialData?.subscriptionBanner || null)
        setCurrentUser(initialAuthPayload?.user?.userId || null)
        setCurrentUserName(initialAuthPayload?.user?.name || null)
        setCurrentUserRole(initialAuthPayload?.user?.role || null)
        if (typeof window !== 'undefined') {
          if (initialAuthPayload) {
            setClientCache(SHELL_AUTH_CACHE_KEY, initialAuthPayload, { persist: true })
          }
          setClientCache(SHELL_COMPANIES_CACHE_KEY, initialShellBootstrap.companies, { persist: true })
          if (initialResolvedCompanyId) {
            setClientCache(SHELL_ACTIVE_COMPANY_CACHE_KEY, initialResolvedCompanyId, { persist: true })
          }
          window.dispatchEvent(new Event(APP_SHELL_AUTH_LOADED_EVENT))
        }
        return
      }

      const [shellBootstrap, subscriptionPayload] = await Promise.all([
        loadShellBootstrap({
          force,
          onUnauthorized: () => {
            router.push('/login')
          }
        }).catch(() => ({
          auth: null,
          companies: [],
          activeCompanyId: '',
          permissions: null
        })),
        getOrLoadClientCache<SubscriptionBannerPayload | null>(
          SUBSCRIPTION_CACHE_KEY,
          SUBSCRIPTION_CACHE_AGE_MS,
          async () => {
            const response = await fetch('/api/subscription/current', { cache: 'no-store' })
            if (response.status === 401 || response.status === 403) {
              return null
            }
            if (!response.ok) {
              throw new Error('Failed to load subscription summary')
            }
            return (await response.json().catch(() => null)) as SubscriptionBannerPayload | null
          },
          {
            persist: true,
            force,
            shouldCache: (data) => Boolean(data)
          }
        ).catch(() => null)
      ])

      const authPayload = shellBootstrap.auth as AuthMePayload | null
      const normalizedCompanies = shellBootstrap.companies
      setAvailableCompanies(normalizedCompanies)

      if (!authPayload) {
        return
      }

      const normalizedRole = String(authPayload.user?.role || '')
        .toLowerCase()
        .replace(/\s+/g, '_')
      if (normalizedRole === 'super_admin' && window.location.pathname.startsWith('/main')) {
        router.replace('/super-admin/crud')
        return
      }

      setSubscriptionBanner(subscriptionPayload)
      setCurrentUser(authPayload.user?.userId || null)
      setCurrentUserName(authPayload.user?.name || null)
      setCurrentUserRole(authPayload.user?.role || null)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(APP_SHELL_AUTH_LOADED_EVENT))
      }

      const fallbackCompanyId = String(
        shellBootstrap.activeCompanyId ||
        authPayload.company?.id ||
        authPayload.user?.companyId ||
        ''
      ).trim()
      const targetCompanyId = companyId?.trim() || fallbackCompanyId
      if (!targetCompanyId) {
        setResolvedCompanyId('')
        setCurrentCompanyName('Not selected')
        return
      }

      const cachedCompanyName =
        String(authPayload.company?.id || '').trim() === targetCompanyId
          ? String(authPayload.company?.name || '').trim()
          : ''
      const companyName =
        cachedCompanyName ||
        normalizedCompanies.find((row) => row.id === targetCompanyId)?.name ||
        'Selected company'

      setResolvedCompanyId(targetCompanyId)
      setCurrentCompanyName(companyName)
      setClientCache(SHELL_ACTIVE_COMPANY_CACHE_KEY, targetCompanyId, { persist: true })
    } catch (error) {
      void error
    }
  }, [companyId, initialAuthPayload, initialData?.subscriptionBanner, initialResolvedCompanyId, initialShellBootstrap, router])

  useEffect(() => {
    const run = (force = false) => {
      void loadShellContext(force)
    }

    run(false)

    const onSessionRefresh = () => run(true)
    const onCompanyChanged = () => run(true)

    window.addEventListener('sessionRefreshed', onSessionRefresh)
    window.addEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)

    return () => {
      window.removeEventListener('sessionRefreshed', onSessionRefresh)
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    }
  }, [loadShellContext])

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const previousHtmlOverflow = html.style.overflow
    const previousBodyOverflow = body.style.overflow

    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'

    return () => {
      html.style.overflow = previousHtmlOverflow
      body.style.overflow = previousBodyOverflow
    }
  }, [])

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed)
  }

  const closeMobileSidebar = () => {
    setIsMobileSidebarOpen(false)
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (error) {
      // Even if API call fails, redirect to login
      void error
    }
    clearClientCache()
    setCurrentUser(null)
    setCurrentUserName(null)
    setCurrentUserRole(null)
    router.push('/login')
  }

  const handleCompanySwitch = async (nextCompanyId: string) => {
    if (!nextCompanyId || nextCompanyId === resolvedCompanyId || isSwitchingCompany) {
      return
    }

    setCompanySwitchError(null)
    setIsSwitchingCompany(true)

    try {
      const response = await fetch('/api/auth/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ companyId: nextCompanyId, force: true })
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to switch company')
      }

      setResolvedCompanyId(nextCompanyId)
      setCurrentCompanyName(availableCompanies.find((company) => company.id === nextCompanyId)?.name || 'Selected company')
      setClientCache(SHELL_ACTIVE_COMPANY_CACHE_KEY, nextCompanyId, { persist: true })
      notifyAppCompanyChanged(nextCompanyId)
      const currentUrl = new URL(window.location.href)
      currentUrl.searchParams.set('companyId', nextCompanyId)
      currentUrl.searchParams.delete('companyIds')
      router.replace(`${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`, { scroll: false })
      window.setTimeout(() => {
        stripCompanyParamsFromUrl()
      }, 0)
      return
    } catch (error) {
      setCompanySwitchError(error instanceof Error ? error.message : 'Failed to switch company')
    } finally {
      setIsSwitchingCompany(false)
    }
  }

  const showCompanySwitcher = availableCompanies.length > 1
  const showFinancialYearSwitcher = financialYearPayload.financialYears.length > 0
  const isUsingExplicitFinancialYear =
    Boolean(financialYearPayload.selectedFinancialYear?.id) &&
    financialYearPayload.selectedFinancialYear?.id !== financialYearPayload.activeFinancialYear?.id
  const bannerState = String(
    subscriptionBanner?.dataLifecycle?.state || subscriptionBanner?.entitlement?.lifecycleState || ''
  )
    .trim()
    .toLowerCase()
  const shouldShowSubscriptionBanner =
    bannerState.length > 0 &&
    (bannerState !== 'active' && bannerState !== 'trial'
      ? true
      : Number(subscriptionBanner?.entitlement?.daysLeft || 0) <= 7)
  const platformLabel = useMemo(() => {
    if (profile.runtimePlatform === 'ios') return 'iOS workspace'
    if (profile.runtimePlatform === 'android') return 'Android workspace'
    return profile.isDesktop ? 'Web command center' : 'Web workspace'
  }, [profile])
  const densityLabel = profile.density === 'compact' ? 'Dense layout' : 'Comfort layout'

  const handleFinancialYearSwitch = async (nextFinancialYearId: string | null) => {
    const normalizedId = String(nextFinancialYearId || '').trim() || null
    const currentFinancialYearId = String(financialYear?.id || '').trim() || null

    if (
      isSwitchingFinancialYear ||
      (normalizedId && normalizedId === currentFinancialYearId) ||
      (!normalizedId && !isUsingExplicitFinancialYear)
    ) {
      return
    }

    setFinancialYearSwitchError(null)
    setIsSwitchingFinancialYear(true)

    try {
      await switchClientFinancialYear(normalizedId)
      clearClientCache()
      if (resolvedCompanyId) {
        setClientCache(SHELL_ACTIVE_COMPANY_CACHE_KEY, resolvedCompanyId, { persist: true })
      }
      await Promise.all([
        loadShellContext(true),
        reloadFinancialYears(true)
      ])
      if (resolvedCompanyId) {
        notifyAppCompanyChanged(resolvedCompanyId)
      } else {
        window.dispatchEvent(new Event('sessionRefreshed'))
      }
      router.refresh()
    } catch (error) {
      setFinancialYearSwitchError(error instanceof Error ? error.message : 'Failed to switch financial year')
    } finally {
      setIsSwitchingFinancialYear(false)
    }
  }

  return (
    <div
      className={lockViewport ? 'grid-pattern flex h-dvh overflow-hidden bg-transparent' : 'grid-pattern flex h-dvh overflow-hidden bg-transparent'}
      data-platform={profile.runtimePlatform}
      data-viewport={profile.viewport}
    >
      <Suspense fallback={<div className="w-20 border-r bg-white" />}>
        <Sidebar
          companyId={resolvedCompanyId}
          companyName={currentCompanyName}
          isCollapsed={isSidebarCollapsed}
          isMobileOpen={isMobileSidebarOpen}
          onToggleCollapse={toggleSidebar}
          onCloseMobile={closeMobileSidebar}
        />
      </Suspense>
      <div className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${shellPadding}`}>
        <div className="premium-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem]">
          <div className={`shrink-0 border-b border-white/55 bg-white/55 px-4 py-3 shadow-sm md:px-6 ${topBarHeight}`}>
            <div className={`${container} flex flex-wrap items-start justify-between gap-4`}>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsMobileSidebarOpen(true)}
                  className="inline-flex h-10 w-10 rounded-2xl border-white/60 bg-white/70 p-0 text-slate-700 md:hidden"
                  aria-label="Open navigation"
                >
                  <Menu className="h-4 w-4" />
                </Button>
                {!hidePageIntro ? (
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/65 bg-slate-950 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
                        {platformLabel}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white/75 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {densityLabel}
                      </span>
                    </div>
                    <h1 className="mt-2 text-[1.45rem] font-semibold tracking-[-0.03em] text-slate-950 md:text-[1.75rem]">
                      Business Operations Hub
                    </h1>
                    <p className="mt-1 max-w-2xl text-sm text-slate-600">
                      Run purchases, payments, ledgers, stock, and reporting from one structured workspace built for long-form business operations.
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[320px] sm:items-end">
                <div className="flex w-full flex-wrap items-center justify-end gap-2">
                  {showFinancialYearSwitcher ? (
                    <div className="flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-[320px] sm:flex-none">
                      <div className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-white/65 bg-white/75 text-slate-500 sm:flex">
                        <CalendarRange className="h-4 w-4" />
                      </div>
                      <Select
                        value={financialYear?.id || undefined}
                        onValueChange={(value) => {
                          void handleFinancialYearSwitch(value)
                        }}
                        disabled={isSwitchingFinancialYear}
                      >
                        <SelectTrigger
                          className="h-11 w-full rounded-2xl border-white/70 bg-white/80 text-sm text-slate-700"
                          aria-label="Change financial year"
                        >
                          <SelectValue placeholder="Financial Year" />
                        </SelectTrigger>
                        <SelectContent>
                          {financialYearPayload.financialYears.map((row) => (
                            <SelectItem key={row.id} value={row.id}>
                              {row.label}{row.status !== 'open' ? ` (${row.status})` : row.isActive ? ' (Active)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isUsingExplicitFinancialYear ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-2xl"
                          onClick={() => {
                            void handleFinancialYearSwitch(null)
                          }}
                          disabled={isSwitchingFinancialYear}
                        >
                          Active FY
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {showCompanySwitcher ? (
                    <div className="flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-[280px] sm:flex-none">
                      <div className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-white/65 bg-white/75 text-slate-500 sm:flex">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <Select
                        value={resolvedCompanyId || undefined}
                        onValueChange={(value) => {
                          void handleCompanySwitch(value)
                        }}
                        disabled={isSwitchingCompany}
                      >
                        <SelectTrigger
                          className="h-11 w-full rounded-2xl border-white/70 bg-white/80 text-sm text-slate-700"
                          aria-label="Change active company"
                        >
                          <SelectValue placeholder="Change company" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableCompanies.map((company) => (
                            <SelectItem key={company.id} value={company.id} disabled={company.locked}>
                              {company.name}{company.locked ? ' (Locked)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {headerActions}
                  {currentUser && (
                    <HeaderAccountPanel
                      name={currentUserName}
                      userId={currentUser}
                      role={currentUserRole}
                      contextLabel={currentCompanyName || 'Workspace not selected'}
                      menuItems={[
                        { label: 'Profile', icon: User, onClick: () => router.push('/main/profile') },
                        { label: 'Logout', icon: LogOut, onClick: handleLogout, tone: 'danger', separatorBefore: true }
                      ]}
                    />
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 text-xs font-medium text-slate-600">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Secure session
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 py-1">
                    <Layers3 className="h-3.5 w-3.5" />
                    {currentCompanyName || 'No company selected'}
                  </span>
                </div>
              </div>
            </div>
            {companySwitchError ? (
              <div className={`${container} mt-3`}>
                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {companySwitchError}
                </div>
              </div>
            ) : null}
            {financialYearSwitchError ? (
              <div className={`${container} mt-3`}>
                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {financialYearSwitchError}
                </div>
              </div>
            ) : null}
            {shouldShowSubscriptionBanner ? (
              <div className={`${container} mt-3`}>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span className="font-semibold">
                    {subscriptionBanner?.currentSubscription?.planName || 'Subscription'}
                  </span>
                  {' '}
                  {subscriptionBanner?.dataLifecycle?.message ||
                    subscriptionBanner?.entitlement?.message ||
                    'Please contact admin for renewal or upgrade.'}
                </div>
              </div>
            ) : null}
          </div>
          <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div className={`${container} py-4 md:py-5`}>
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
