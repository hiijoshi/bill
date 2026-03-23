import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { clearSession } from '@/lib/session'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { createSupabaseRouteClient } from '@/lib/supabase/route'

export async function POST(request: NextRequest) {
  try {
    const scopeSource = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
    let response = NextResponse.json({ success: true })

    if (isSupabaseConfigured()) {
      const routeClient = createSupabaseRouteClient(request)
      if (routeClient) {
        await routeClient.supabase.auth.signOut()
        response = routeClient.applyCookies(response)
      }
    }

    await clearSession(response, 'super_admin', scopeSource)

    return response
  } catch (error) {
    console.error('Super admin logout error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
