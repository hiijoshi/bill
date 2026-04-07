'use client'

import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'

export type ClientPaymentWorkspaceOptions = {
  includePaymentModes?: boolean
  force?: boolean
}

const PAYMENT_WORKSPACE_CACHE_AGE_MS = 15_000

function buildPaymentWorkspaceCacheKey(companyId: string, includePaymentModes: boolean): string {
  return `payment-workspace:${companyId}:${includePaymentModes ? 'with-modes' : 'core'}`
}

export async function loadClientPaymentWorkspace(
  companyId: string,
  options: ClientPaymentWorkspaceOptions = {}
) {
  const includePaymentModes = options.includePaymentModes === true
  const cacheKey = buildPaymentWorkspaceCacheKey(companyId, includePaymentModes)

  if (!options.force) {
    const cached = getClientCache<Record<string, unknown>>(cacheKey, PAYMENT_WORKSPACE_CACHE_AGE_MS)
    if (cached) {
      return cached
    }
  }

  const params = new URLSearchParams({
    companyId
  })

  if (includePaymentModes) {
    params.set('includePaymentModes', 'true')
  }

  const response = await fetch(`/api/payments/workspace?${params.toString()}`, { cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(String((payload as { error?: string }).error || 'Failed to load payment workspace')) as Error & {
      status?: number
    }
    error.status = response.status
    throw error
  }

  setClientCache(cacheKey, payload)
  return payload
}
