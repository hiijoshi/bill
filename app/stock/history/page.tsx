'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'

export default function StockHistoryRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    const paramsFromUrl = new URLSearchParams(window.location.search)
    const companyId = paramsFromUrl.get('companyId') || ''
    const productId = paramsFromUrl.get('productId') || ''
    const params = new URLSearchParams()
    if (companyId) params.set('companyId', companyId)
    if (productId) params.set('productId', productId)
    const query = params.toString()
    router.replace(query ? `/stock/adjustment?${query}` : '/stock/adjustment')
  }, [router])

  return (
    <AppLoaderShell
      kind="stock"
      title="Opening stock history"
      message="Routing you into the stock adjustment view with the selected company and product."
    />
  )
}
