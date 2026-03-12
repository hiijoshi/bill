'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

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
    router.replace(query ? `/stock/dashboard?${query}` : '/stock/dashboard')
  }, [router])

  return <div className="p-6 text-sm text-gray-500">Redirecting to stock preview...</div>
}
