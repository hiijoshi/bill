'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'

function StockDashboardRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const query = searchParams.toString()
    router.replace(query ? `/stock/adjustment?${query}` : '/stock/adjustment')
  }, [router, searchParams])

  return (
    <AppLoaderShell
      kind="stock"
      title="Opening stock dashboard"
      message="Routing you into the live stock adjustment workspace."
    />
  )
}

export default function StockDashboardPage() {
  return (
    <Suspense fallback={<AppLoaderShell kind="stock" fullscreen />}>
      <StockDashboardRedirect />
    </Suspense>
  )
}
