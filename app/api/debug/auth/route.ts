import { NextRequest, NextResponse } from 'next/server'
import { requireRoles } from '@/lib/api-security'
import { env } from '@/lib/config'

export async function GET(request: NextRequest) {
  if (env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    return NextResponse.json({
      success: true,
      hasAuthToken: !!request.cookies.get('auth-token')?.value,
      hasRefreshToken: !!request.cookies.get('refresh-token')?.value,
      cookieNames: request.cookies.getAll().map((c) => c.name)
    })
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
