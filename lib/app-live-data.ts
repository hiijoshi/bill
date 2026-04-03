import { deleteClientCacheByPrefix } from './client-fetch-cache'

export const APP_DATA_CHANGED_EVENT = 'app-data-changed'

export type AppDataScope =
  | 'purchase-bills'
  | 'sales-bills'
  | 'payments'
  | 'banks'
  | 'payment-modes'
  | 'accounting-heads'
  | 'parties'
  | 'suppliers'
  | 'farmers'
  | 'products'
  | 'mandi-types'
  | 'units'
  | 'markas'
  | 'journal-vouchers'
  | 'all'

export type AppDataChangeDetail = {
  companyId: string
  scopes: AppDataScope[]
  updatedAt: number
}

const LIVE_DATA_CHANNEL_NAME = 'mbill-live-data'
let liveDataChannel: BroadcastChannel | null | undefined

function getLiveDataChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null
  }

  if (liveDataChannel !== undefined) {
    return liveDataChannel
  }

  try {
    liveDataChannel = new BroadcastChannel(LIVE_DATA_CHANNEL_NAME)
  } catch {
    liveDataChannel = null
  }

  return liveDataChannel
}

function normalizeScopes(scopes: AppDataScope[]): AppDataScope[] {
  return Array.from(
    new Set(
      scopes
        .map((scope) => String(scope || '').trim() as AppDataScope)
        .filter(Boolean)
    )
  )
}

async function syncAppDataChangeToServer(detail: AppDataChangeDetail): Promise<void> {
  try {
    await fetch('/api/live-updates', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      cache: 'no-store',
      keepalive: true,
      body: JSON.stringify({
        companyId: detail.companyId
      })
    })
  } catch {
    // Best-effort sync only. Local tab and BroadcastChannel updates should keep working.
  }
}

function getCachePrefixesForScope(companyId: string, scope: AppDataScope): string[] {
  switch (scope) {
    case 'purchase-bills':
      return [
        'main-dashboard:',
        `purchase-bills:${companyId}`,
        `payment-purchase-bills:${companyId}:`,
        `purchase-entry:${companyId}`,
        `dashboard-payment:${companyId}`,
        `dashboard-stock:${companyId}`,
        `dashboard-stock-ledger:${companyId}:`,
        `payment-page:${companyId}`,
        `payments-dashboard:${companyId}`
      ]
    case 'sales-bills':
      return [
        'main-dashboard:',
        `sales-bills:${companyId}`,
        `payment-sales-bills:${companyId}`,
        `sales-entry:${companyId}:`,
        `dashboard-payment:${companyId}`,
        `dashboard-stock:${companyId}`,
        `dashboard-stock-ledger:${companyId}:`,
        `payment-page:${companyId}`,
        `payments-dashboard:${companyId}`
      ]
    case 'payments':
      return [
        'main-dashboard:',
        `dashboard-payment:${companyId}`,
        `payment-page:${companyId}`,
        `payments-dashboard:${companyId}`,
        `purchase-bills:${companyId}`,
        `sales-bills:${companyId}`,
        `payment-purchase-bills:${companyId}:`,
        `payment-sales-bills:${companyId}`
      ]
    case 'banks':
      return [
        `payment-banks:${companyId}`,
        `cash-bank-entry:${companyId}`,
        `bank-statement-entry:${companyId}`,
        `journal-voucher-references:${companyId}`
      ]
    case 'payment-modes':
      return [
        `payment-modes:${companyId}`,
        `cash-bank-entry:${companyId}`
      ]
    case 'accounting-heads':
      return [
        `cash-bank-entry:${companyId}`,
        `journal-voucher-references:${companyId}`,
        `bank-statement-entry:${companyId}`
      ]
    case 'parties':
      return [
        `cash-bank-entry:${companyId}`,
        `journal-voucher-references:${companyId}`,
        `bank-statement-entry:${companyId}`,
        `sales-entry:${companyId}:`
      ]
    case 'suppliers':
      return [
        `cash-bank-entry:${companyId}`,
        `bank-statement-entry:${companyId}`
      ]
    case 'farmers':
      return [
        `purchase-entry:${companyId}`,
        `journal-voucher-references:${companyId}`
      ]
    case 'products':
      return [
        'main-dashboard:',
        `purchase-entry:${companyId}`,
        `dashboard-stock:${companyId}`,
        `dashboard-stock-ledger:${companyId}:`
      ]
    case 'mandi-types':
      return [`purchase-entry:${companyId}`]
    case 'units':
      return [`purchase-entry:${companyId}`]
    case 'markas':
      return [`purchase-entry:${companyId}`]
    case 'journal-vouchers':
      return [
        `journal-voucher-references:${companyId}`,
        `payment-page:${companyId}`,
        `payments-dashboard:${companyId}`
      ]
    case 'all':
      return [
        'main-dashboard:',
        `purchase-bills:${companyId}`,
        `payment-purchase-bills:${companyId}:`,
        `purchase-entry:${companyId}`,
        `sales-bills:${companyId}`,
        `payment-sales-bills:${companyId}`,
        `sales-entry:${companyId}:`,
        `dashboard-payment:${companyId}`,
        `dashboard-stock:${companyId}`,
        `dashboard-stock-ledger:${companyId}:`,
        `payment-page:${companyId}`,
        `payments-dashboard:${companyId}`,
        `payment-banks:${companyId}`,
        `cash-bank-entry:${companyId}`,
        `bank-statement-entry:${companyId}`,
        `journal-voucher-references:${companyId}`,
        `payment-modes:${companyId}`
      ]
    default:
      return []
  }
}

