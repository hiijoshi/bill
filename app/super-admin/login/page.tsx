'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import { LoaderMark } from '@/components/loaders/task-loader'
import { Shield, User, Lock, AlertCircle, Loader2, KeyRound } from 'lucide-react'
import { clearClientCache } from '@/lib/client-fetch-cache'

type LoginPhase = 'idle' | 'authenticating' | 'redirecting'
type SuperAdminLoginStage = 'password_login' | 'setup_2fa' | 'verify_2fa' | 'otp_login'

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
  const [stage, setStage] = useState<SuperAdminLoginStage>('password_login')
  const [error, setError] = useState('')
  const [setupMessage, setSetupMessage] = useState('')
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [otpToken, setOtpToken] = useState('')
  const [qrCode, setQrCode] = useState('')
  const [otpauthUrl, setOtpauthUrl] = useState('')
  const hasInitializedFromQuery = useRef(false)
  const searchParamsKey = searchParams.toString()
  const loading = phase !== 'idle'
  const loadingMessage = useMemo(() => {
    if (phase === 'redirecting') return 'Opening the control panel...'
    if (stage === 'setup_2fa' || stage === 'verify_2fa') return 'Verifying authenticator code...'
    if (stage === 'otp_login') return 'Verifying OTP and signing in...'
    return 'Checking super admin credentials...'
  }, [phase, stage])

  useEffect(() => {
    clearClientCache()
  }, [])

  useEffect(() => {
    const currentParams = new URLSearchParams(searchParamsKey)
    const queryUserId = currentParams.get('userId')?.trim() || ''
    const restriction = currentParams.get('restricted')

    if (currentParams.has('password')) {
      currentParams.delete('password')
      const nextUrl = currentParams.toString() ? `/super-admin/login?${currentParams.toString()}` : '/super-admin/login'
      router.replace(nextUrl)
      return
    }

    if (!hasInitializedFromQuery.current) {
      hasInitializedFromQuery.current = true
      if (queryUserId) {
        setUserId(queryUserId)
      }
      if (restriction === 'remote-disabled') {
        setError('Remote super admin access is disabled. Enable SUPER_ADMIN_REMOTE_ACCESS=true in production.')
      }
    }
  }, [router, searchParamsKey])

  const loginWithOtp = async (token: string) => {
    const response = await fetch('/api/super-admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', userId, password, token })
    })

    const payload = await response.json().catch(() => ({} as Record<string, unknown>))
    if (!response.ok || payload.success !== true) {
      throw new Error(String(payload.error || 'Login failed'))
    }

    setPhase('redirecting')
    await waitForNextPaint()
    if (typeof window !== 'undefined') {
      window.location.replace('/super-admin/crud')
    } else {
      router.replace('/super-admin/crud')
    }
  }

  const setupTwoFactor = async () => {
    const setupResponse = await fetch('/api/super-admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setup_2fa', userId, password })
    })

    const setupPayload = await setupResponse.json().catch(() => ({} as Record<string, unknown>))
    if (!setupResponse.ok || setupPayload.success !== true) {
      throw new Error(String(setupPayload.error || 'Failed to setup 2FA'))
    }

    setQrCode(String(setupPayload.qrCode || ''))
    setOtpauthUrl(String(setupPayload.otpauthUrl || ''))
    setStage('setup_2fa')
    setSetupMessage('Scan the QR in Google Authenticator, then enter 6-digit code.')
  }

  const handleCredentialsSubmit = async () => {
    const response = await fetch('/api/super-admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', userId, password })
    })

    const payload = await response.json().catch(() => ({} as Record<string, unknown>))

    if (payload.success === true && response.ok) {
      setPhase('redirecting')
      await waitForNextPaint()
      if (typeof window !== 'undefined') {
        window.location.replace('/super-admin/crud')
      } else {
        router.replace('/super-admin/crud')
      }
      return
    }

    if (payload.requiresTwoFactorSetup === true || response.status === 428) {
      await setupTwoFactor()
      return
    }

    if (payload.requiresTwoFactor === true) {
      setStage('otp_login')
      setSetupMessage('Enter 6-digit code from Google Authenticator.')
      return
    }

    throw new Error(String(payload.error || 'Login failed'))
  }

  const handleSetupVerification = async () => {
    const verifyResponse = await fetch('/api/super-admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify_2fa', userId, token: otpToken })
    })

    const verifyPayload = await verifyResponse.json().catch(() => ({} as Record<string, unknown>))
    if (!verifyResponse.ok || verifyPayload.success !== true) {
      throw new Error(String(verifyPayload.error || 'Failed to verify authenticator code'))
    }

    setSetupMessage('2FA enabled. Signing you in...')
    await loginWithOtp(otpToken)
  }

  const handleOtpLogin = async () => {
    await loginWithOtp(otpToken)
  }

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

      if (stage === 'password_login') {
        await handleCredentialsSubmit()
        return
      }

      if (!/^\d{6}$/.test(otpToken.trim())) {
        setError('Enter valid 6-digit OTP code')
        return
      }

      if (stage === 'setup_2fa') {
        setStage('verify_2fa')
        await handleSetupVerification()
        didStartNavigation = true
        return
      }

      await handleOtpLogin()
      didStartNavigation = true
    } catch (err) {
      if (stage === 'verify_2fa') {
        setStage('setup_2fa')
      }
      setError(err instanceof Error ? err.message : 'Login failed')
      setPhase('idle')
    } finally {
      if (!didStartNavigation) {
        setPhase('idle')
      }
    }
  }

  const stageTitle =
    stage === 'setup_2fa' || stage === 'verify_2fa'
      ? 'Set Up Google Authenticator'
      : stage === 'otp_login'
        ? 'Enter 6-digit OTP'
        : 'Sign in'

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
            <CardTitle className="text-center">{stageTitle}</CardTitle>
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
                    disabled={loading || stage !== 'password_login'}
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
                    disabled={loading || stage !== 'password_login'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
              </div>

              {stage === 'setup_2fa' && qrCode ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
                  <div className="flex justify-center">
                    <Image src={qrCode} alt="2FA QR" width={220} height={220} unoptimized />
                  </div>
                  <p className="mt-3 text-xs text-slate-600 break-all">{otpauthUrl}</p>
                </div>
              ) : null}

              {(stage === 'setup_2fa' || stage === 'verify_2fa' || stage === 'otp_login') ? (
                <div>
                  <Label htmlFor="otpToken">Google Authenticator Code</Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      id="otpToken"
                      name="otpToken"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      className="pl-10 tracking-[0.35em]"
                      placeholder="123456"
                      disabled={loading}
                      value={otpToken}
                      onChange={(event) => setOtpToken(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    />
                  </div>
                </div>
              ) : null}

              {setupMessage ? (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
                  {setupMessage}
                </div>
              ) : null}

              {error && (
                <div className="flex items-center space-x-2 p-3 bg-red-50 border border-red-200 rounded-md">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <LoaderMark compact /> : stage === 'password_login' ? 'Continue' : 'Verify & Sign in'}
              </Button>

              {(stage === 'setup_2fa' || stage === 'verify_2fa' || stage === 'otp_login') ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={loading}
                  onClick={() => {
                    setStage('password_login')
                    setOtpToken('')
                    setError('')
                    setSetupMessage('')
                  }}
                >
                  Back to credentials
                </Button>
              ) : null}
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
                <p className="text-sm font-semibold text-slate-900">Securing your session</p>
                <p className="text-sm text-slate-600">{loadingMessage}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
