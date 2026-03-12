'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Save } from 'lucide-react'

type PermissionRow = {
  module: string
  label: string
  canRead: boolean
  canWrite: boolean
}

type UserSummary = {
  id: string
  userId: string
  name?: string | null
  role?: string | null
  traderId: string
  companyId?: string | null
}

export default function SuperAdminUserPermissionsPage() {
  const params = useParams<{ id: string }>()
  const userId = params?.id
  const [user, setUser] = useState<UserSummary | null>(null)
  const [companyId, setCompanyId] = useState('')
  const [rows, setRows] = useState<PermissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = useMemo(() => companyId.trim().length > 0 && rows.length > 0, [companyId, rows.length])

  const fetchMatrix = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/super-admin/users/${userId}/permissions`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load permissions')
      }

      setUser(payload.user || null)
      setCompanyId(payload.companyId || '')
      setRows(Array.isArray(payload.permissions) ? payload.permissions : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load permissions')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void fetchMatrix()
  }, [fetchMatrix])

  const toggle = (index: number, key: 'canRead' | 'canWrite', value: boolean) => {
    setRows((prev) =>
      prev.map((row, rowIndex) => {
        if (rowIndex !== index) return row
        if (key === 'canWrite' && value) {
          return { ...row, canWrite: true, canRead: true }
        }
        if (key === 'canRead' && !value && row.canWrite) {
          return { ...row, canRead: false, canWrite: false }
        }
        return { ...row, [key]: value }
      })
    )
  }

  const handleSave = async () => {
    if (!userId || !canSave) return
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/super-admin/users/${userId}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: companyId.trim(),
          permissions: rows.map((row) => ({
            module: row.module,
            canRead: row.canRead,
            canWrite: row.canWrite
          }))
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save permissions')
      }
      alert('Permissions updated successfully')
      await fetchMatrix()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save permissions')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SuperAdminShell
      title="User Privilege Matrix"
      subtitle="Per-user and per-company module access (read/write) controlled by Super Admin"
    >
      <div className="space-y-6">
        {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

        <Card>
          <CardHeader>
            <CardTitle>User Context</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-5">
            <div>
              <Label>User ID</Label>
              <Input value={user?.userId || ''} disabled />
            </div>
            <div>
              <Label>Name</Label>
              <Input value={user?.name || ''} disabled />
            </div>
            <div>
              <Label>Role</Label>
              <Input value={user?.role || ''} disabled />
            </div>
            <div>
              <Label>Trader ID</Label>
              <Input value={user?.traderId || ''} disabled />
            </div>
            <div>
              <Label>Company ID</Label>
              <Input value={companyId} onChange={(e) => setCompanyId(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Privilege Matrix</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Module</TableHead>
                        <TableHead>Read</TableHead>
                        <TableHead>Write</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row, index) => (
                        <TableRow key={row.module}>
                          <TableCell className="font-medium">{row.label}</TableCell>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={row.canRead}
                              onChange={(e) => toggle(index, 'canRead', e.target.checked)}
                            />
                          </TableCell>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={row.canWrite}
                              onChange={(e) => toggle(index, 'canWrite', e.target.checked)}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => fetchMatrix()} disabled={loading || saving}>
                    Reload
                  </Button>
                  <Button onClick={handleSave} disabled={!canSave || saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Matrix
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </SuperAdminShell>
  )
}
