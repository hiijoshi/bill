'use client'

import { createContext, useCallback, useContext, useMemo } from 'react'
import { usePathname } from 'next/navigation'

interface SessionContextType {
  isSessionExpired: boolean
  showSessionWarning: boolean
  timeRemaining: number | null
  logout: () => void
}

const SessionContext = createContext<SessionContextType | undefined>(undefined)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isSuperAdminRoute = pathname?.startsWith('/super-admin') === true

  const logout = useCallback(async () => {
    try {
      await fetch(isSuperAdminRoute ? '/api/super-admin/logout' : '/api/auth/logout', { method: 'POST' })
    } catch {
      // ignore errors; proceed to redirect regardless
    }
    const target = isSuperAdminRoute ? '/super-admin/login' : '/login'
    window.location.href = target
  }, [isSuperAdminRoute])

  const contextValue = useMemo<SessionContextType>(
    () => ({
      isSessionExpired: false,
      showSessionWarning: false,
      timeRemaining: null,
      logout
    }),
    [logout]
  )

  return (
    <SessionContext.Provider value={contextValue}>
      {children}
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
