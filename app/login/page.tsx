'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Building2, User, Lock, AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const formData = new FormData(e.currentTarget)
      const traderId = formData.get('traderId') as string
      const userId = formData.get('userId') as string
      const password = formData.get('password') as string

      // Validate trader ID is not empty
      if (!traderId || traderId.trim() === '') {
        setError('Trader ID is required')
        return
      }

      // Call login API
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ traderId, userId, password }),
      })

      const contentType = response.headers.get('content-type')

      if (!response.ok) {
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json()
          throw new Error(`Login failed: ${errorData.error || 'Unknown error'}`)
        } else {
          await response.text()
          throw new Error(`Login failed: Server returned HTML error page (Status: ${response.status})`)
        }
      }

      // Parse successful response
      if (!contentType || !contentType.includes('application/json')) {
        await response.text()
        throw new Error('Login failed: Invalid response format from server')
      }
      
      await response.json()
      
      // Note: HttpOnly cookies are set automatically by the server
      // No need to store tokens client-side anymore for security
      
      // Redirect to dashboard (multi-company ready)
      router.push('/main/dashboard')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Building2 className="mx-auto h-12 w-12 text-blue-600" />
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Enter your credentials to access the billing system
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-center">Login</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Trader ID Input */}
              <div>
                <Label htmlFor="traderId">Trader ID</Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="traderId"
                    name="traderId"
                    type="text"
                    required
                    className="pl-10"
                    placeholder="Enter your trader ID"
                    disabled={loading}
                  />
                </div>
              </div>

              {/* User ID */}
              <div>
                <Label htmlFor="userId">User ID</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="userId"
                    name="userId"
                    type="text"
                    required
                    className="pl-10"
                    placeholder="Enter your user ID"
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    required
                    className="pl-10"
                    placeholder="Enter your password"
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="flex items-center space-x-2 p-3 bg-red-50 border border-red-200 rounded-md">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full"
                disabled={loading}
              >
                {loading ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Signing in...
                  </div>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>

            {/* Super Admin Link */}
            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600">
                Are you a super admin?{' '}
                <button
                  onClick={() => router.push('/super-admin/login')}
                  className="text-blue-600 hover:text-blue-500 font-medium"
                >
                  Sign in here
                </button>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
