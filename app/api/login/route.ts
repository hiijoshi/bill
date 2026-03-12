import { NextRequest, NextResponse } from 'next/server'

// Legacy alias. Keep for compatibility but route through secured auth endpoint.
export async function POST(request: NextRequest) {
  return NextResponse.redirect(new URL('/api/auth', request.url), { status: 307 })
}
