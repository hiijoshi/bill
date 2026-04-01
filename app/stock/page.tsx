'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'

function StockRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const query = searchParams.toString()
    router.replace(query ? `/stock/adjustment?${query}` : '/stock/adjustment')
  }, [router, searchParams])

  return (
    <AppLoaderShell
      kind="stock"
      title="Opening stock workspace"
      message="Routing you into stock adjustment with the right company scope."
    />
  )
}

export default function StockPage() {
  return (
    <Suspense fallback={<AppLoaderShell kind="stock" fullscreen />}>
      <StockRedirect />
    </Suspense>
  )
}
