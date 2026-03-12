'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default function LogoutButton() {
  const [currentUser, setCurrentUser] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    // Check for current logged in user from session
    const checkSession = async () => {
      try {
        const response = await fetch('/api/auth/me')
        if (response.ok) {
          const data = await response.json()
          setCurrentUser(data.user?.userId || null)
        }
      } catch (error) {
        // Session check failed, assume not logged in
        setCurrentUser(null)
      }
    }
    
    checkSession()
  }, [])

  const handleLogout = async () => {
    try {
      // Call server-side logout endpoint to clear HttpOnly cookies
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (error) {
      // Even if server logout fails, clear client-side cookies and redirect
    }
    
    // Clear any remaining client-side cookies as fallback
    const cookiesToClear = [
      'auth-token',
      'refresh-token', 
      'userId',
      'traderId',
      'companyId'
    ]
    
    cookiesToClear.forEach(cookieName => {
      document.cookie = `${cookieName}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict; Secure`
    })
    
    setCurrentUser(null)
    router.push('/login')
  }

  if (!currentUser) {
    return null
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleLogout}
      className="fixed top-4 right-4 z-50"
    >
      🚪 Logout
    </Button>
  )
}
