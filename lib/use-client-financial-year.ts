'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  APP_FINANCIAL_YEAR_CHANGED_EVENT,
  getEffectiveClientFinancialYear,
  getFinancialYearDateRangeInput,
  loadClientFinancialYears,
  primeClientFinancialYears,
  type ClientFinancialYearPayload,
  type ClientFinancialYearSummary,
  type FinancialYearDateRangeInput
} from '@/lib/client-financial-years'

const EMPTY_PAYLOAD: ClientFinancialYearPayload = {
  traderId: '',
  activeFinancialYear: null,
  selectedFinancialYear: null,
  financialYears: []
}

export function useClientFinancialYear(options: {
  traderId?: string
  enabled?: boolean
  initialPayload?: ClientFinancialYearPayload | null
} = {}) {
  const initialPayload = options.initialPayload || EMPTY_PAYLOAD
  const [payload, setPayload] = useState<ClientFinancialYearPayload>(initialPayload)
  const [loading, setLoading] = useState(Boolean(options.enabled !== false && !options.initialPayload))
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (force = false) => {
    if (options.enabled === false) {
      setLoading(false)
      return EMPTY_PAYLOAD
    }

    setLoading(true)
    setError(null)

    try {
      const nextPayload = await loadClientFinancialYears({
        traderId: options.traderId,
        force
      })
      setPayload(nextPayload)
      return nextPayload
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Failed to load financial year'
      setError(message)
      return EMPTY_PAYLOAD
    } finally {
      setLoading(false)
    }
  }, [options.enabled, options.traderId])

  useEffect(() => {
    let cancelled = false

    if (options.initialPayload) {
      primeClientFinancialYears(options.initialPayload, options.traderId ? options.traderId : 'self')
    }

    const load = async (force = false) => {
      const nextPayload = await reload(force)
      if (cancelled) return
      setPayload(nextPayload)
    }

    if (!options.initialPayload) {
      void load(false)
    } else {
      setLoading(false)
    }

    const onFinancialYearChanged = () => {
      void load(true)
    }

    window.addEventListener(APP_FINANCIAL_YEAR_CHANGED_EVENT, onFinancialYearChanged)

    return () => {
      cancelled = true
      window.removeEventListener(APP_FINANCIAL_YEAR_CHANGED_EVENT, onFinancialYearChanged)
    }
  }, [options.initialPayload, options.traderId, reload])

  const financialYear = getEffectiveClientFinancialYear(payload)
  const financialYearRange = getFinancialYearDateRangeInput(financialYear)

  return {
    payload,
    financialYear,
    financialYearRange,
    loading,
    error,
    reload
  }
}

export function getFinancialYearRangeOrToday(
  financialYear: ClientFinancialYearSummary | null
): FinancialYearDateRangeInput {
  return getFinancialYearDateRangeInput(financialYear)
}
