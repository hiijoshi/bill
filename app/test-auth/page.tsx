'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function AuthTestPage() {
  const [authStatus, setAuthStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me')
      const data = await response.json()
      setAuthStatus({
        status: response.status,
        data: data,
        success: response.ok
      })
    } catch (error) {
      setAuthStatus({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false
      })
    } finally {
      setLoading(false)
    }
  }

  const testLogin = async () => {
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          traderId: 'KR', 
          userId: 'admin', 
          password: '1234' 
        }),
      })
      
      const data = await response.json()
      
      if (response.ok) {
        alert('Login successful! Try checking auth again.')
        checkAuth() // Re-check auth status
      } else {
        alert('Login failed: ' + (data.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Login test error:', error)
      alert('Login test error: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Authentication Test Page</h1>
      
      <div className="bg-gray-100 p-4 rounded mb-4">
        <h2 className="font-semibold mb-2">Current Auth Status:</h2>
        <pre className="text-sm overflow-auto">
          {JSON.stringify(authStatus, null, 2)}
        </pre>
      </div>

      <div className="space-x-4">
        <Button onClick={checkAuth}>Check Auth Status</Button>
        <Button onClick={testLogin} variant="outline">Test Login</Button>
        <Button 
          onClick={() => window.location.href = '/login'} 
          variant="secondary"
        >
          Go to Login Page
        </Button>
      </div>

      <div className="mt-4 text-sm text-gray-600">
        <p>1. Click "Test Login" to authenticate</p>
        <p>2. Click "Check Auth Status" to verify session</p>
        <p>3. If successful, try accessing the units page</p>
      </div>
    </div>
  )
}
