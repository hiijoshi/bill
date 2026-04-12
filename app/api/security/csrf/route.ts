import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSessionCookieNameCandidates } from '@/lib/session-cookies'

function normalizeScopeSource(value: string | null | undefined) {
  return String(value || '').trim() || null
}

export async function GET() {
  const cookieStore = await cookies()
  const headerStore = await headers()
  const scopeSource = normalizeScopeSource(
    headerStore.get('x-forwarded-host') || headerStore.get('host')
  )

  const csrfToken =
    getSessionCookieNameCandidates('app', scopeSource)
      .map((cookieNames) => cookieStore.get(cookieNames.csrfToken)?.value)
      .find((value): value is string => Boolean(value)) || ''

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
      { status: 401 }
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
