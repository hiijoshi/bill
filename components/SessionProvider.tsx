'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

interface SessionContextType {
  isSessionExpired: boolean
  showSessionWarning: boolean
  timeRemaining: number | null
  logout: () => void
}

const SessionContext = createContext<SessionContextType | undefined>(undefined)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [isSessionExpired, setIsSessionExpired] = useState(false)
  const [showSessionWarning, setShowSessionWarning] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const [hasActiveSession, setHasActiveSession] = useState(false)

  const logout = async () => {
    setHasActiveSession(false)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // ignore errors; proceed to redirect regardless
    }
    const target = pathname?.startsWith('/super-admin') ? '/super-admin/login' : '/login'
    window.location.href = target
  }

  const pathname = usePathname()

  useEffect(() => {
    let warningTimer: NodeJS.Timeout
    let expiryTimer: NodeJS.Timeout

    const clearTimers = () => {
      clearTimeout(warningTimer)
      clearTimeout(expiryTimer)
    }

    const startTimers = () => {
      // Set timers for session management once we know the session is valid
      const warningTime = 11 * 60 * 60 * 1000 + 30 * 60 * 1000 // 11h 30m
      const expiryTime = 12 * 60 * 60 * 1000 // 12 hours

      warningTimer = setTimeout(() => {
        setShowSessionWarning(true)
        setTimeRemaining(30 * 60) // 30 minutes remaining
      }, warningTime)

      expiryTimer = setTimeout(() => {
        setIsSessionExpired(true)
      }, expiryTime)
    }

    const checkSession = async () => {
      try {
        const response = await fetch('/api/auth/me')
        if (response.status === 401) {
          // only mark expired if we previously had a valid session
          if (hasActiveSession) {
            setIsSessionExpired(true)
          }
          return
        }

        // session is active
        setHasActiveSession(true)
        setIsSessionExpired(false)
        setShowSessionWarning(false)
        clearTimers()
        startTimers()
      } catch {
        if (hasActiveSession) {
          setIsSessionExpired(true)
        }
      }
    }

    // skip session check on public routes (login, super-admin login)
    if (pathname === '/login' || pathname.startsWith('/super-admin/login')) {
      // reset state when navigating to login
      setIsSessionExpired(false)
      setShowSessionWarning(false)
      setHasActiveSession(false)
      return
    }

    checkSession()

    return () => {
      clearTimers()
    }
  }, [pathname])

  // listen for token refresh events (dispatched by global fetch interceptor)
  useEffect(() => {
    const handler = () => {
      if (hasActiveSession) {
        setIsSessionExpired(false)
        setShowSessionWarning(false)
      }
    }
    window.addEventListener('sessionRefreshed', handler)
    return () => window.removeEventListener('sessionRefreshed', handler)
  }, [hasActiveSession])

  return (
    <SessionContext.Provider
      value={{
        isSessionExpired,
        showSessionWarning,
        timeRemaining,
        logout
      }}
    >
      {children}
      
      {/* Session Warning Modal */}
      {showSessionWarning && !isSessionExpired && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold text-yellow-600 mb-2">
              Session Expiring Soon
            </h3>
            <p className="text-gray-600 mb-4">
              Your session will expire in {Math.floor((timeRemaining || 0) / 60)} minutes. 
              Your work will be saved automatically.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSessionWarning(false)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
              >
                Continue Working
              </button>
              <button
                onClick={logout}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Login Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session Expired Modal */}
      {isSessionExpired && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold text-red-600 mb-2">
              Session Expired
            </h3>
            <p className="text-gray-600 mb-4">
              Your session has expired. Please login again to continue.
            </p>
            <button
              onClick={logout}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Login
            </button>
          </div>
        </div>
      )}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const context = useContext(SessionContext)
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}
