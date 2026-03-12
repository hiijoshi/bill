'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SalesEditRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const billId = params.get('billId') || ''
    const companyId = params.get('companyId') || ''

    if (!billId) {
      router.replace('/sales/list')
      return
    }

    const next = new URLSearchParams()
    next.set('billId', billId)
    if (companyId) {
      next.set('companyId', companyId)
    }

    router.replace(`/sales/entry?${next.toString()}`)
  }, [router])

  return <div className="p-6 text-sm text-gray-500">Redirecting to sales entry...</div>
}
