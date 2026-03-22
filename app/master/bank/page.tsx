'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Plus, Edit, Trash2, Building } from 'lucide-react'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

interface Bank {
  id: string
  name: string
  branch?: string
  ifscCode: string
  accountNumber?: string
  address?: string
  phone?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export default function BankMasterPage() {
  const [companyId, setCompanyId] = useState('')
  const [banks, setBanks] = useState<Bank[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingBank, setEditingBank] = useState<Bank | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    branch: '',
    ifscCode: '',
    accountNumber: '',
    address: '',
    phone: '',
    isActive: true
  })
  const fetchBanks = useCallback(async (targetCompanyId = companyId) => {
    if (!targetCompanyId) {
      setLoading(false)
      return
    }
    try {
      const response = await fetch(`/api/banks?companyId=${encodeURIComponent(targetCompanyId)}`)
      if (response.ok) {
        const data = await response.json()
        setBanks(data)
      } else {
        setBanks([])
      }
    } catch (error) {
      console.error('Error fetching banks:', error)
      setBanks([])
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    ;(async () => {
      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (!resolvedCompanyId) {
        setErrorMessage('Failed to resolve active company. Please re-login.')
        setLoading(false)
        return
      }

      setCompanyId(resolvedCompanyId)
      stripCompanyParamsFromUrl()
      await fetchBanks(resolvedCompanyId)
    })()
  }, [fetchBanks])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim() || !formData.ifscCode.trim()) {
      alert('Bank name and IFSC code are required')
      return
    }
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }

    // Validate IFSC code format
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(formData.ifscCode)) {
      alert('Invalid IFSC code format. Should be 11 characters: 4 letters + 0 + 6 alphanumeric')
      return
    }

    try {
      const url = editingBank 
        ? `/api/banks?id=${editingBank.id}&companyId=${companyId}`
        : `/api/banks?companyId=${companyId}`
      
      const method = editingBank ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        alert(editingBank ? 'Bank updated successfully!' : 'Bank created successfully!')
        resetForm()
        fetchBanks()
      } else {
        const error = await response.json()
        alert(error.error || 'Operation failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Operation failed')
    }
  }

  const handleEdit = (bank: Bank) => {
    setEditingBank(bank)
    setFormData({
      name: bank.name,
      branch: bank.branch || '',
      ifscCode: bank.ifscCode,
      accountNumber: bank.accountNumber || '',
      address: bank.address || '',
      phone: bank.phone || '',
      isActive: bank.isActive
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this bank? This may affect existing transactions.')) return
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }

    try {
      const response = await fetch(`/api/banks?id=${id}&companyId=${companyId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        alert('Bank deleted successfully!')
        fetchBanks()
      } else {
        const error = await response.json()
        alert(error.error || 'Delete failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Delete failed')
    }
  }

  const handleDeleteAll = async () => {
    if (!confirm('Delete all banks for this company?')) return
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }
    const response = await fetch(`/api/banks?companyId=${companyId}&all=true`, { method: 'DELETE' })
    const result = await response.json().catch(() => ({}))
    alert(result.message || result.error || 'Operation completed')
    if (response.ok) fetchBanks()
  }

  const handleExportCsv = () => {
    if (banks.length === 0) return alert('No bank data to export')
    const headers = ['Name', 'Branch', 'IFSC', 'Account', 'Address', 'Phone', 'Status', 'CreatedAt']
    const rows = banks.map((b) => [b.name, b.branch || '', b.ifscCode, b.accountNumber || '', b.address || '', b.phone || '', b.isActive ? 'Active' : 'Inactive', b.createdAt])
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `banks_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const resetForm = () => {
    setFormData({ 
      name: '', 
      branch: '', 
      ifscCode: '', 
      accountNumber: '', 
      address: '', 
      phone: '', 
      isActive: true 
    })
    setEditingBank(null)
    setIsFormOpen(false)
  }

  if (loading) {
    return (
      <DashboardLayout companyId="">
        <div className="flex justify-center items-center h-screen">Loading...</div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          {errorMessage && (
            <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </div>
          )}
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <Building className="h-8 w-8 text-green-600" />
              <h1 className="text-3xl font-bold">Bank Master</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExportCsv}>Export CSV</Button>
              <Button variant="destructive" onClick={handleDeleteAll}>Delete All</Button>
              <Button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Bank
              </Button>
            </div>
          </div>

          {/* Form */}
          {isFormOpen && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingBank ? 'Edit Bank' : 'Add New Bank'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="name">Bank Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Enter bank name"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="branch">Branch</Label>
                      <Input
                        id="branch"
                        value={formData.branch}
                        onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
                        placeholder="Enter branch name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="ifscCode">IFSC Code *</Label>
                      <Input
                        id="ifscCode"
                        value={formData.ifscCode}
                        onChange={(e) => setFormData({ ...formData, ifscCode: e.target.value.toUpperCase() })}
                        placeholder="Enter IFSC code"
                        maxLength={11}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="accountNumber">Account Number</Label>
                      <Input
                        id="accountNumber"
                        value={formData.accountNumber}
                        onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                        placeholder="Enter account number"
                      />
                    </div>
                    <div>
                      <Label htmlFor="address">Address</Label>
                      <Input
                        id="address"
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        placeholder="Enter bank address"
                      />
                    </div>
                    <div>
                      <Label htmlFor="phone">Phone</Label>
                      <Input
                        id="phone"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        placeholder="Enter phone number"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="isActive"
                        checked={formData.isActive}
                        onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                        className="h-4 w-4"
                      />
                      <Label htmlFor="isActive">Active</Label>
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      {editingBank ? 'Update' : 'Save'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <CardHeader>
              <CardTitle>Bank List</CardTitle>
            </CardHeader>
            <CardContent>
              {banks.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No banks found. Add your first bank to get started.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bank Name</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>IFSC Code</TableHead>
                      <TableHead>Account Number</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {banks.map((bank) => (
                      <TableRow key={bank.id}>
                        <TableCell className="font-medium">{bank.name}</TableCell>
                        <TableCell>{bank.branch || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{bank.ifscCode}</Badge>
                        </TableCell>
                        <TableCell>{bank.accountNumber || '-'}</TableCell>
                        <TableCell>{bank.phone || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={bank.isActive ? 'default' : 'secondary'}>
                            {bank.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(bank)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(bank.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
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
