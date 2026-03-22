'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'

type AuthStatus = {
  status: number | string
  data?: unknown
  success: boolean
  error?: string
}

export default function AuthTestPage() {
  const router = useRouter()
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
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
        <Button 
          onClick={() => router.push('/login')} 
          variant="secondary"
        >
          Go to Login Page
        </Button>
      </div>

      <div className="mt-4 text-sm text-gray-600">
        <p>1. Use the normal login screen for authentication</p>
        <p>2. Click &quot;Check Auth Status&quot; to verify the current session</p>
      </div>
    </div>
  )
}
