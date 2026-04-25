import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSessionCookieNameCandidates } from '@/lib/session-cookies'

function normalizeScopeSource(value: string | null | undefined) {
  return String(value || '').trim() || null
}

function resolveCsrfTokenFromCookies(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  scopeSource: string | null
) {
  const scopedCandidates =
    getSessionCookieNameCandidates('app', scopeSource)
      .map((cookieNames) => cookieStore.get(cookieNames.csrfToken)?.value)
      .find((value): value is string => Boolean(value)) || ''

  if (scopedCandidates) {
    return scopedCandidates
  }

  // Fallback for environments where host normalization can drift between
  // requests (for example, proxy or localhost alias differences).
  const prefixed = cookieStore
    .getAll()
    .find((cookie) => cookie.name === 'csrf-token' || cookie.name.startsWith('csrf-token__'))

  return prefixed?.value || ''
}

export async function GET() {
  const cookieStore = await cookies()
  const headerStore = await headers()
  const scopeSource = normalizeScopeSource(
    headerStore.get('x-forwarded-host') || headerStore.get('host')
  )

  const csrfToken = resolveCsrfTokenFromCookies(cookieStore, scopeSource)

  if (!csrfToken) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'CSRF_INVALID',
          message: 'Request security token is not available. Refresh the session and try again.',
          retryable: true
        }
      },
      { status: 400 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: {
      csrfToken,
      namespace: 'app',
      refreshedAt: new Date().toISOString()
    }
  })
}