export function invalidateAppDataCaches(companyId: string, scopes: AppDataScope[]): void {
  const normalizedCompanyId = String(companyId || '').trim()
  if (!normalizedCompanyId) return

  const prefixes = new Set<string>()
  for (const scope of normalizeScopes(scopes)) {
    for (const prefix of getCachePrefixesForScope(normalizedCompanyId, scope)) {
      prefixes.add(prefix)
    }
  }

  for (const prefix of prefixes) {
    deleteClientCacheByPrefix(prefix)
  }
}

export function broadcastAppDataChanged(detail: AppDataChangeDetail): void {
  if (typeof window === 'undefined') return

  window.dispatchEvent(new CustomEvent<AppDataChangeDetail>(APP_DATA_CHANGED_EVENT, { detail }))
  getLiveDataChannel()?.postMessage(detail)
}

export function notifyAppDataChanged(input: {
  companyId: string
  scopes: AppDataScope[]
}): void {
  if (typeof window === 'undefined') return

  const payload: AppDataChangeDetail = {
    companyId: String(input.companyId || '').trim(),
    scopes: normalizeScopes(input.scopes),
    updatedAt: Date.now()
  }

  if (!payload.companyId || payload.scopes.length === 0) return

  broadcastAppDataChanged(payload)
  void syncAppDataChangeToServer(payload)
}

export function subscribeAppDataChanged(listener: (detail: AppDataChangeDetail) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const onWindowEvent = (event: Event) => {
    const detail = (event as CustomEvent<AppDataChangeDetail>).detail
    if (!detail) return
    listener(detail)
  }

  window.addEventListener(APP_DATA_CHANGED_EVENT, onWindowEvent)

  const channel = getLiveDataChannel()
  const onChannelMessage = (event: MessageEvent<AppDataChangeDetail>) => {
    if (!event.data) return
    listener(event.data)
  }
  channel?.addEventListener('message', onChannelMessage)

  return () => {
    window.removeEventListener(APP_DATA_CHANGED_EVENT, onWindowEvent)
    channel?.removeEventListener('message', onChannelMessage)
  }
}

export function matchesAppDataChange(
  detail: AppDataChangeDetail,
  companyId: string,
  scopes: AppDataScope[]
): boolean {
  const normalizedCompanyId = String(companyId || '').trim()
  if (!normalizedCompanyId || detail.companyId !== normalizedCompanyId) {
    return false
  }

  const allowedScopes = new Set(normalizeScopes(scopes))
  if (allowedScopes.has('all')) {
    return true
  }

  return detail.scopes.some((scope) => scope === 'all' || allowedScopes.has(scope))
}
