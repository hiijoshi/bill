import type { ClientFinancialYearPayload } from '@/lib/client-financial-years'
import type { ShellAuthMePayload, ShellCompanySummary } from '@/lib/client-shell-data'

export type SubscriptionBannerPayload = {
  entitlement?: {
    lifecycleState?: string | null
    message?: string | null
    daysLeft?: number | null
  } | null
  dataLifecycle?: {
    state?: string | null
    readOnlyMode?: boolean
    message?: string | null
  } | null
  currentSubscription?: {
    planName?: string | null
    endDate?: string | null
  } | null
}

export type DashboardLayoutInitialData = {
  shellBootstrap: {
    auth: ShellAuthMePayload | null
    companies: ShellCompanySummary[]
    activeCompanyId: string
  }
  subscriptionBanner: SubscriptionBannerPayload | null
  financialYearPayload: ClientFinancialYearPayload
}
