'use client'

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AtSign,
  BadgeCheck,
  Briefcase,
  Building2,
  Camera,
  CheckCircle2,
  Clock3,
  Globe,
  KeyRound,
  Mail,
  Phone,
  Shield,
  User,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { isAbortError } from '@/lib/http'
import { cn } from '@/lib/utils'

export type SelfProfileUser = {
  id: string
  userId: string
  name: string | null
  role: string | null
  traderId: string
  traderName: string | null
  companyId: string | null
  companyName: string | null
  createdAt: string
  updatedAt: string
}

type ToastState = {
  tone: 'success' | 'error' | 'info'
  title: string
  message?: string
}

type ProfileSettingsProps = {
  profileEndpoint: string
  initialUser?: SelfProfileUser | null
  pageTitle?: string
  breadcrumbRoot?: string
  description?: string
}

const sharedInputClassName =
  'h-12 rounded-2xl border-slate-200 bg-slate-50/80 px-4 text-[15px] text-slate-900 shadow-none focus-visible:border-slate-300 focus-visible:ring-slate-900/10'

function splitName(fullName: string | null) {
  const trimmed = (fullName || '').trim()
  if (!trimmed) {
    return { firstName: '', lastName: '' }
  }

  const [firstName, ...rest] = trimmed.split(/\s+/)
  return {
    firstName,
    lastName: rest.join(' ')
  }
}

function combineName(firstName: string, lastName: string) {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(' ').trim()
}

