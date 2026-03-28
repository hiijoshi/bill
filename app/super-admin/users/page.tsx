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
  company?: { id: string; name: string } | null
  permissions?: Array<{
    companyId?: string | null
    company?: { id: string; name: string } | null
  }>
}

export default function SuperAdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [traders, setTraders] = useState<Trader[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [createMode, setCreateMode] = useState<'new' | 'existing'>('new')
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([])
  const [form, setForm] = useState({
    traderId: '',
    companyId: '',
    existingUserId: '',
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
    setCreateMode('new')
    setSelectedCompanyIds([])
    setForm({ traderId: '', companyId: '', existingUserId: '', userId: '', password: '', name: '' })
  }

  const availableCompanies = companies.filter((company) => !form.traderId || company.traderId === form.traderId)
  const traderUsers = users.filter((user) => user.traderId === form.traderId)
  const selectedExistingUser =
    createMode === 'existing' && form.existingUserId
      ? traderUsers.find((user) => user.id === form.existingUserId) || null
      : null

  const linkedCompanyIds = Array.from(
    new Set(
      [
        ...(selectedExistingUser?.companyId ? [selectedExistingUser.companyId] : []),
        ...((selectedExistingUser?.permissions || [])
          .map((permission) => permission.companyId || '')
          .filter((value) => value.length > 0))
      ]
    )
  )

  const toggleCompanySelection = (companyId: string) => {
    setSelectedCompanyIds((prev) =>
      prev.includes(companyId) ? prev.filter((value) => value !== companyId) : [...prev, companyId]
    )
  }

  const startCreateNew = () => {
    setCreateMode('new')
    setSelectedCompanyIds([])
    setForm((prev) => ({
      ...prev,
      existingUserId: '',
      userId: '',
      password: '',
      name: ''
    }))
  }

  const startAttachExisting = () => {
    setCreateMode('existing')
    setSelectedCompanyIds([])
    setForm((prev) => ({
      ...prev,
      existingUserId: '',
      userId: '',
      password: '',
      name: ''
    }))
  }

  const handleExistingUserChange = (userId: string) => {
    const target = traderUsers.find((user) => user.id === userId) || null
    const targetCompanyIds = Array.from(
      new Set(
        [
          ...(target?.companyId ? [target.companyId] : []),
          ...((target?.permissions || [])
            .map((permission) => permission.companyId || '')
            .filter((value) => value.length > 0))
        ]
      )
    )

    setForm((prev) => ({
      ...prev,
      existingUserId: userId,
      userId: target?.userId || '',
      name: target?.name || '',
      password: ''
    }))
    setSelectedCompanyIds(targetCompanyIds)
  }

  const getUserLinkedCompanies = (user: User) => {
    const byId = new Map<string, string>()
    if (user.companyId) {
      byId.set(user.companyId, user.company?.name || user.companyId)
    }
    for (const permission of user.permissions || []) {
      const companyId = permission.companyId || ''
      if (!companyId) continue
      byId.set(companyId, permission.company?.name || companyId)
    }
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }))
  }

  const save = async () => {
    setError(null)
    const companyIds = Array.from(
      new Set(
        (editingId ? [form.companyId] : selectedCompanyIds).filter((value) => (value || '').trim().length > 0)
      )
    )

    if (!form.traderId || companyIds.length === 0) {
      setError('Trader and at least one company are required')
      return
    }

    if (createMode === 'existing' && !editingId && !form.existingUserId) {
      setError('Select an existing user first')
      return
    }

    if (!form.userId) {
      setError('User ID is required')
      return
    }

    if (!editingId && createMode === 'new' && form.password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    if (editingId && form.password.length > 0 && form.password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    try {
      const res = await fetch(editingId ? `/api/super-admin/users/${editingId}` : '/api/super-admin/users', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          traderId: form.traderId,
          companyId: companyIds[0] || undefined,
          companyIds,
          existingUserId: !editingId && createMode === 'existing' ? form.existingUserId || undefined : undefined,
          userId: form.userId.trim(),
          name: form.name.trim() || undefined,
          password: form.password || undefined
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
    setCreateMode('new')
    setSelectedCompanyIds(user.companyId ? [user.companyId] : [])
    setForm({
      traderId: user.traderId,
      companyId: user.companyId || '',
      existingUserId: '',
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
          {!editingId ? (
            <div className="md:col-span-2 flex flex-wrap gap-2">
              <Button type="button" variant={createMode === 'new' ? 'default' : 'outline'} onClick={startCreateNew}>
                New User
              </Button>
              <Button type="button" variant={createMode === 'existing' ? 'default' : 'outline'} onClick={startAttachExisting}>
                User Selection
              </Button>
            </div>
          ) : null}
          <div>
            <Label>Trader</Label>
            <Select
              value={form.traderId || undefined}
              onValueChange={(value) => {
                setForm((p) => ({
                  ...p,
                  traderId: value,
                  companyId: '',
                  existingUserId: '',
                  ...(createMode === 'new'
                    ? {}
                    : {
                        userId: '',
                        name: '',
                        password: ''
                      })
                }))
                setSelectedCompanyIds([])
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select trader" /></SelectTrigger>
              <SelectContent>
                {traders.map((trader) => (
                  <SelectItem key={trader.id} value={trader.id}>{trader.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!editingId && createMode === 'existing' ? (
            <div>
              <Label>User Selection</Label>
              <Select value={form.existingUserId || undefined} onValueChange={handleExistingUserChange}>
                <SelectTrigger><SelectValue placeholder="Select existing user" /></SelectTrigger>
                <SelectContent>
                  {traderUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.userId}{user.name ? ` - ${user.name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div>
            <Label>User ID</Label>
            <Input
              value={form.userId}
              disabled={!editingId && createMode === 'existing'}
              onChange={(e) => setForm((p) => ({ ...p, userId: e.target.value }))}
            />
          </div>
          {editingId ? (
            <div>
              <Label>Company</Label>
              <Select value={form.companyId || undefined} onValueChange={(value) => setForm((p) => ({ ...p, companyId: value }))}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {availableCompanies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="md:col-span-2">
              <Label>Company Checklist</Label>
              <div className="grid gap-2 rounded border border-slate-200 p-3 md:grid-cols-2">
                {availableCompanies.map((company) => {
                  const alreadyLinked = createMode === 'existing' && linkedCompanyIds.includes(company.id)
                  return (
                    <label key={company.id} className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${alreadyLinked ? 'bg-slate-50 text-slate-500' : 'hover:bg-slate-50'}`}>
                      <input
                        type="checkbox"
                        checked={selectedCompanyIds.includes(company.id)}
                        disabled={alreadyLinked}
                        onChange={() => toggleCompanySelection(company.id)}
                      />
                      <span>{company.name}</span>
                      {alreadyLinked ? <span className="ml-auto text-xs">Already linked</span> : null}
                    </label>
                  )
                })}
              </div>
            </div>
          )}
          <div>
            <Label>Name</Label>
            <Input
              value={form.name}
              disabled={!editingId && createMode === 'existing'}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div>
            <Label>Role</Label>
            <Input value="company_user (auto)" disabled />
          </div>
          <div className="md:col-span-2">
            <Label>{!editingId && createMode === 'existing' ? 'Password (optional, only if you want to change it)' : 'Password'}</Label>
            <Input type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} />
          </div>
          {!editingId && createMode === 'existing' ? (
            <div className="md:col-span-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              Select an existing user under the same trader, then tick additional companies. Already linked companies are shown as locked in the checklist.
            </div>
          ) : null}
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
                <TableHead>Companies</TableHead>
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
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {getUserLinkedCompanies(user).length > 0 ? (
                        getUserLinkedCompanies(user).map((company) => (
                          <span key={`${user.id}:${company.id}`} className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-700">
                            {company.name}
                          </span>
                        ))
                      ) : (
                        <span>-</span>
                      )}
                    </div>
                  </TableCell>
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
