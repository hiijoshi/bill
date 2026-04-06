import { getOrLoadClientCache, setClientCache } from '@/lib/client-fetch-cache'

export const APP_FINANCIAL_YEAR_CHANGED_EVENT = 'app-financial-year-changed'
export const FINANCIAL_YEAR_CACHE_KEY = 'shell:financial-years'
export const FINANCIAL_YEAR_CACHE_AGE_MS = 5 * 60_000

export type ClientFinancialYearSummary = {
  id: string
  traderId: string
  label: string
  startDate: string
  endDate: string
  isActive: boolean
  status: 'open' | 'closed' | 'locked'
  createdAt?: string
  updatedAt?: string
  activatedAt?: string | null
  closedAt?: string | null
  lockedAt?: string | null
}

export type ClientFinancialYearPayload = {
  traderId: string
  activeFinancialYear: ClientFinancialYearSummary | null
  selectedFinancialYear: ClientFinancialYearSummary | null
  financialYears: ClientFinancialYearSummary[]
}

export type FinancialYearDateRangeInput = {
  dateFrom: string
  dateTo: string
}

function normalizeFinancialYearRow(value: unknown): ClientFinancialYearSummary | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Record<string, unknown>
  const id = String(row.id || '').trim()
  const traderId = String(row.traderId || '').trim()
  const label = String(row.label || '').trim()
  const startDate = String(row.startDate || '').trim()
  const endDate = String(row.endDate || '').trim()
  if (!id || !traderId || !label || !startDate || !endDate) {
    return null
  }

  const normalizedStatus = String(row.status || '').trim().toLowerCase()

  return {
    id,
    traderId,
    label,
    startDate,
    endDate,
    isActive: Boolean(row.isActive),
    status:
      normalizedStatus === 'closed' || normalizedStatus === 'locked'
        ? normalizedStatus
        : 'open',
    createdAt: row.createdAt ? String(row.createdAt) : undefined,
    updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
    activatedAt: row.activatedAt ? String(row.activatedAt) : null,
    closedAt: row.closedAt ? String(row.closedAt) : null,
    lockedAt: row.lockedAt ? String(row.lockedAt) : null
  }
}

function normalizeFinancialYearPayload(value: unknown): ClientFinancialYearPayload {
  if (!value || typeof value !== 'object') {
    return {
      traderId: '',
      activeFinancialYear: null,
      selectedFinancialYear: null,
      financialYears: []
    }
  }

  const payload = value as Record<string, unknown>
  const financialYears = Array.isArray(payload.financialYears)
    ? payload.financialYears
        .map((row) => normalizeFinancialYearRow(row))
        .filter((row): row is ClientFinancialYearSummary => Boolean(row))
    : []

  return {
    traderId: String(payload.traderId || '').trim(),
    activeFinancialYear: normalizeFinancialYearRow(payload.activeFinancialYear),
    selectedFinancialYear: normalizeFinancialYearRow(payload.selectedFinancialYear),
    financialYears
  }
}

function parseCalendarDateParts(value: string): [number, number, number] | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  return [year, month, day]
}

function parseFinancialYearBoundary(value: string | Date, endOfDay = false): Date {
  if (value instanceof Date) {
    return new Date(value)
  }

  const dateParts = parseCalendarDateParts(value)
  if (dateParts) {
    const [year, month, day] = dateParts
    return new Date(
      year,
      month - 1,
      day,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    )
  }

  return new Date(value)
}

export function formatFinancialYearDateInput(value: string | Date): string {
  if (typeof value === 'string') {
    const dateParts = parseCalendarDateParts(value)
    if (dateParts) {
      const [year, month, day] = dateParts
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  const parsed = parseFinancialYearBoundary(value)
  if (!Number.isFinite(parsed.getTime())) {
    return ''
  }

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getDefaultTransactionDateInput(financialYear: {
  startDate: string | Date
  endDate: string | Date
} | null): string {
  const today = new Date()
  if (!financialYear) {
    return formatFinancialYearDateInput(today)
  }

  const startDate = parseFinancialYearBoundary(financialYear.startDate, false)
  const endDate = parseFinancialYearBoundary(financialYear.endDate, true)
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    return formatFinancialYearDateInput(today)
  }

  if (today.getTime() < startDate.getTime()) {
    return formatFinancialYearDateInput(startDate)
  }

  if (today.getTime() > endDate.getTime()) {
    return formatFinancialYearDateInput(endDate)
  }

  return formatFinancialYearDateInput(today)
}

export function getEffectiveClientFinancialYear(
  payload: Pick<ClientFinancialYearPayload, 'selectedFinancialYear' | 'activeFinancialYear'> | null | undefined
): ClientFinancialYearSummary | null {
  return payload?.selectedFinancialYear || payload?.activeFinancialYear || null
}

export function getFinancialYearDateRangeInput(
  financialYear: {
    startDate: string | Date
    endDate: string | Date
  } | null
): FinancialYearDateRangeInput {
  if (!financialYear) {
    const today = formatFinancialYearDateInput(new Date())
    return {
      dateFrom: today,
      dateTo: today
    }
  }

  return {
    dateFrom: formatFinancialYearDateInput(financialYear.startDate),
    dateTo: formatFinancialYearDateInput(financialYear.endDate)
  }
}

export async function loadClientFinancialYears(options: {
  force?: boolean
  traderId?: string
} = {}): Promise<ClientFinancialYearPayload> {
  const query = new URLSearchParams()
  if (options.traderId) {
    query.set('traderId', options.traderId)
  }
  const key = `${FINANCIAL_YEAR_CACHE_KEY}:${query.toString() || 'self'}`

  return getOrLoadClientCache<ClientFinancialYearPayload>(
    key,
    FINANCIAL_YEAR_CACHE_AGE_MS,
    async () => {
      const response = await fetch(`/api/financial-years${query.toString() ? `?${query.toString()}` : ''}`, {
        cache: 'no-store'
      })
      if (!response.ok) {
        throw new Error('Failed to load financial years')
      }

      const payload = normalizeFinancialYearPayload(await response.json().catch(() => null))
      return payload
    },
    {
      persist: true,
      force: options.force,
      shouldCache: (payload) => Boolean(payload)
    }
  )
}

export async function switchClientFinancialYear(financialYearId: string | null): Promise<ClientFinancialYearPayload> {
  const response = await fetch('/api/auth/financial-year', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    cache: 'no-store',
    body: JSON.stringify({
      financialYearId: financialYearId || null
    })
  })

  const payload = normalizeFinancialYearPayload(await response.json().catch(() => null))
  if (!response.ok) {
    throw new Error('Failed to switch financial year')
  }

  const key = `${FINANCIAL_YEAR_CACHE_KEY}:self`
  setClientCache(key, payload, { persist: true })
  notifyAppFinancialYearChanged(payload.selectedFinancialYear?.id || payload.activeFinancialYear?.id || '')
  return payload
}

export function notifyAppFinancialYearChanged(financialYearId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(APP_FINANCIAL_YEAR_CHANGED_EVENT, {
      detail: {
        financialYearId: String(financialYearId || '').trim()
      }
    })
  )
}