function formatRole(role: string | null) {
  if (!role) return 'Team Member'
  return role
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function deriveEmail(userId: string) {
  return userId.includes('@') ? userId : ''
}

function initialsFromProfile(fullName: string | null, userId: string) {
  const source = (fullName || userId || 'U').trim()
  const pieces = source.split(/\s+/).filter(Boolean)
  if (pieces.length === 0) return 'U'
  if (pieces.length === 1) return pieces[0].slice(0, 2).toUpperCase()
  return `${pieces[0][0] || ''}${pieces[1][0] || ''}`.toUpperCase()
}

function formatDateTime(isoValue?: string | null) {
  if (!isoValue) return 'Recently'
  const parsed = new Date(isoValue)
  if (Number.isNaN(parsed.getTime())) return 'Recently'

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(parsed)
}

function deriveDepartment(user: SelfProfileUser | null) {
  if (!user) return 'Not assigned'
  if ((user.role || '').toLowerCase() === 'super_admin') return 'Platform Administration'
  if (user.companyName) return `${user.companyName} Operations`
  if (user.traderName) return `${user.traderName} Leadership`
  return 'Business Operations'
}

function deriveJobTitle(user: SelfProfileUser | null) {
  if (!user) return 'Account Owner'
  const normalizedRole = (user.role || '').toLowerCase()
  if (normalizedRole === 'super_admin') return 'System Administrator'
  if (normalizedRole === 'company_admin') return 'Company Administrator'
  if (normalizedRole === 'trader_admin') return 'Trader Administrator'
  if (normalizedRole === 'company_user') return 'Company Operations User'
  return formatRole(user.role)
}

function ProfileField({
  label,
  value,
  placeholder,
  icon: Icon,
  onChange,
  type = 'text',
  readOnly = false,
  autoComplete,
}: {
  label: string
  value: string
  placeholder?: string
  icon?: typeof User
  onChange?: (value: string) => void
  type?: string
  readOnly?: boolean
  autoComplete?: string
}) {
  return (
    <div className="space-y-2.5">
      <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </Label>
      <div className="relative">
        {Icon ? <Icon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /> : null}
        <Input
          type={type}
          value={value}
          readOnly={readOnly}
          autoComplete={autoComplete}
          placeholder={placeholder}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          className={cn(
            sharedInputClassName,
            Icon && 'pl-11',
            readOnly && 'border-dashed border-slate-200 bg-slate-100/80 text-slate-600 focus-visible:ring-0'
          )}
        />
      </div>
    </div>
  )
}

export default function ProfileSettings({
  profileEndpoint,
  initialUser = null,
  pageTitle = 'Profile Settings',
  breadcrumbRoot = 'Dashboard',
  description = 'Manage your business identity, workspace details, and password security from one professional settings page.',
}: ProfileSettingsProps) {
  const initialNameParts = splitName(initialUser?.name || null)
  const [user, setUser] = useState<SelfProfileUser | null>(initialUser)
  const [isLoading, setIsLoading] = useState(!initialUser)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [browserTimeZone, setBrowserTimeZone] = useState('UTC')
  const [firstName, setFirstName] = useState(initialNameParts.firstName)
  const [lastName, setLastName] = useState(initialNameParts.lastName)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const avatarObjectUrlRef = useRef<string | null>(null)

  const showToast = useCallback((tone: ToastState['tone'], title: string, message?: string) => {
    setToast({ tone, title, message })
  }, [])

  const hydrateForm = useCallback((nextUser: SelfProfileUser) => {
    const nameParts = splitName(nextUser.name)
    setFirstName(nameParts.firstName)
    setLastName(nameParts.lastName)
  }, [])

  useEffect(() => {
    if (!initialUser) return
    setUser(initialUser)
    hydrateForm(initialUser)
    setIsLoading(false)
    setError(null)
  }, [hydrateForm, initialUser])

  const loadProfile = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(profileEndpoint, {
        cache: 'no-store',
        signal
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to load your profile right now.')
      }

      const nextUser = payload?.user as SelfProfileUser | undefined
      if (!nextUser) {
        throw new Error('Profile data was not returned by the server.')
      }

      setUser(nextUser)
      hydrateForm(nextUser)
    } catch (loadError) {
      if (isAbortError(loadError)) return
      setError(loadError instanceof Error ? loadError.message : 'Unable to load your profile right now.')
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false)
      }
    }
  }, [hydrateForm, profileEndpoint])

  useEffect(() => {
    if (initialUser) {
      return
    }
    const controller = new AbortController()
    void loadProfile(controller.signal)
    return () => controller.abort()
  }, [initialUser, loadProfile])

  useEffect(() => {
    try {
      const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (resolvedTimeZone) {
        setBrowserTimeZone(resolvedTimeZone)
      }
    } catch {
      setBrowserTimeZone('UTC')
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    return () => {
      if (avatarObjectUrlRef.current) {
        URL.revokeObjectURL(avatarObjectUrlRef.current)
      }
    }
  }, [])

  const fullNameDraft = combineName(firstName, lastName)
  const savedName = (user?.name || '').trim()
  const hasProfileChanges = Boolean(user) && fullNameDraft !== savedName
  const hasPasswordChanges = Boolean(currentPassword || newPassword || confirmPassword)
  const unsavedCount = Number(hasProfileChanges) + Number(hasPasswordChanges)
  const email = user ? deriveEmail(user.userId) : ''
  const roleLabel = formatRole(user?.role || null)
  const department = deriveDepartment(user)
  const jobTitle = deriveJobTitle(user)
  const profileCompletion = useMemo(() => {
    if (!user) return 0
    const checkpoints = [
      Boolean(user.name?.trim()),
      Boolean(user.userId?.trim()),
      Boolean(user.role?.trim()),
      Boolean(user.traderName?.trim()),
      Boolean(user.companyName?.trim() || (user.role || '').toLowerCase() === 'super_admin'),
      Boolean(browserTimeZone.trim()),
    ]
    const completed = checkpoints.filter(Boolean).length
    return Math.round((completed / checkpoints.length) * 100)
  }, [browserTimeZone, user])

  const workspaceLabel = user?.companyName
    ? `${user.companyName} workspace`
    : (user?.role || '').toLowerCase() === 'super_admin'
      ? 'Platform-wide access'
      : user?.traderName
        ? `${user.traderName} multi-company access`
        : 'Workspace access not assigned'

  const handlePhotoSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (avatarObjectUrlRef.current) {
      URL.revokeObjectURL(avatarObjectUrlRef.current)
    }

    const objectUrl = URL.createObjectURL(file)
    avatarObjectUrlRef.current = objectUrl
    setAvatarPreview(objectUrl)
    showToast('info', 'Local photo preview updated', 'Photo storage is not connected yet, so this preview stays on this device only.')
    event.target.value = ''
  }

  const handleSaveProfile = async () => {
    if (!user) return
    if (!hasProfileChanges) {
      showToast('info', 'No profile changes to save', 'Update your first name or last name before saving.')
      return
    }

    setIsSavingProfile(true)
    try {
      const response = await fetch(profileEndpoint, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: fullNameDraft || null
        })
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Profile update failed.')
      }

      const nextUser = payload?.user as SelfProfileUser | undefined
      if (!nextUser) {
        throw new Error('Updated profile data was not returned by the server.')
      }

      setUser(nextUser)
      hydrateForm(nextUser)
      showToast('success', 'Profile saved', 'Your account name has been updated successfully.')
    } catch (saveError) {
      showToast(
        'error',
        'Profile update failed',
        saveError instanceof Error ? saveError.message : 'Please try again.'
      )
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleUpdatePassword = async () => {
    if (!user) return
    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast('error', 'Password update incomplete', 'Enter current, new, and confirm password fields.')
      return
    }

    if (newPassword.length < 6) {
      showToast('error', 'Password too short', 'Use at least 6 characters for the new password.')
      return
    }

    if (newPassword !== confirmPassword) {
      showToast('error', 'Passwords do not match', 'New password and confirm password must match exactly.')
      return
    }

    setIsSavingPassword(true)
    try {
      const response = await fetch(profileEndpoint, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Password update failed.')
      }

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      showToast('success', 'Password updated', 'Your new password is now active for future logins.')
    } catch (passwordError) {
      showToast(
        'error',
        'Password update failed',
        passwordError instanceof Error ? passwordError.message : 'Please try again.'
      )
    } finally {
      setIsSavingPassword(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="h-4 w-40 rounded bg-slate-200" />
          <div className="mt-4 h-8 w-72 rounded bg-slate-200" />
          <div className="mt-3 h-4 w-full max-w-2xl rounded bg-slate-100" />
        </div>
        <div className="animate-pulse rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-5">
              <div className="h-24 w-24 rounded-full bg-slate-200" />
              <div className="space-y-3">
                <div className="h-7 w-48 rounded bg-slate-200" />
                <div className="h-4 w-56 rounded bg-slate-100" />
                <div className="h-4 w-40 rounded bg-slate-100" />
              </div>
            </div>
            <div className="h-24 w-full max-w-sm rounded-3xl bg-slate-100" />
          </div>
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="h-[360px] animate-pulse rounded-[28px] border border-slate-200 bg-white shadow-sm" />
          <div className="h-[360px] animate-pulse rounded-[28px] border border-slate-200 bg-white shadow-sm" />
        </div>
        <div className="h-[320px] animate-pulse rounded-[28px] border border-slate-200 bg-white shadow-sm" />
      </div>
    )
  }

  if (error || !user) {
    return (
      <Card className="rounded-[28px] border-slate-200 bg-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.28)]">
        <CardHeader>
          <CardTitle className="text-2xl text-slate-950">We couldn&apos;t load your profile</CardTitle>
          <CardDescription className="text-base text-slate-600">
            {error || 'Please refresh the page and try again.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void loadProfile()} className="rounded-xl px-5">
            Try Again
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {toast ? (
        <div className="pointer-events-none fixed right-6 top-6 z-50 w-full max-w-sm">
          <div
            className={cn(
              'pointer-events-auto rounded-2xl border bg-white p-4 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.35)] backdrop-blur',
              toast.tone === 'success' && 'border-emerald-200',
              toast.tone === 'error' && 'border-rose-200',
              toast.tone === 'info' && 'border-slate-200'
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  'mt-0.5 flex h-9 w-9 items-center justify-center rounded-full',
                  toast.tone === 'success' && 'bg-emerald-50 text-emerald-600',
                  toast.tone === 'error' && 'bg-rose-50 text-rose-600',
                  toast.tone === 'info' && 'bg-slate-100 text-slate-700'
                )}
              >
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
                {toast.message ? <p className="mt-1 text-sm text-slate-600">{toast.message}</p> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-5">
        <section className="rounded-[24px] border border-slate-200/80 bg-white px-5 py-5 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.22)] md:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <span>{breadcrumbRoot}</span>
                <span className="text-slate-300">/</span>
                <span className="font-medium text-slate-800">Profile</span>
              </div>
              <h1 className="mt-2.5 text-[2rem] font-semibold tracking-tight text-slate-950 md:text-[2.3rem]">
                {pageTitle}
              </h1>
              <p className="mt-2.5 max-w-3xl text-sm leading-6 text-slate-600 md:text-[15px]">
                {description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Badge className="rounded-full bg-slate-950 px-3 py-1 text-[11px] font-medium text-white shadow-sm">
                <Shield className="h-3.5 w-3.5" />
                Active account
              </Badge>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-sm text-slate-600">
                <Clock3 className="h-4 w-4 text-slate-400" />
                Last updated {formatDateTime(user.updatedAt)}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_22px_70px_-40px_rgba(15,23,42,0.32)] md:p-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-5 md:flex-row md:items-center">
              <div className="relative">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_rgba(15,23,42,0.95))] text-xl font-semibold text-white shadow-lg shadow-slate-900/10 ring-4 ring-slate-100 md:h-24 md:w-24">
                  {avatarPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarPreview} alt="Profile preview" className="h-full w-full object-cover" />
                  ) : (
                    initialsFromProfile(user.name, user.userId)
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="absolute bottom-0.5 right-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white bg-white text-slate-700 shadow-md transition hover:bg-slate-50"
                  aria-label="Change profile photo"
                >
                  <Camera className="h-3.5 w-3.5" />
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoSelection}
                />
              </div>

              <div className="space-y-2.5">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-slate-950 md:text-[1.7rem]">
                    {fullNameDraft || user.userId}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {email || `Username-based sign-in: ${user.userId}`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-700">
                    <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" />
                    {roleLabel}
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-600">
                    <Building2 className="h-3.5 w-3.5 text-slate-500" />
                    {workspaceLabel}
                  </Badge>
                  {unsavedCount > 0 ? (
                    <Badge className="rounded-full bg-amber-100 px-3 py-1 text-[11px] text-amber-800">
                      {unsavedCount} unsaved change{unsavedCount > 1 ? 's' : ''}
                    </Badge>
                  ) : (
                    <Badge className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] text-emerald-800">
                      All changes saved
                    </Badge>
                  )}
                  <Badge variant="outline" className="rounded-full border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-600">
                    User ID: {user.userId}
                  </Badge>
                  {user.companyName ? (
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-600">
                      Company: {user.companyName}
                    </Badge>
                  ) : null}
                </div>

                <p className="text-sm leading-6 text-slate-500">
                  Name and password save directly to your database-backed account. Role, trader, and company details are shown as trusted workspace metadata.
                </p>
              </div>
            </div>

            <div className="grid gap-3.5 xl:min-w-[320px] xl:max-w-[360px]">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-[18px]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Profile completion</p>
                    <p className="mt-1 text-sm text-slate-500">Based on identity, role, scope, and workspace metadata.</p>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{profileCompletion}%</span>
                </div>
                <Progress value={profileCompletion} className="mt-4 h-2.5 rounded-full bg-slate-200 [&_[data-slot='progress-indicator']]:bg-slate-900" />
                <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
                  <span>Security posture</span>
                  <span className="font-medium text-slate-800">Healthy</span>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={() => avatarInputRef.current?.click()}
                  className="h-10 flex-1 rounded-xl border-slate-200 bg-white px-4 text-sm text-slate-800"
                >
                  <Camera className="h-4 w-4" />
                  Change Photo
                </Button>
                <Button
                  type="button"
                  size="default"
                  onClick={handleSaveProfile}
                  disabled={!hasProfileChanges || isSavingProfile}
                  className="h-10 flex-1 rounded-xl bg-slate-950 px-4 text-sm text-white hover:bg-slate-900"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {isSavingProfile ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>

              {avatarPreview ? (
                <p className="text-xs leading-5 text-slate-500">
                  Avatar preview is local for now. When file storage is connected later, this same control can be upgraded without changing the page layout.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="rounded-[28px] border-slate-200 bg-white shadow-[0_18px_50px_-34px_rgba(15,23,42,0.28)]">
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="flex items-center gap-3 text-xl text-slate-950">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <User className="h-5 w-5" />
                </span>
                Personal Information
              </CardTitle>
              <CardDescription className="text-sm text-slate-600">
                Keep your display identity clear and professional across the dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pt-6">
              <div className="grid gap-5 md:grid-cols-2">
                <ProfileField
                  label="First Name"
                  value={firstName}
                  onChange={setFirstName}
                  placeholder="Enter first name"
                  icon={User}
                  autoComplete="given-name"
                />
                <ProfileField
                  label="Last Name"
                  value={lastName}
                  onChange={setLastName}
                  placeholder="Enter last name"
                  icon={User}
                  autoComplete="family-name"
                />
                <ProfileField
                  label="Email"
                  value={email}
                  placeholder="Email not configured"
                  icon={Mail}
                  readOnly
                  autoComplete="email"
                />
                <ProfileField
                  label="Phone Number"
                  value=""
                  placeholder="Phone number is not configured"
                  icon={Phone}
                  readOnly
                  autoComplete="tel"
                />
                <ProfileField
                  label="Job Title"
                  value={jobTitle}
                  icon={Briefcase}
                  readOnly
                />
                <ProfileField
                  label="Department"
                  value={department}
                  icon={Users}
                  readOnly
                />
              </div>
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-500">
                Editable today: first name and last name. Contact an administrator if your email, phone, or structured role metadata needs to be changed centrally.
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-slate-200 bg-white shadow-[0_18px_50px_-34px_rgba(15,23,42,0.28)]">
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="flex items-center gap-3 text-xl text-slate-950">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <Building2 className="h-5 w-5" />
                </span>
                Account Details
              </CardTitle>
              <CardDescription className="text-sm text-slate-600">
                Workspace scope and login details that define how this account appears in the system.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pt-6">
              <div className="grid gap-5 md:grid-cols-2">
                <ProfileField
                  label="User ID"
                  value={user.userId}
                  icon={AtSign}
                  readOnly
                />
                <ProfileField
                  label="Role"
                  value={roleLabel}
                  icon={Shield}
                  readOnly
                />
                <ProfileField
                  label="Trader"
                  value={user.traderName || user.traderId || 'Not assigned'}
                  icon={Users}
                  readOnly
                />
                <ProfileField
                  label="Company"
                  value={user.companyName || 'All companies access'}
                  icon={Building2}
                  readOnly
                />
                <ProfileField
                  label="Time Zone"
                  value={browserTimeZone}
                  icon={Globe}
                  readOnly
                />
                <ProfileField
                  label="Member Since"
                  value={formatDateTime(user.createdAt)}
                  icon={Clock3}
                  readOnly
                />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                    <BadgeCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Trusted account scope</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      This account currently operates with <span className="font-medium text-slate-900">{workspaceLabel}</span>. Scope changes are applied through admin controls, not from this page.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-[28px] border-slate-200 bg-white shadow-[0_18px_60px_-36px_rgba(15,23,42,0.32)]">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-3 text-xl text-slate-950">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                <KeyRound className="h-5 w-5" />
              </span>
              Change Password
            </CardTitle>
            <CardDescription className="text-sm text-slate-600">
              Keep this account secure with a strong password that is stored and verified from the database.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <div className="grid gap-5 lg:grid-cols-3">
              <ProfileField
                label="Current Password"
                type="password"
                value={currentPassword}
                onChange={setCurrentPassword}
                placeholder="Enter current password"
                icon={Shield}
                autoComplete="current-password"
              />
              <ProfileField
                label="New Password"
                type="password"
                value={newPassword}
                onChange={setNewPassword}
                placeholder="Enter new password"
                icon={KeyRound}
                autoComplete="new-password"
              />
              <ProfileField
                label="Confirm New Password"
                type="password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="Repeat new password"
                icon={KeyRound}
                autoComplete="new-password"
              />
            </div>

            <div className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-900">Password rules</p>
                <p className="text-sm leading-6 text-slate-600">
                  Use at least 6 characters, avoid reusing the current password, and prefer a unique mix of letters, numbers, and symbols.
                </p>
              </div>
              <Button
                type="button"
                size="lg"
                onClick={handleUpdatePassword}
                disabled={isSavingPassword || !hasPasswordChanges}
                className="h-12 rounded-2xl bg-slate-950 px-5 text-white hover:bg-slate-900"
              >
                {isSavingPassword ? 'Updating...' : 'Update Password'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
