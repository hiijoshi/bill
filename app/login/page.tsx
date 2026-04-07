'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import { LoaderMark } from '@/components/loaders/task-loader'
import { Building2, User, Lock, AlertCircle, Loader2 } from 'lucide-react'
import { clearClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { resolveFirstAccessibleAppRoute } from '@/lib/app-default-route'
import { loadClientPermissions, primeClientPermissions } from '@/lib/client-permissions'

type LoginPhase = 'idle' | 'authenticating' | 'preparing' | 'redirecting'

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window === 'undefined') {
      resolve()
      return
    }

    window.requestAnimationFrame(() => resolve())
  })
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AppLoaderShell kind="access" fullscreen />}>
      <LoginPageContent />
    </Suspense>
  )
}

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [phase, setPhase] = useState<LoginPhase>('idle')
  const [error, setError] = useState('')
  const [traderId, setTraderId] = useState('')
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const loading = phase !== 'idle'
  const loadingMessage = useMemo(() => {
    if (phase === 'authenticating') {
      return 'Checking your credentials...'
    }

    if (phase === 'preparing') {
      return 'Preparing your company access and dashboard...'
    }

    if (phase === 'redirecting') {
      return 'Opening your workspace...'
    }

    return ''
  }, [phase])

  useEffect(() => {
    clearClientCache()
  }, [])

  useEffect(() => {
    router.prefetch('/main/dashboard')
    router.prefetch('/main/profile')
  }, [router])

  useEffect(() => {
    const queryTraderId = searchParams.get('traderId')?.trim() || ''
    const queryUserId = searchParams.get('userId')?.trim() || ''
    const hasPasswordParam = searchParams.has('password')

    if (queryUserId.toLowerCase() === 'superadmin') {
      const nextParams = new URLSearchParams()
      nextParams.set('userId', queryUserId)
      router.replace(`/super-admin/login?${nextParams.toString()}`)
      return
    }

    if (hasPasswordParam) {
      const safeParams = new URLSearchParams()
      if (queryTraderId) safeParams.set('traderId', queryTraderId)
      if (queryUserId) safeParams.set('userId', queryUserId)
      const nextUrl = safeParams.toString() ? `/login?${safeParams.toString()}` : '/login'
      router.replace(nextUrl)
    }

    setTraderId(queryTraderId)
    setUserId(queryUserId)
    setPassword('')
  }, [router, searchParams])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setPhase('authenticating')
  
    let didStartNavigation = false

    try {
      clearClientCache()

      // Validate trader ID is not empty
      if (!traderId || traderId.trim() === '') {
        setError('Trader ID is required')
        return
      }

      // Call login API
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
       
        body: JSON.stringify({ traderId, userId, password }),
      })

      const contentType = response.headers.get('content-type')

      if (!response.ok) {
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json()
          throw new Error(`Login failed: ${errorData.error || 'Unknown error'}`)
        } else {
          await response.text()
          throw new Error(`Login failed: Server returned HTML error page (Status: ${response.status})`)
        }
      }

      // Parse successful response
      if (!contentType || !contentType.includes('application/json')) {
        await response.text()
        throw new Error('Login failed: Invalid response format from server')
      }

      const loginPayload = (await response.json()) as {
        user?: {
          userId?: string | null
          name?: string | null
          role?: string | null
        } | null
        company?: {
          id?: string | null
          name?: string | null
        } | null
        bootstrap?: {
          companyId?: string | null
          defaultRoute?: string | null
          permissions?: Array<{ module?: string | null; canRead?: boolean | null; canWrite?: boolean | null }>
          grantedReadModules?: number
          grantedWriteModules?: number
          companies?: Array<{ id?: string | null; name?: string | null; locked?: boolean | null }>
        } | null
      }
      const companyId = String(
        loginPayload.bootstrap?.companyId ||
        loginPayload.company?.id ||
        ''
      ).trim()
      const normalizedPermissions = Array.isArray(loginPayload.bootstrap?.permissions)
        ? loginPayload.bootstrap.permissions
        : []
      const normalizedCompanies = Array.isArray(loginPayload.bootstrap?.companies)
        ? loginPayload.bootstrap.companies
            .map((company) => ({
              id: String(company?.id || '').trim(),
              name: String(company?.name || company?.id || '').trim() || String(company?.id || '').trim(),
              locked: Boolean(company?.locked)
            }))
            .filter((company) => company.id.length > 0)
        : []
      const fallbackCompanyId = companyId || normalizedCompanies.find((company) => !company.locked)?.id || ''
      setPhase('preparing')

      setClientCache(
        'shell:auth-me',
        {
          user: {
            userId: loginPayload.user?.userId || null,
            name: loginPayload.user?.name || null,
            role: loginPayload.user?.role || null,
            companyId: fallbackCompanyId || null
          },
          company: fallbackCompanyId
            ? {
                id: fallbackCompanyId,
                name: String(loginPayload.company?.name || fallbackCompanyId).trim() || fallbackCompanyId
              }
            : null
        },
        { persist: true }
      )

      if (normalizedCompanies.length > 0) {
        setClientCache('shell:companies', normalizedCompanies, { persist: true })
      }

      if (fallbackCompanyId) {
        setClientCache('shell:active-company-id', fallbackCompanyId, { persist: true })
        primeClientPermissions({
          companyId: fallbackCompanyId,
          permissions: normalizedPermissions,
          grantedReadModules: loginPayload.bootstrap?.grantedReadModules,
          grantedWriteModules: loginPayload.bootstrap?.grantedWriteModules
        })
      }

      if (!fallbackCompanyId) {
        didStartNavigation = true
        setPhase('redirecting')
        router.prefetch('/main/profile')
        await waitForNextPaint()
        router.replace('/main/profile')
        return
      }

      if (!companyId) {
        const selectCompanyResponse = await fetch('/api/auth/company', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ companyId: fallbackCompanyId, force: true }),
        })

        if (!selectCompanyResponse.ok) {
          const selectCompanyPayload = await selectCompanyResponse.json().catch(() => ({}))
          throw new Error(selectCompanyPayload.error || 'Failed to activate company')
        }
      }

      const resolvedPermissions =
        companyId === fallbackCompanyId
          ? normalizedPermissions
          : (await loadClientPermissions(fallbackCompanyId, { force: true })).permissions

      const nextRoute = String(
        (companyId === fallbackCompanyId ? loginPayload.bootstrap?.defaultRoute : '') ||
        resolveFirstAccessibleAppRoute(resolvedPermissions, fallbackCompanyId)
      ).trim() || '/main/dashboard'
      didStartNavigation = true
      setPhase('redirecting')
      router.prefetch(nextRoute)
      await waitForNextPaint()
      router.replace(nextRoute)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Login failed. Please try again.')
      setPhase('idle')
    } finally {
      if (!didStartNavigation) {
        setPhase('idle')
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Building2 className="mx-auto h-12 w-12 text-blue-600" />
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Enter your credentials to access the billing system
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-center">Login</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Trader ID Input */}
              <div>
                <Label htmlFor="traderId">Trader ID</Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="traderId"
                    name="traderId"
                    type="text"
                    autoComplete="organization"
                    required
                    className="pl-10"
                    placeholder="Enter your trader ID"
                    disabled={loading}
                    value={traderId}
                    onChange={(event) => setTraderId(event.target.value)}
                  />
                </div>
              </div>

              {/* User ID */}
              <div>
                <Label htmlFor="userId">User ID</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="userId"
                    name="userId"
                    type="text"
                    autoComplete="username"
                    required
                    className="pl-10"
                    placeholder="Enter your user ID"
                    disabled={loading}
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="pl-10"
                    placeholder="Enter your password"
                    disabled={loading}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="flex items-center space-x-2 p-3 bg-red-50 border border-red-200 rounded-md">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full"
                disabled={loading}
              >
                {loading ? (
                  <LoaderMark compact />
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>

            {/* Super Admin Link */}
            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600">
                Are you a super admin?{' '}
                <button
                  onClick={() => router.push('/super-admin/login')}
                  className="text-blue-600 hover:text-blue-500 font-medium"
                >
                  Sign in here
                </button>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      {loading ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/88 backdrop-blur-sm">
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-xl">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">Signing you in</p>
                <p className="text-sm text-slate-600">{loadingMessage}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
