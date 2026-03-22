import { NextResponse } from 'next/server'
import { clearSession } from '@/lib/session'

export async function POST() {
  try {
    const response = NextResponse.json({ success: true })
    await clearSession(response, 'super_admin')

    return response
  } catch (error) {
    console.error('Super admin logout error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
