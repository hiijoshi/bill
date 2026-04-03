import { NextRequest, NextResponse } from 'next/server'

import { requireRoles } from '@/lib/api-security'
import { loadAuthGuardState } from '@/lib/auth-guard-state'
import { getSuperAdminLiveUpdate } from '@/lib/live-update-state'

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  const authGuard = await loadAuthGuardState(authResult.auth)

  return NextResponse.json({
    superAdminUpdatedAt: getSuperAdminLiveUpdate(),
    sessionUpdatedAt: authGuard.userUpdatedAtMs || 0,
    serverNow: Date.now()
  })
}
