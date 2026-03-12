import { cookies } from 'next/headers'
import { verifyToken } from './auth'
import { env } from './config'
import { randomBytes } from 'crypto'

export async function getSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get('auth-token')?.value
  
  if (!token) return null
  
  try {
    const payload = verifyToken(token)
    return payload
  } catch {
    return null
  }
}

export async function setSession(
  token: string,
  refreshToken?: string,
  res?: import('next/server').NextResponse
) {
  // allow an explicit response object or fall back to the implicit cookie store
  const store = res ? res.cookies : await cookies()
  
  // Set access token
  store.set('auth-token', token, {
    httpOnly: true, // Prevent XSS attacks
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 12 * 60 * 60, // 12 hours
    priority: 'high'
  })
  
  // Set refresh token if provided
  if (refreshToken) {
    store.set('refresh-token', refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      priority: 'high'
    })
  }

  // Double-submit CSRF token cookie for mutating cookie-auth API calls.
  store.set('csrf-token', randomBytes(24).toString('hex'), {
    httpOnly: false,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
    priority: 'high'
  })
}

export async function clearSession(res?: import('next/server').NextResponse) {
  const store = res ? res.cookies : await cookies()
  
  // Clear all authentication-related cookies
  store.delete('auth-token')
  store.delete('refresh-token')
  store.delete('userId')
  store.delete('traderId')
  store.delete('companyId')
  store.delete('csrf-token')
}
