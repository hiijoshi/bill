'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Plus, Edit, Trash2, Users } from 'lucide-react'

interface Trader {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  _count: {
    companies: number
    users: number
  }
}

export default function TraderMasterPage() {
  const [traders, setTraders] = useState<Trader[]>([])
  const [loading, setLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTrader, setEditingTrader] = useState<Trader | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: ''
  })

  useEffect(() => {
    fetchTraders()
  }, [])

  const fetchTraders = async () => {
    try {
      const response = await fetch('/api/traders')
      if (response.ok) {
        const data = await response.json()
        setTraders(data)
      }
    } catch (error) {
      console.error('Error fetching traders:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      alert('Trader name is required')
      return
    }

    try {
      const url = editingTrader 
        ? `/api/traders?id=${editingTrader.id}`
        : '/api/traders'
      
      const method = editingTrader ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        alert(editingTrader ? 'Trader updated successfully!' : 'Trader created successfully!')
        resetForm()
        fetchTraders()
      } else {
        const error = await response.json()
        alert(error.error || 'Operation failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Operation failed')
    }
  }

  const handleEdit = (trader: Trader) => {
    setEditingTrader(trader)
    setFormData({
      name: trader.name
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this trader? This will also delete all associated companies and users.')) return

    try {
      const response = await fetch(`/api/traders?id=${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        alert('Trader deleted successfully!')
        fetchTraders()
      } else {
        const error = await response.json()
        alert(error.error || 'Delete failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Delete failed')
    }
  }

  const resetForm = () => {
    setFormData({ name: '' })
    setEditingTrader(null)
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
    <DashboardLayout companyId="">
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-purple-600" />
              <h1 className="text-3xl font-bold">Trader Master</h1>
            </div>
            <Button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Trader
            </Button>
          </div>

          {/* Form */}
          {isFormOpen && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingTrader ? 'Edit Trader' : 'Add New Trader'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="name">Trader Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Enter trader name"
                        required
                      />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      {editingTrader ? 'Update' : 'Save'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <CardHeader>
              <CardTitle>Trader List</CardTitle>
            </CardHeader>
            <CardContent>
              {traders.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No traders found. Add your first trader to get started.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trader Name</TableHead>
                      <TableHead>Companies</TableHead>
                      <TableHead>Users</TableHead>
                      <TableHead>Created Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {traders.map((trader) => (
                      <TableRow key={trader.id}>
                        <TableCell className="font-medium">{trader.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{trader._count.companies}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{trader._count.users}</Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(trader.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(trader)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(trader.id)}
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
