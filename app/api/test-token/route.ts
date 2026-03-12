import { NextRequest, NextResponse } from 'next/server'
import { generateToken, verifyToken } from '@/lib/auth'
import { requireRoles } from '@/lib/api-security'
import { env } from '@/lib/config'

export async function GET(request: NextRequest) {
  if (env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const testPayload = {
      userId: 'test',
      traderId: 'test',
      name: 'Test User',
      role: 'admin'
    }

    const token = generateToken(testPayload)
    const verified = verifyToken(token)

    return NextResponse.json({
      success: true,
      verified: !!verified
    })
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
