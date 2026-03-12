import { NextResponse } from 'next/server'
import { clearSession } from '@/lib/session'
import { env } from '@/lib/config'

export async function POST() {
  try {
    // Build response first so we can clear cookies on it
    const response = NextResponse.json(
      { success: true, message: 'Logged out successfully' },
      { status: 200 }
    )

    // Use helper to remove all session cookies
    await clearSession(response)

    // also explicitly clear any non-http cookies in case helper does not
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
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
