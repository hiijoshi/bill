'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function StockRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const query = searchParams.toString()
    router.replace(query ? `/stock/dashboard?${query}` : '/stock/dashboard')
  }, [router, searchParams])

  return <div className="flex h-64 items-center justify-center text-lg">Redirecting to stock dashboard...</div>
}

export default function StockPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-lg">Loading stock dashboard...</div>}>
      <StockRedirect />
    </Suspense>
  )
}
