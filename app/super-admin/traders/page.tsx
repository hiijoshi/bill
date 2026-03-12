'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Edit, Trash2, Eye } from 'lucide-react'
import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'

type Trader = {
  id: string
  name: string
  _count?: { companies: number; users: number }
  createdAt: string
}

export default function SuperAdminTradersPage() {
  const [traders, setTraders] = useState<Trader[]>([])
  const [name, setName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setError(null)
    try {
      const res = await fetch('/api/super-admin/traders')
      if (!res.ok) throw new Error('Failed to load traders')
      const data = await res.json()
      setTraders(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load traders')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const save = async () => {
    if (!name.trim()) return
    setError(null)
    try {
      const res = await fetch(editId ? `/api/super-admin/traders/${editId}` : '/api/super-admin/traders', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || 'Failed to save trader')
      }
      setName('')
      setEditId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save trader')
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this trader?')) return
    try {
      const res = await fetch(`/api/super-admin/traders/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || 'Failed to delete trader')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete trader')
    }
  }

  return (
    <SuperAdminShell
      title="Trader Management"
      subtitle="Create, edit, lock and delete traders with tenant cascade control"
    >
      <div className="space-y-6">
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <Card>
        <CardHeader>
          <CardTitle>{editId ? 'Edit Trader' : 'Create Trader'}</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="Trader name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={save}><Plus className="mr-2 h-4 w-4" />{editId ? 'Update' : 'Create'}</Button>
          {editId && <Button variant="outline" onClick={() => { setEditId(null); setName('') }}>Cancel</Button>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Traders</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Companies</TableHead>
                <TableHead>Users</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traders.map((trader) => (
                <TableRow key={trader.id}>
                  <TableCell>{trader.name}</TableCell>
                  <TableCell>{trader._count?.companies ?? 0}</TableCell>
                  <TableCell>{trader._count?.users ?? 0}</TableCell>
                  <TableCell>
                    <Link
                      href={`/super-admin/traders/${trader.id}`}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    >
                      <Eye className="h-3 w-3" />
                      Open
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setEditId(trader.id); setName(trader.name) }}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => remove(trader.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </div>
    </SuperAdminShell>
  )
}
