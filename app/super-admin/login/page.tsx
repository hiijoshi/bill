'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import { LoaderMark } from '@/components/loaders/task-loader'
import { Shield, User, Lock, AlertCircle, Loader2 } from 'lucide-react'
import { clearClientCache } from '@/lib/client-fetch-cache'

type LoginPhase = 'idle' | 'authenticating' | 'redirecting'

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window === 'undefined') {
      resolve()
      return
    }

    window.requestAnimationFrame(() => resolve())
  })
}

export default function SuperAdminLogin() {
  return (
    <Suspense fallback={<AppLoaderShell kind="access" fullscreen />}>
      <SuperAdminLoginContent />
    </Suspense>
  )
}

function SuperAdminLoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [phase, setPhase] = useState<LoginPhase>('idle')
  const [error, setError] = useState('')
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [secondSecret, setSecondSecret] = useState('')
  const loading = phase !== 'idle'
  const loadingMessage = useMemo(
    () => (phase === 'redirecting' ? 'Opening the control panel...' : 'Checking super admin credentials...'),
    [phase]
  )

  useEffect(() => {
    clearClientCache()
  }, [])

  useEffect(() => {
    const queryUserId = searchParams.get('userId')?.trim() || ''
    const hasPasswordParam = searchParams.has('password')
    const restriction = searchParams.get('restricted')

    if (hasPasswordParam) {
      const safeParams = new URLSearchParams()
      if (queryUserId) safeParams.set('userId', queryUserId)
      const nextUrl = safeParams.toString() ? `/super-admin/login?${safeParams.toString()}` : '/super-admin/login'
      router.replace(nextUrl)
    }

    setUserId(queryUserId)
    setPassword('')
    setSecondSecret('')
    if (restriction === 'remote-disabled') {
      setError('Remote super admin access is disabled. Enable SUPER_ADMIN_REMOTE_ACCESS=true in production.')
    }
  }, [router, searchParams])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setPhase('authenticating')
    let didStartNavigation = false
    
    try {
      clearClientCache()

      if (!userId || !password) {
        setError('User ID and password are required')
        return
      }

      const response = await fetch('/api/super-admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        
        body: JSON.stringify({ userId, password, secondSecret })
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || 'Login failed')
      }

      didStartNavigation = true
      setPhase('redirecting')
      await waitForNextPaint()
      if (typeof window !== 'undefined') {
        window.location.replace('/super-admin/crud')
      } else {
        router.replace('/super-admin/crud')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setPhase('idle')
    } finally {
      if (!didStartNavigation) {
        setPhase('idle')
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Shield className="mx-auto h-12 w-12 text-gray-800" />
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            Super Admin Login
          </h2>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-center">Sign in</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
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
                    placeholder="Enter super admin user ID"
                    disabled={loading}
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                  />
                </div>
              </div>

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
                    placeholder="Enter password"
                    disabled={loading}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="secondSecret">Second Secret</Label>
                <div className="relative">
                  <Shield className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="secondSecret"
                    name="secondSecret"
                    type="password"
                    className="pl-10"
                    placeholder="Optional extra secret"
                    disabled={loading}
                    value={secondSecret}
                    onChange={(event) => setSecondSecret(event.target.value)}
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center space-x-2 p-3 bg-red-50 border border-red-200 rounded-md">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <LoaderMark compact />
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      {loading ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/88 backdrop-blur-sm">
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-xl">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-slate-800" />
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
