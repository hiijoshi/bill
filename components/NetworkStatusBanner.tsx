'use client'

import { useEffect, useState } from 'react'

export default function NetworkStatusBanner() {
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    const syncStatus = () => {
      setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
    }

    syncStatus()
    window.addEventListener('online', syncStatus)
    window.addEventListener('offline', syncStatus)

    return () => {
      window.removeEventListener('online', syncStatus)
      window.removeEventListener('offline', syncStatus)
    }
  }, [])

  if (isOnline) return null

  return (
    <div className="fixed inset-x-0 top-0 z-[100] border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-900 shadow-sm">
      Offline mode detected. Cloud data cannot sync until your internet connection returns.
    </div>
  )
}
