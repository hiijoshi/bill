'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Edit, Plus, Trash2 } from 'lucide-react'
import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'

type Trader = { id: string; name: string }
type Company = { id: string; name: string; traderId: string | null }
type User = {
  id: string
  traderId: string
  companyId?: string | null
  userId: string
  name: string | null
  role: string
  trader?: Trader
}

export default function SuperAdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [traders, setTraders] = useState<Trader[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    traderId: '',
    companyId: '',
    userId: '',
    password: '',
    name: ''
  })

  const load = async () => {
    setError(null)
    try {
      const [usersRes, tradersRes] = await Promise.all([
        fetch('/api/super-admin/users'),
        fetch('/api/super-admin/traders')
      ])
      const companiesRes = await fetch('/api/super-admin/companies')
      if (!usersRes.ok || !tradersRes.ok || !companiesRes.ok) throw new Error('Failed to load users')
      const [usersData, tradersData, companiesData] = await Promise.all([
        usersRes.json(),
        tradersRes.json(),
        companiesRes.json()
      ])
      setUsers(Array.isArray(usersData) ? usersData : [])
      setTraders(Array.isArray(tradersData) ? tradersData : [])
      setCompanies(Array.isArray(companiesData) ? companiesData : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const resetForm = () => {
    setEditingId(null)
    setForm({ traderId: '', companyId: '', userId: '', password: '', name: '' })
  }

  const save = async () => {
    setError(null)
    if (!form.traderId || !form.companyId || !form.userId) {
      setError('Trader, Company and User ID are required')
      return
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    try {
      const res = await fetch(editingId ? `/api/super-admin/users/${editingId}` : '/api/super-admin/users', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          traderId: form.traderId,
          companyId: form.companyId || undefined,
          userId: form.userId.trim(),
          name: form.name.trim() || undefined,
          password: form.password
        })
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || 'Failed to save user')
      }
      resetForm()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save user')
    }
  }

  const startEdit = (user: User) => {
    setEditingId(user.id)
    setForm({
      traderId: user.traderId,
      companyId: user.companyId || '',
      userId: user.userId,
      password: '',
      name: user.name || ''
    })
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this user?')) return
    setError(null)
    try {
      const res = await fetch(`/api/super-admin/users/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || 'Failed to delete user')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete user')
    }
  }

  return (
    <SuperAdminShell
      title="User Management"
      subtitle="Manage users, company assignment and privilege matrix"
    >
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Users</h2>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? 'Edit User' : 'Create User'}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label>Trader</Label>
            <Select value={form.traderId || undefined} onValueChange={(value) => setForm((p) => ({ ...p, traderId: value }))}>
              <SelectTrigger><SelectValue placeholder="Select trader" /></SelectTrigger>
              <SelectContent>
                {traders.map((trader) => (
                  <SelectItem key={trader.id} value={trader.id}>{trader.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>User ID</Label>
            <Input value={form.userId} onChange={(e) => setForm((p) => ({ ...p, userId: e.target.value }))} />
          </div>
          <div>
            <Label>Company</Label>
            <Select value={form.companyId || undefined} onValueChange={(value) => setForm((p) => ({ ...p, companyId: value }))}>
              <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
              <SelectContent>
                {companies
                  .filter((company) => !form.traderId || company.traderId === form.traderId)
                  .map((company) => (
                    <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <Label>Role</Label>
            <Input value="company_user (auto)" disabled />
          </div>
          <div className="md:col-span-2">
            <Label>Password</Label>
            <Input type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} />
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            {editingId && <Button variant="outline" onClick={resetForm}>Cancel</Button>}
            <Button onClick={save}><Plus className="mr-2 h-4 w-4" />{editingId ? 'Update' : 'Create'}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Trader</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.userId}</TableCell>
                  <TableCell>{user.name || '-'}</TableCell>
                  <TableCell>{user.role}</TableCell>
                  <TableCell>{user.trader?.name || user.traderId}</TableCell>
                  <TableCell>{user.companyId || '-'}</TableCell>
                  <TableCell>
                    <Link
                      href={`/super-admin/users/${user.id}`}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    >
                      Open Matrix
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => startEdit(user)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => remove(user.id)}>
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
