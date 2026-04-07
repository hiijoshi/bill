'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useClientFinancialYear } from '@/lib/use-client-financial-year'

type TraderDetail = {
  id: string
  name: string
  locked: boolean
  companies: { id: string; name: string; locked: boolean; createdAt: string }[]
  users: { id: string; userId: string; name?: string | null; role?: string | null; locked: boolean; createdAt: string }[]
  _count: { companies: number; users: number }
}

function toDateLabel(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('en-IN')
}

export default function SuperAdminTraderDetailPage() {
  const params = useParams<{ id: string }>()
  const traderId = String(params?.id || '')
  const [trader, setTrader] = useState<TraderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [financialYearStart, setFinancialYearStart] = useState('')
  const [financialYearBusyId, setFinancialYearBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const {
    payload: financialYearPayload,
    financialYear,
    reload: reloadFinancialYears
  } = useClientFinancialYear({
    traderId: traderId || undefined,
    enabled: Boolean(traderId)
  })

  const load = useCallback(async () => {
    if (!traderId) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/super-admin/traders/${traderId}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Failed to load trader')
      setTrader(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trader')
    } finally {
      setLoading(false)
    }
  }, [traderId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (financialYearStart) return
    const startDate = financialYear?.startDate ? new Date(financialYear.startDate) : null
    if (startDate && Number.isFinite(startDate.getTime())) {
      setFinancialYearStart(String(startDate.getFullYear() + 1))
      return
    }

    const today = new Date()
    setFinancialYearStart(String((today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1) + 1))
  }, [financialYear, financialYearStart])

  const toggleLock = async () => {
    if (!trader) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/super-admin/traders/${trader.id}/lock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked: !trader.locked })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Failed to update lock state')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update lock state')
    } finally {
      setSaving(false)
    }
  }

  const createFinancialYear = async (activate: boolean) => {
    const startYear = Number(financialYearStart || 0)
    if (!Number.isFinite(startYear) || startYear < 2000) {
      setError('Enter a valid financial year start year')
      return
    }

    setFinancialYearBusyId('create')
    setError(null)
    try {
      const response = await fetch('/api/financial-years', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          traderId,
          startYear,
          activate,
          status: 'open'
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Failed to create financial year')
      await reloadFinancialYears(true)
      setFinancialYearStart(String(startYear + 1))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create financial year')
    } finally {
      setFinancialYearBusyId(null)
    }
  }

  const updateFinancialYear = async (
    financialYearId: string,
    action: 'activate' | 'open' | 'closed' | 'locked'
  ) => {
    setFinancialYearBusyId(financialYearId)
    setError(null)
    try {
      const response = await fetch(
        action === 'activate'
          ? `/api/financial-years/${financialYearId}/activate`
          : `/api/financial-years/${financialYearId}/status`,
        {
          method: action === 'activate' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            action === 'activate'
              ? { traderId }
              : { traderId, status: action }
          )
        }
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Failed to update financial year')
      await reloadFinancialYears(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update financial year')
    } finally {
      setFinancialYearBusyId(null)
    }
  }

  return (
    <SuperAdminShell
      title="Trader Details"
      subtitle="View trader scope, companies, users, lock cascade controls, and jump directly into subscription management"
    >
      <div className="space-y-6">
        {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : trader ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{trader.name}</span>
                  <Badge variant={trader.locked ? 'destructive' : 'default'}>
                    {trader.locked ? 'Locked' : 'Active'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-4">
                <div className="text-sm text-slate-600">
                  Trader ID: <span className="font-mono">{trader.id}</span>
                </div>
                <div className="flex gap-4 text-sm">
                  <span>Companies: {trader._count.companies}</span>
                  <span>Users: {trader._count.users}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" asChild>
                    <Link href={`/super-admin/subscriptions?traderId=${encodeURIComponent(trader.id)}`}>
                      Manage Subscription
                    </Link>
                  </Button>
                  <Button onClick={toggleLock} disabled={saving}>
                    {saving ? 'Saving...' : trader.locked ? 'Unlock Trader' : 'Lock Trader'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Financial Years</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1.2fr_1fr]">
                  <div className="space-y-2">
                    <div className="text-sm text-slate-500">Active / selected year</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-lg font-semibold">{financialYear?.label || 'Not configured'}</div>
                      {financialYear ? (
                        <Badge variant={financialYear.status === 'open' ? 'default' : 'secondary'}>
                          {financialYear.status}
                        </Badge>
                      ) : null}
                      {financialYearPayload.activeFinancialYear?.id === financialYear?.id ? (
                        <Badge variant="outline">Active</Badge>
                      ) : null}
                    </div>
                    <div className="text-sm text-slate-600">
                      {financialYear ? `${toDateLabel(financialYear.startDate)} to ${toDateLabel(financialYear.endDate)}` : 'No financial years configured yet.'}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="financialYearStart">Create new year</Label>
                      <Input
                        id="financialYearStart"
                        inputMode="numeric"
                        value={financialYearStart}
                        onChange={(event) => setFinancialYearStart(event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                        placeholder="2026"
                        className="mt-2"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void createFinancialYear(false)}
                        disabled={financialYearBusyId === 'create'}
                      >
                        Create
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void createFinancialYear(true)}
                        disabled={financialYearBusyId === 'create'}
                      >
                        Create And Activate
                      </Button>
                    </div>
                  </div>
                </div>

                {financialYearPayload.financialYears.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                    No financial years found for this trader yet.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Label</TableHead>
                        <TableHead>Window</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Active</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {financialYearPayload.financialYears.map((row) => {
                        const isBusy = financialYearBusyId === row.id
                        return (
                          <TableRow key={row.id}>
                            <TableCell className="font-medium">{row.label}</TableCell>
                            <TableCell>{toDateLabel(row.startDate)} to {toDateLabel(row.endDate)}</TableCell>
                            <TableCell>{row.status}</TableCell>
                            <TableCell>{row.isActive ? 'Yes' : 'No'}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap justify-end gap-2">
                                {!row.isActive && row.status === 'open' ? (
                                  <Button type="button" size="sm" onClick={() => void updateFinancialYear(row.id, 'activate')} disabled={isBusy}>
                                    Activate
                                  </Button>
                                ) : null}
                                {row.status !== 'open' ? (
                                  <Button type="button" size="sm" variant="outline" onClick={() => void updateFinancialYear(row.id, 'open')} disabled={isBusy}>
                                    Reopen
                                  </Button>
                                ) : null}
                                {row.status === 'open' ? (
                                  <>
                                    <Button type="button" size="sm" variant="outline" onClick={() => void updateFinancialYear(row.id, 'closed')} disabled={isBusy}>
                                      Close
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" onClick={() => void updateFinancialYear(row.id, 'locked')} disabled={isBusy}>
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

            <Card>
              <CardHeader>
                <CardTitle>Companies Under Trader</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trader.companies.map((company) => (
                      <TableRow key={company.id}>
                        <TableCell>{company.name}</TableCell>
                        <TableCell>{company.locked ? 'Locked' : 'Active'}</TableCell>
                        <TableCell>{new Date(company.createdAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Users Under Trader</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trader.users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>{user.userId}</TableCell>
                        <TableCell>{user.name || '-'}</TableCell>
                        <TableCell>{user.role || '-'}</TableCell>
                        <TableCell>{user.locked ? 'Locked' : 'Active'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </SuperAdminShell>
  )
}
