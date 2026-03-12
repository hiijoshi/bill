'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Edit, Trash2, Eye } from 'lucide-react'
import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'

type Trader = { id: string; name: string }
type Company = {
  id: string
  name: string
  traderId: string | null
  address?: string | null
  phone?: string | null
  mandiAccountNumber?: string | null
  createdAt: string
  trader?: Trader | null
}

export default function SuperAdminCompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [traders, setTraders] = useState<Trader[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    traderId: '',
    address: '',
    phone: '',
    mandiAccountNumber: ''
  })

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [companiesRes, tradersRes] = await Promise.all([
        fetch('/api/super-admin/companies'),
        fetch('/api/super-admin/traders')
      ])
      if (!companiesRes.ok || !tradersRes.ok) {
        throw new Error('Failed to load companies')
      }
      const [companiesData, tradersData] = await Promise.all([companiesRes.json(), tradersRes.json()])
      setCompanies(Array.isArray(companiesData) ? companiesData : [])
      setTraders(Array.isArray(tradersData) ? tradersData : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load companies')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const resetForm = () => {
    setIsCreating(false)
    setEditingId(null)
    setFormData({ name: '', traderId: '', address: '', phone: '', mandiAccountNumber: '' })
  }

  const startEdit = (company: Company) => {
    setEditingId(company.id)
    setIsCreating(false)
    setFormData({
      name: company.name,
      traderId: company.traderId || '',
      address: company.address || '',
      phone: company.phone || '',
      mandiAccountNumber: company.mandiAccountNumber || ''
    })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    try {
      const body = {
        name: formData.name.trim(),
        traderId: formData.traderId,
        address: formData.address.trim() || undefined,
        phone: formData.phone.trim() || undefined,
        mandiAccountNumber: formData.mandiAccountNumber.trim() || undefined
      }

      if (!body.name || !body.traderId) {
        setError('Company name and trader are required')
        return
      }

      const url = editingId ? `/api/super-admin/companies/${editingId}` : '/api/super-admin/companies'
      const method = editingId ? 'PUT' : 'POST'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.error || 'Failed to save company')
      }

      resetForm()
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save company')
    }
  }

  const deleteCompany = async (id: string) => {
    if (!confirm('Delete this company?')) return
    setError(null)
    try {
      const response = await fetch(`/api/super-admin/companies/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.error || 'Failed to delete company')
      }
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete company')
    }
  }

  return (
    <SuperAdminShell
      title="Company Management"
      subtitle="Manage all companies globally or under specific traders"
    >
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Company Management</h1>
        <Button onClick={() => { setIsCreating(true); setEditingId(null) }}>
          <Plus className="mr-2 h-4 w-4" />
          New Company
        </Button>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {(isCreating || editingId) && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Edit Company' : 'Create Company'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="name">Company Name</Label>
                <Input id="name" value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="trader">Trader</Label>
                <Select value={formData.traderId} onValueChange={(value) => setFormData((p) => ({ ...p, traderId: value }))}>
                  <SelectTrigger id="trader">
                    <SelectValue placeholder="Select trader" />
                  </SelectTrigger>
                  <SelectContent>
                    {traders.map((trader) => (
                      <SelectItem key={trader.id} value={trader.id}>
                        {trader.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="address">Address</Label>
                <Input id="address" value={formData.address} onChange={(e) => setFormData((p) => ({ ...p, address: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" value={formData.phone} onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="mandiAccountNumber">Mandi Account Number</Label>
                <Input
                  id="mandiAccountNumber"
                  value={formData.mandiAccountNumber}
                  onChange={(e) => setFormData((p) => ({ ...p, mandiAccountNumber: e.target.value }))}
                  placeholder="Leave blank to auto-generate"
                />
              </div>
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
                <Button type="submit">{editingId ? 'Update' : 'Create'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Companies</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-gray-500">Loading companies...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                <TableHead>Trader</TableHead>
                <TableHead>Mandi Account</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell className="font-medium">{company.name}</TableCell>
                  <TableCell>{company.trader?.name || '-'}</TableCell>
                  <TableCell>{company.mandiAccountNumber || '-'}</TableCell>
                  <TableCell>{company.phone || '-'}</TableCell>
                  <TableCell>{new Date(company.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Link
                      href={`/super-admin/companies/${company.id}`}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    >
                      <Eye className="h-3 w-3" />
                      Open
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => startEdit(company)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => deleteCompany(company.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {companies.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-gray-500">No companies found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
    </SuperAdminShell>
  )
}
