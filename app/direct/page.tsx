'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DirectPage() {
  const router = useRouter()

  useEffect(() => {
    // Disabled direct-access shortcut; force normal authentication flow.
    router.replace('/login')
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Redirecting to Login...</h1>
        <p className="text-gray-600">Please wait.</p>
      </div>
    </div>
  )
}
