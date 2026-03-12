'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2 } from 'lucide-react'

type CompanyDetail = {
  id: string
  name: string
  traderId: string | null
  address?: string | null
  phone?: string | null
  mandiAccountNumber?: string | null
  locked: boolean
  trader?: { id: string; name: string } | null
  users: { id: string; userId: string; role?: string | null; locked: boolean }[]
  _count: {
    users: number
    parties: number
    farmers: number
    suppliers: number
    products: number
    purchaseBills: number
    salesBills: number
  }
}

export default function SuperAdminCompanyDetailPage() {
  const params = useParams<{ id: string }>()
  const companyId = params?.id
  const [company, setCompany] = useState<CompanyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/super-admin/companies/${companyId}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Failed to load company')
      setCompany(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load company')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void load()
  }, [load])

  const toggleLock = async () => {
    if (!company) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/super-admin/companies/${company.id}/lock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked: !company.locked })
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
      title="Company Details"
      subtitle="View users, business footprint, and lock controls for one company"
    >
      <div className="space-y-6">
        {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : company ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{company.name}</span>
                  <Badge variant={company.locked ? 'destructive' : 'default'}>
                    {company.locked ? 'Locked' : 'Active'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <p>Company ID: <span className="font-mono">{company.id}</span></p>
                  <p>Trader: {company.trader?.name || company.traderId || '-'}</p>
                  <p>Phone: {company.phone || '-'}</p>
                  <p>Address: {company.address || '-'}</p>
                  <p>Mandi Account Number: {company.mandiAccountNumber || '-'}</p>
                </div>
                <div className="grid gap-2 text-sm md:grid-cols-3">
                  <p>Users: {company._count.users}</p>
                  <p>Products: {company._count.products}</p>
                  <p>Parties/Farmers/Suppliers: {company._count.parties + company._count.farmers + company._count.suppliers}</p>
                  <p>Purchase Bills: {company._count.purchaseBills}</p>
                  <p>Sales Bills: {company._count.salesBills}</p>
                </div>
                <Button onClick={toggleLock} disabled={saving}>
                  {saving ? 'Saving...' : company.locked ? 'Unlock Company' : 'Lock Company'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Users Under Company</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User ID</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {company.users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>{user.userId}</TableCell>
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
