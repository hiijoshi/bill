import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAccessibleCompanies, requireAuthContext } from '@/lib/api-security'
import { loadAuthGuardState } from '@/lib/auth-guard-state'
import { getCompanyLiveUpdates, getUserSessionLiveUpdate, markCompanyLiveUpdate } from '@/lib/live-update-state'

const postBodySchema = z
  .object({
    companyId: z.string().trim().min(1, 'Company ID is required')
  })
  .strict()

function parseRequestedCompanyIds(value: string | null, fallbackCompanyId?: string | null): string[] {
  const ids = (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry, index, items) => entry.length > 0 && items.indexOf(entry) === index)

  if (ids.length > 0) {
    return ids
  }

  const normalizedFallbackCompanyId = String(fallbackCompanyId || '').trim()
  return normalizedFallbackCompanyId ? [normalizedFallbackCompanyId] : []
}

export async function GET(request: NextRequest) {
  const authResult = requireAuthContext(request)
  if (!authResult.ok) return authResult.response

  const requestedCompanyIds = parseRequestedCompanyIds(
    new URL(request.url).searchParams.get('companyIds'),
    authResult.auth.companyId
  )
  const authGuard = await loadAuthGuardState(authResult.auth)
  const activeCompanyId = String(authResult.auth.companyId || '').trim()
  const accessibleCompanyIds =
    requestedCompanyIds.length === 1 && activeCompanyId && requestedCompanyIds[0] === activeCompanyId
      ? [activeCompanyId]
      : requestedCompanyIds.length === 1
        ? (await getAccessibleCompanies(authResult.auth, requestedCompanyIds[0])).map((company) => company.id)
        : requestedCompanyIds.length > 1
          ? (
              await getAccessibleCompanies(authResult.auth)
            )
              .map((company) => company.id)
              .filter((companyId) => requestedCompanyIds.includes(companyId))
          : activeCompanyId
            ? [activeCompanyId]
            : []

  return NextResponse.json({
    allowedCompanyIds: accessibleCompanyIds,
    companyUpdates: getCompanyLiveUpdates(accessibleCompanyIds),
    sessionUpdatedAt: Math.max(
      authGuard.userUpdatedAtMs || 0,
      getUserSessionLiveUpdate(authResult.auth)
    ),
    serverNow: Date.now()
  })
}

export async function POST(request: NextRequest) {
  const authResult = requireAuthContext(request)
  if (!authResult.ok) return authResult.response

  const parsedBody = postBodySchema.safeParse(await request.json().catch(() => null))
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsedBody.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
      },
      { status: 400 }
    )
  }

  const accessibleCompany = (
    await getAccessibleCompanies(authResult.auth, parsedBody.data.companyId)
  )[0]

  if (!accessibleCompany) {
    return NextResponse.json({ error: 'Company access denied' }, { status: 403 })
  }

  const updatedAt = markCompanyLiveUpdate(accessibleCompany.id)

  return NextResponse.json({
    success: true,
    companyId: accessibleCompany.id,
    updatedAt
  })
}
