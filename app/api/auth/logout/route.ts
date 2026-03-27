import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { clearSession } from '@/lib/session'
import { env } from '@/lib/config'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { createSupabaseRouteClient } from '@/lib/supabase/route'

export async function POST(request: NextRequest) {
  try {
    const scopeSource = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
    let response = NextResponse.json(
      { success: true, message: 'Logged out successfully' },
      { status: 200 }
    )

    if (isSupabaseConfigured()) {
      const routeClient = createSupabaseRouteClient(request)
      if (routeClient) {
        await routeClient.supabase.auth.signOut()
        response = routeClient.applyCookies(response)
      }
    }

    await clearSession(response, 'app', scopeSource)

    response.cookies.set('userId', '', {
      httpOnly: false,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      expires: new Date(0)
    })
    response.cookies.set('traderId', '', {
      httpOnly: false,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      expires: new Date(0)
    })
    response.cookies.set('companyId', '', {
      httpOnly: false,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      expires: new Date(0)
    })

    return response
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Logout error:', error)
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
