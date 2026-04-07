'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import DashboardLayout from '@/app/components/DashboardLayout'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { APP_COMPANY_CHANGED_EVENT, resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { switchClientFinancialYear, type ClientFinancialYearSummary } from '@/lib/client-financial-years'
import { useClientFinancialYear } from '@/lib/use-client-financial-year'

function toDateLabel(value: string | null | undefined): string {
  if (!value) return '-'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('en-IN')
}

function getFinancialYearStartYear(financialYear: ClientFinancialYearSummary | null): number {
  if (!financialYear) {
    const today = new Date()
    return today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1
  }

  const startDate = new Date(financialYear.startDate)
  if (!Number.isFinite(startDate.getTime())) {
    return getFinancialYearStartYear(null)
  }

  return startDate.getFullYear()
}

export default function FinancialYearPage() {
  return (
    <Suspense fallback={<AppLoaderShell kind="dashboard" fullscreen />}>
      <FinancialYearPageContent />
    </Suspense>
  )
}

function FinancialYearPageContent() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState('')
  const [loadingCompany, setLoadingCompany] = useState(true)
  const [createStartYear, setCreateStartYear] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [busyYearId, setBusyYearId] = useState<string | null>(null)
  const { payload, financialYear, loading, reload } = useClientFinancialYear()

  useEffect(() => {
    let cancelled = false

    const loadCompany = async () => {
      setLoadingCompany(true)
      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (cancelled) return

      if (!resolvedCompanyId) {
        setLoadingCompany(false)
        router.push('/main/profile')
        return
      }

      setCompanyId(resolvedCompanyId)
      stripCompanyParamsFromUrl()
      setLoadingCompany(false)
    }

    void loadCompany()

    const onCompanyChanged = () => {
      void loadCompany()
    }

    window.addEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)

    return () => {
      cancelled = true
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    }
  }, [router])

  useEffect(() => {
    if (createStartYear) return
    setCreateStartYear(String(getFinancialYearStartYear(financialYear) + 1))
  }, [createStartYear, financialYear])

  const financialYears = payload.financialYears
  const nextCreateLabel = useMemo(() => {
    const year = Number(createStartYear || 0)
    if (!Number.isFinite(year) || year < 2000) return ''
    return `FY ${year}-${String((year + 1) % 100).padStart(2, '0')}`
  }, [createStartYear])

  const createFinancialYear = async (activate: boolean) => {
    const startYear = Number(createStartYear || 0)
    if (!Number.isFinite(startYear) || startYear < 2000) {
      setMessage({ type: 'error', text: 'Enter a valid financial year start year.' })
      return
    }

    setSubmitting(true)
    setMessage(null)

    try {
      const response = await fetch('/api/financial-years', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startYear,
          activate,
          status: 'open'
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(String(payload?.error || 'Failed to create financial year'))
      }

      if (activate) {
        await switchClientFinancialYear(null)
      }
      await reload(true)
      setCreateStartYear(String(startYear + 1))
      setMessage({
        type: 'success',
        text: activate
          ? `${nextCreateLabel || 'Financial year'} created and activated.`
          : `${nextCreateLabel || 'Financial year'} created successfully.`
      })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to create financial year' })
    } finally {
      setSubmitting(false)
    }
  }

  const updateFinancialYear = async (
    financialYearId: string,
    action: 'activate' | 'open' | 'closed' | 'locked'
  ) => {
    setBusyYearId(financialYearId)
    setMessage(null)

    try {
      if (action === 'activate') {
        const response = await fetch(`/api/financial-years/${financialYearId}/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(String(payload?.error || 'Failed to activate financial year'))
        }
        await switchClientFinancialYear(null)
        setMessage({ type: 'success', text: 'Active financial year updated successfully.' })
      } else {
        const response = await fetch(`/api/financial-years/${financialYearId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: action })
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(String(payload?.error || 'Failed to update financial year status'))
        }
        setMessage({ type: 'success', text: `Financial year marked as ${action}.` })
      }

      await reload(true)
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Financial year update failed' })
    } finally {
      setBusyYearId(null)
    }
  }

  if (loadingCompany) {
    return <AppLoaderShell kind="dashboard" fullscreen />
  }

  return (
    <DashboardLayout companyId={companyId} lockViewport>
      <div className="min-h-full bg-[#f5f5f7]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6 md:p-8">
          <Card>
            <CardHeader className="gap-2">
              <CardTitle>Financial Year Management</CardTitle>
              <p className="text-sm text-slate-600">
                Indian financial years are managed centrally at trader level. All dashboards, ledgers, balances,
                and reports default to the selected or active year.
              </p>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm text-slate-500">Current context</div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-lg font-semibold text-slate-950">{financialYear?.label || 'No financial year found'}</div>
                  {financialYear ? (
                    <Badge variant={financialYear.status === 'open' ? 'default' : 'secondary'}>
                      {financialYear.status === 'open' ? 'Open' : financialYear.status}
                    </Badge>
                  ) : null}
                  {payload.activeFinancialYear?.id === financialYear?.id ? <Badge variant="outline">Active</Badge> : null}
                </div>
                <div className="text-sm text-slate-600">
                  Date window: {financialYear ? `${toDateLabel(financialYear.startDate)} to ${toDateLabel(financialYear.endDate)}` : '-'}
                </div>
                <div className="text-sm text-slate-600">
                  Opening balances and outstanding values carry forward dynamically from transactions before the year start.
                </div>
              </div>

              <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                <div>
                  <Label htmlFor="financialYearStart">Create New Financial Year</Label>
                  <Input
                    id="financialYearStart"
                    inputMode="numeric"
                    value={createStartYear}
                    onChange={(event) => setCreateStartYear(event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                    placeholder="2026"
                    className="mt-2"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Creates {nextCreateLabel || 'the selected financial year'} for 1 April to 31 March.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void createFinancialYear(false)} disabled={submitting}>
                    Create
                  </Button>
                  <Button type="button" onClick={() => void createFinancialYear(true)} disabled={submitting}>
                    Create And Activate
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {message ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                message.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {message.text}
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Configured Financial Years</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-10 text-center text-sm text-slate-500">Loading financial years...</div>
              ) : financialYears.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">No financial years configured yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Window</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {financialYears.map((row) => {
                      const isBusy = busyYearId === row.id
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{row.label}</TableCell>
                          <TableCell>{toDateLabel(row.startDate)} to {toDateLabel(row.endDate)}</TableCell>
                          <TableCell>
                            <Badge variant={row.status === 'open' ? 'default' : 'secondary'}>
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{row.isActive ? 'Yes' : 'No'}</TableCell>
                          <TableCell>{toDateLabel(row.updatedAt)}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap justify-end gap-2">
                              {!row.isActive && row.status === 'open' ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => void updateFinancialYear(row.id, 'activate')}
                                  disabled={isBusy}
                                >
                                  Activate
                                </Button>
                              ) : null}
                              {row.status !== 'open' ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void updateFinancialYear(row.id, 'open')}
                                  disabled={isBusy}
                                >
                                  Reopen
                                </Button>
                              ) : null}
                              {row.status === 'open' ? (
                                <>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void updateFinancialYear(row.id, 'closed')}
                                    disabled={isBusy}
                                  >
                                    Close
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void updateFinancialYear(row.id, 'locked')}
                                    disabled={isBusy}
                                  >
                                    Lock
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
