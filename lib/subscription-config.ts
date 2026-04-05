import type { PermissionModule } from '@/lib/permissions'

export const SUBSCRIPTION_BILLING_CYCLES = ['yearly'] as const
export const SUBSCRIPTION_TYPES = ['trial', 'paid'] as const
export const SUBSCRIPTION_STATUSES = ['pending', 'active', 'expired', 'cancelled', 'suspended'] as const
export const SUBSCRIPTION_PAYMENT_STATUSES = ['pending', 'confirmed', 'failed', 'refunded'] as const
export const SUBSCRIPTION_PAYMENT_MODES = ['manual', 'razorpay', 'bank_transfer', 'cash', 'upi'] as const

export type SubscriptionBillingCycle = (typeof SUBSCRIPTION_BILLING_CYCLES)[number]
export type SubscriptionType = (typeof SUBSCRIPTION_TYPES)[number]
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]
export type SubscriptionPaymentStatus = (typeof SUBSCRIPTION_PAYMENT_STATUSES)[number]
export type SubscriptionPaymentMode = (typeof SUBSCRIPTION_PAYMENT_MODES)[number]

export const KNOWN_SUBSCRIPTION_FEATURES = [
  {
    key: 'dashboard',
    label: 'Dashboard Access',
    description: 'Allow trader users to access the ERP dashboard and basic overview.'
  },
  {
    key: 'masters',
    label: 'Master Data',
    description: 'Allow working with products, parties, units, banks, payment modes, and related masters.'
  },
  {
    key: 'purchase',
    label: 'Purchase',
    description: 'Allow purchase entry, special purchase, and purchase list workflows.'
  },
  {
    key: 'sales',
    label: 'Sales',
    description: 'Allow sales entry and sales list workflows.'
  },
  {
    key: 'stock',
    label: 'Stock',
    description: 'Allow stock adjustment and stock dashboard operations.'
  },
  {
    key: 'payments',
    label: 'Payments',
    description: 'Allow payment entry, allocation, bank statement, and voucher workflows.'
  },
  {
    key: 'reports',
    label: 'Reports',
    description: 'Allow reports, ledgers, and analytics views.'
  }
] as const

export type KnownSubscriptionFeatureKey = (typeof KNOWN_SUBSCRIPTION_FEATURES)[number]['key']

export type SubscriptionFeatureDefinition = {
  key: string
  label: string
  description: string
}

export type SubscriptionFeatureInput = {
  featureKey: string
  featureLabel?: string | null
  description?: string | null
  enabled?: boolean
  sortOrder?: number | null
}

export type NormalizedSubscriptionFeatureInput = {
  featureKey: string
  featureLabel: string
  description: string | null
  enabled: boolean
  sortOrder: number
}

export const DEFAULT_SUBSCRIPTION_FEATURE_KEYS = KNOWN_SUBSCRIPTION_FEATURES.map((feature) => feature.key)

export const PERMISSION_MODULE_TO_SUBSCRIPTION_FEATURE: Record<PermissionModule, KnownSubscriptionFeatureKey> = {
  DASHBOARD: 'dashboard',
  MASTER_PRODUCTS: 'masters',
  MASTER_PARTIES: 'masters',
  MASTER_UNITS: 'masters',
  MASTER_TRANSPORT: 'masters',
  MASTER_BANK: 'masters',
  MASTER_ACCOUNTING_HEAD: 'masters',
  MASTER_MARKA: 'masters',
  MASTER_PAYMENT_MODE: 'masters',
  MASTER_SALES_ITEM: 'masters',
  PURCHASE_ENTRY: 'purchase',
  PURCHASE_LIST: 'purchase',
  SALES_ENTRY: 'sales',
  SALES_LIST: 'sales',
  STOCK_ADJUSTMENT: 'stock',
  STOCK_DASHBOARD: 'stock',
  PAYMENTS: 'payments',
  REPORTS: 'reports'
}

