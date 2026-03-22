'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Plus, Edit, Trash2, Ruler } from 'lucide-react'

interface Unit {
  id: string
  name: string
  symbol: string
  description?: string
  createdAt: string
  updatedAt: string
}

interface DashboardUnitPageProps {
  params: Promise<{ companyId: string }>
}

export default function DashboardUnitPage({ params }: DashboardUnitPageProps) {
  const router = useRouter()
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null)
  const [companyId, setCompanyId] = useState<string>('')

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    description: ''
  })

  const fetchUnits = useCallback(async (companyId: string) => {
    try {
      const response = await fetch(`/api/units?companyId=${companyId}`)
      
      if (response.ok) {
        const data = await response.json()
        setUnits(data)
      } else if (response.status === 401) {
        // Token expired or invalid - redirect to login
        console.error('Authentication required - redirecting to login')
        alert('Your session has expired. Please login again.')
        router.push('/login')
        return
      } else {
        const errorText = await response.text()
        console.error('Error fetching units:', errorText)
        alert('Error fetching units: ' + errorText)
      }
    } catch (error) {
      console.error('Error fetching units:', error)
      // Check if it's an authentication error
      if (error instanceof Error && error.message.includes('401')) {
        alert('Your session has expired. Please login again.')
        router.push('/login')
        return
      }
      alert('Error fetching units: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    const resolveParams = async () => {
      const resolvedParams = await params
      setCompanyId(resolvedParams.companyId)
      if (resolvedParams.companyId) {
        void fetchUnits(resolvedParams.companyId)
      }
    }
    void resolveParams()
  }, [fetchUnits, params])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim() || !formData.symbol.trim()) {
      alert('Unit name and symbol are required')
      return
    }

    try {
      const url = editingUnit 
        ? `/api/units?id=${editingUnit.id}&companyId=${companyId}`
        : `/api/units?companyId=${companyId}`
      
      const method = editingUnit ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        const updatedUnit = await response.json()
        
        if (editingUnit) {
          setUnits(units.map(unit => 
            unit.id === editingUnit.id ? updatedUnit : unit
          ))
        } else {
          setUnits([...units, updatedUnit])
        }

        // Reset form
        setFormData({ name: '', symbol: '', description: '' })
        setEditingUnit(null)
        setIsFormOpen(false)
      } else {
        const errorData = await response.json()
        alert('Error: ' + (errorData.error || 'Failed to save unit'))
      }
    } catch (error) {
      console.error('Error saving unit:', error)
      alert('Error: Failed to save unit')
    }
  }

  const handleEdit = (unit: Unit) => {
    setEditingUnit(unit)
    setFormData({
      name: unit.name,
      symbol: unit.symbol,
      description: unit.description || ''
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (unitId: string) => {
    if (!confirm('Are you sure you want to delete this unit?')) {
      return
    }

    try {
      const response = await fetch(`/api/units?id=${unitId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setUnits(units.filter(unit => unit.id !== unitId))
      } else {
        const errorData = await response.json()
        alert('Error: ' + (errorData.error || 'Failed to delete unit'))
      }
    } catch (error) {
      console.error('Error deleting unit:', error)
      alert('Error: Failed to delete unit')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg">Loading units...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Units Management</h1>
          <p className="text-gray-600">Manage measurement units for your products</p>
        </div>
        <Button onClick={() => setIsFormOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Unit
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ruler className="w-5 h-5" />
            Units List
          </CardTitle>
        </CardHeader>
        <CardContent>
          {units.length === 0 ? (
            <div className="text-center py-8">
              <Ruler className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No units found</h3>
              <p className="text-gray-500 mb-4">Get started by adding your first unit</p>
              <Button onClick={() => setIsFormOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Unit
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {units.map((unit) => (
                  <TableRow key={unit.id}>
                    <TableCell className="font-medium">{unit.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{unit.symbol}</Badge>
                    </TableCell>
                    <TableCell>{unit.description || '-'}</TableCell>
                    <TableCell>
                      {new Date(unit.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(unit)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDelete(unit.id)}
                        >
                          <Trash2 className="w-4 h-4" />
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

      {/* Add/Edit Unit Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>
                {editingUnit ? 'Edit Unit' : 'Add New Unit'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="name">Unit Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Kilogram"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="symbol">Symbol</Label>
                  <Input
                    id="symbol"
                    value={formData.symbol}
                    onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                    placeholder="e.g., kg"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="description">Description (Optional)</Label>
                  <Input
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Brief description of the unit"
                  />
                </div>
                <div className="flex space-x-2 pt-4">
                  <Button type="submit" className="flex-1">
                    {editingUnit ? 'Update' : 'Create'} Unit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsFormOpen(false)
                      setEditingUnit(null)
                      setFormData({ name: '', symbol: '', description: '' })
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
