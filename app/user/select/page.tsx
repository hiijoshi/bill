'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import DashboardLayout from '@/app/components/DashboardLayout'
import { CreditCard, Package, Users, BarChart } from 'lucide-react'

interface User {
  id: string
  name: string
  email: string
  role: string
}

export default function UserSelectPage() {
  const router = useRouter()
  const [selectedUser, setSelectedUser] = useState('')
  const [companyId, setCompanyId] = useState('')

  // Mock user data - in real app, this would come from authentication
  const users: User[] = [
    { id: 'user1', name: 'Payment Manager', email: 'payment@company.com', role: 'payment' },
    { id: 'user2', name: 'Stock Manager', email: 'stock@company.com', role: 'stock' },
    { id: 'admin', name: 'Administrator', email: 'admin@company.com', role: 'admin' },
  ]

  const mockCompanies = [
    { id: 'company1', name: 'Demo Company' },
    { id: 'company2', name: 'Test Business' },
  ]

  const handleUserLogin = () => {
    if (!selectedUser || !companyId) {
      alert('Please select user and company')
      return
    }

    const user = users.find(u => u.id === selectedUser)
    if (!user) return

    // Store user info in cookies (in real app, use proper auth)
    document.cookie = `userId=${user.id}; path=/`
    document.cookie = `userRole=${user.role}; path=/`
    document.cookie = `companyId=${companyId}; path=/`

    // Route based on user role
    switch (user.role) {
      case 'payment':
        router.push('/payment/dashboard')
        break
      case 'stock':
        router.push('/stock/dashboard')
        break
      case 'admin':
        router.push('/main/dashboard')
        break
      default:
        router.push('/main/dashboard')
    }
  }

  const getUserIcon = (role: string) => {
    switch (role) {
      case 'payment':
        return <CreditCard className="w-8 h-8 text-blue-600" />
      case 'stock':
        return <Package className="w-8 h-8 text-green-600" />
      case 'admin':
        return <Users className="w-8 h-8 text-purple-600" />
      default:
        return <BarChart className="w-8 h-8 text-gray-600" />
    }
  }

  const getUserDescription = (role: string) => {
    switch (role) {
      case 'payment':
        return 'Manage purchase bill payments and sales receipts'
      case 'stock':
        return 'Monitor inventory levels and stock movements'
      case 'admin':
        return 'Full access to all features and settings'
      default:
        return 'Basic user access'
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Billing System</h1>
          <p className="text-lg text-gray-600">Select your user profile to continue</p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Select Company</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger>
                <SelectValue placeholder="Select Company" />
              </SelectTrigger>
              <SelectContent>
                {mockCompanies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {users.map((user) => (
            <Card
              key={user.id}
              className={`cursor-pointer transition-all hover:shadow-lg ${
                selectedUser === user.id ? 'ring-2 ring-blue-500' : ''
              }`}
              onClick={() => setSelectedUser(user.id)}
            >
              <CardContent className="pt-6">
                <div className="text-center">
                  <div className="flex justify-center mb-4">
                    {getUserIcon(user.role)}
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{user.name}</h3>
                  <p className="text-sm text-gray-600 mb-2">{user.email}</p>
                  <p className="text-xs text-gray-500 mb-4">{getUserDescription(user.role)}</p>
                  <Badge variant={selectedUser === user.id ? 'default' : 'outline'}>
                    {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="text-center">
          <Button
            onClick={handleUserLogin}
            disabled={!selectedUser || !companyId}
            className="px-8 py-3 text-lg"
          >
            Login as Selected User
          </Button>
        </div>

        <div className="mt-8 text-center text-sm text-gray-500">
          <p>This is a demo login system. In production, use proper authentication.</p>
        </div>
      </div>
    </div>
  )
}
