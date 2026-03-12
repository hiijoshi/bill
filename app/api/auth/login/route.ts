import { NextRequest, NextResponse } from 'next/server'

// Redirect to the main auth route
export async function POST(request: NextRequest) {
  return NextResponse.redirect(new URL('/api/auth', request.url), {
    status: 307
  })
}
