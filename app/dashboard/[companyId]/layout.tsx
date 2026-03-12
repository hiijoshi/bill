'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/mandi/Sidebar'
import { validateTenantAccess } from '@/lib/tenancy'

export default function MandiDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ companyId: string }>
}) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [companyId, setCompanyId] = useState<string>('')

  useEffect(() => {
    // Resolve params and validate access
    const resolveParams = async () => {
      try {
        const resolvedParams = await params
        setCompanyId(resolvedParams.companyId)
        
        // Validate tenant access and load user context
        const response = await fetch('/api/auth/me')
        
        if (response.ok) {
          const data = await response.json()
          const user = data.user
          
          // Validate tenant access
          if (!validateTenantAccess(user.companyId, resolvedParams.companyId)) {
            router.push('/unauthorized')
            return
          }
          
          setCurrentUser(user)
        } else {
          router.push('/login')
        }
      } catch (error) {
        router.push('/login')
      } finally {
        setIsLoading(false)
      }
    }

    resolveParams()
  }, [params, router])

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar companyId={companyId} userRole={currentUser?.role} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}
