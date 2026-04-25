import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAccessibleCompanies, requireAuthContext, validateCompanyAccess } from '@/lib/api-security'
import { loadAuthGuardState } from '@/lib/auth-guard-state'
import { sanitizeCompanyId } from '@/lib/company-id'
import { getCompanyLiveUpdates, getUserSessionLiveUpdate, markCompanyLiveUpdate } from '@/lib/live-update-state'

const postBodySchema = z
  .object({
    companyId: z.string().trim().min(1, 'Company ID is required')
  })
  .strict()

function parseRequestedCompanyIds(value: string | null, fallbackCompanyId?: string | null): string[] {
  const ids = (value || '')
    .split(',')
    .map((entry) => sanitizeCompanyId(entry))
    .filter((entry, index, items) => entry.length > 0 && items.indexOf(entry) === index)

  if (ids.length > 0) {
    return ids
  }

  const normalizedFallbackCompanyId = sanitizeCompanyId(fallbackCompanyId)
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
  const activeCompanyId = sanitizeCompanyId(authResult.auth.companyId)
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

  const companyValidation = await validateCompanyAccess(request, parsedBody.data.companyId)
  if (!companyValidation.ok) return companyValidation.response

  const updatedAt = markCompanyLiveUpdate(companyValidation.companyId)

  return NextResponse.json({
    success: true,
    companyId: companyValidation.companyId,
    updatedAt
  })
}
