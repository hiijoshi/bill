import { NextResponse } from 'next/server'
import { clearSession } from '@/lib/session'
import { env } from '@/lib/config'

export async function POST() {
  try {
    const response = NextResponse.json({ success: true })
    await clearSession(response)

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
    console.error('Super admin logout error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
