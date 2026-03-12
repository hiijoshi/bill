'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2 } from 'lucide-react'

type TraderDetail = {
  id: string
  name: string
  locked: boolean
  companies: { id: string; name: string; locked: boolean; createdAt: string }[]
  users: { id: string; userId: string; name?: string | null; role?: string | null; locked: boolean; createdAt: string }[]
  _count: { companies: number; users: number }
}

export default function SuperAdminTraderDetailPage() {
  const params = useParams<{ id: string }>()
  const traderId = params?.id
  const [trader, setTrader] = useState<TraderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <SuperAdminShell
      title="Trader Details"
      subtitle="View trader scope, companies, users, and lock cascade controls"
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
                <Button onClick={toggleLock} disabled={saving}>
                  {saving ? 'Saving...' : trader.locked ? 'Unlock Trader' : 'Lock Trader'}
                </Button>
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