const FEATURE_DEFINITION_MAP = new Map<string, SubscriptionFeatureDefinition>(
  KNOWN_SUBSCRIPTION_FEATURES.map((feature) => [feature.key, feature])
)

function normalizeToken(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
}

export function normalizeSubscriptionBillingCycle(value: unknown): SubscriptionBillingCycle {
  return normalizeToken(value) === 'yearly' ? 'yearly' : 'yearly'
}

export function normalizeSubscriptionType(value: unknown): SubscriptionType {
  return normalizeToken(value) === 'trial' ? 'trial' : 'paid'
}

export function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus {
  const normalized = normalizeToken(value)
  if (normalized === 'pending') return 'pending'
  if (normalized === 'active') return 'active'
  if (normalized === 'expired') return 'expired'
  if (normalized === 'cancelled') return 'cancelled'
  if (normalized === 'suspended') return 'suspended'
  return 'pending'
}

export function normalizeSubscriptionPaymentStatus(value: unknown): SubscriptionPaymentStatus {
  const normalized = normalizeToken(value)
  if (normalized === 'confirmed') return 'confirmed'
  if (normalized === 'failed') return 'failed'
  if (normalized === 'refunded') return 'refunded'
  return 'pending'
}

export function normalizeSubscriptionPaymentMode(value: unknown): SubscriptionPaymentMode {
  const normalized = normalizeToken(value)
  if (normalized === 'razorpay') return 'razorpay'
  if (normalized === 'bank_transfer') return 'bank_transfer'
  if (normalized === 'cash') return 'cash'
  if (normalized === 'upi') return 'upi'
  return 'manual'
}

export function normalizeSubscriptionFeatureKey(value: unknown): string {
  return normalizeToken(value)
}

export function getSubscriptionFeatureDefinition(featureKey: string): SubscriptionFeatureDefinition | null {
  return FEATURE_DEFINITION_MAP.get(normalizeSubscriptionFeatureKey(featureKey)) || null
}

export function buildDefaultSubscriptionFeatureInputs(enabledKeys = DEFAULT_SUBSCRIPTION_FEATURE_KEYS) {
  const enabledSet = new Set(enabledKeys.map((value) => normalizeSubscriptionFeatureKey(value)).filter(Boolean))

  return KNOWN_SUBSCRIPTION_FEATURES.map((feature, index) => ({
    featureKey: feature.key,
    featureLabel: feature.label,
    description: feature.description,
    enabled: enabledSet.has(feature.key),
    sortOrder: index
  }))
}

export function normalizeSubscriptionFeatureInputs(
  input: SubscriptionFeatureInput[] | null | undefined,
  fallbackEnabledKeys = DEFAULT_SUBSCRIPTION_FEATURE_KEYS
): NormalizedSubscriptionFeatureInput[] {
  if (!Array.isArray(input) || input.length === 0) {
    return buildDefaultSubscriptionFeatureInputs(fallbackEnabledKeys)
  }

  const rows = new Map<string, NormalizedSubscriptionFeatureInput>()
  let fallbackOrder = 0

  for (const raw of input) {
    const featureKey = normalizeSubscriptionFeatureKey(raw.featureKey)
    if (!featureKey) continue

    const definition = getSubscriptionFeatureDefinition(featureKey)
    const featureLabel = String(raw.featureLabel || definition?.label || featureKey)
      .trim()
      .slice(0, 120)
    const description = String(raw.description || definition?.description || '').trim()
    const sortOrder =
      typeof raw.sortOrder === 'number' && Number.isFinite(raw.sortOrder) ? Math.trunc(raw.sortOrder) : fallbackOrder

    rows.set(featureKey, {
      featureKey,
      featureLabel: featureLabel || featureKey,
      description: description.length > 0 ? description.slice(0, 400) : null,
      enabled: raw.enabled !== false,
      sortOrder
    })

    fallbackOrder += 1
  }

  return Array.from(rows.values()).sort((left, right) => left.sortOrder - right.sortOrder || left.featureLabel.localeCompare(right.featureLabel))
}
