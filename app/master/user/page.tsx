'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Plus, Edit, Trash2, User } from 'lucide-react'

interface User {
  id: string
  traderId: string
  userId: string
  password: string
  name?: string
  role: string
  trader: {
    name: string
  }
  createdAt: string
  updatedAt: string
}

interface Trader {
  id: string
  name: string
}

export default function UserMasterPage() {
  const [users, setUsers] = useState<User[]>([])
  const [traders, setTraders] = useState<Trader[]>([])
  const [loading, setLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    traderId: '',
    userId: '',
    password: '',
    name: '',
    role: 'user'
  })

  useEffect(() => {
    fetchUsers()
    fetchTraders()
  }, [])

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users')
      if (response.ok) {
        const data = await response.json()
        setUsers(data)
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTraders = async () => {
    try {
      const response = await fetch('/api/traders')
      if (response.ok) {
        const data = await response.json()
        setTraders(data)
      }
    } catch (error) {
      console.error('Error fetching traders:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.traderId || !formData.userId || !formData.password) {
      alert('Trader, User ID, and Password are required')
      return
    }

    try {
      const url = editingUser 
        ? `/api/users?id=${editingUser.id}`
        : '/api/users'
      
      const method = editingUser ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        alert(editingUser ? 'User updated successfully!' : 'User created successfully!')
        resetForm()
        fetchUsers()
      } else {
        const error = await response.json()
        alert(error.error || 'Operation failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Operation failed')
    }
  }

  const handleEdit = (user: User) => {
    setEditingUser(user)
    setFormData({
      traderId: user.traderId,
      userId: user.userId,
      password: user.password,
      name: user.name || '',
      role: user.role
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return

    try {
      const response = await fetch(`/api/users?id=${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        alert('User deleted successfully!')
        fetchUsers()
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
    setFormData({ 
      traderId: '', 
      userId: '', 
      password: '', 
      name: '', 
      role: 'user' 
    })
    setEditingUser(null)
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
              <User className="h-8 w-8 text-green-600" />
              <h1 className="text-3xl font-bold">User Master</h1>
            </div>
            <Button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add User
            </Button>
          </div>

          {/* Form */}
          {isFormOpen && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingUser ? 'Edit User' : 'Add New User'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="trader">Trader *</Label>
                      <Select value={formData.traderId} onValueChange={(value) => setFormData({ ...formData, traderId: value })}>
                        <SelectTrigger>
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
                      <Label htmlFor="userId">User ID *</Label>
                      <Input
                        id="userId"
                        value={formData.userId}
                        onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
                        placeholder="Enter user ID"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="password">Password *</Label>
                      <Input
                        id="password"
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        placeholder="Enter password"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="name">Display Name</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Enter display name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="role">Role *</Label>
                      <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="user">User</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      {editingUser ? 'Update' : 'Save'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <CardHeader>
              <CardTitle>User List</CardTitle>
            </CardHeader>
            <CardContent>
              {users.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No users found. Add your first user to get started.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User ID</TableHead>
                      <TableHead>Display Name</TableHead>
                      <TableHead>Trader</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Created Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.userId}</TableCell>
                        <TableCell>{user.name || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{user.trader.name}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                            {user.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(user.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(user)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(user.id)}
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
