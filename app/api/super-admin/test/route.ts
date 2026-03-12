import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/config'
import { getSession } from '@/lib/session'

export async function GET(request: NextRequest) {
  try {
    if (env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const session = await getSession()
    if (!session || session.role?.toLowerCase().replace(/\s+/g, '_') !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json({ message: 'Super admin test endpoint active (development only).' })
  } catch (error) {
    void error
    return NextResponse.json({ 
      error: 'Test failed'
    }, { status: 500 })
  }
}
