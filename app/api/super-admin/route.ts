import { NextResponse } from 'next/server'

// Legacy multipurpose super-admin endpoint is disabled.
// Use explicit endpoints under /api/super-admin/* with session-based auth.
export async function GET() {
  return NextResponse.json(
    { error: 'Endpoint disabled. Use /api/super-admin/{resource} routes.' },
    { status: 410 }
  )
}

export async function POST() {
  return NextResponse.json(
    { error: 'Endpoint disabled. Use /api/super-admin/{resource} routes.' },
    { status: 410 }
  )
}

export async function PUT() {
  return NextResponse.json(
    { error: 'Endpoint disabled. Use /api/super-admin/{resource} routes.' },
    { status: 410 }
  )
}

export async function DELETE() {
  return NextResponse.json(
    { error: 'Endpoint disabled. Use /api/super-admin/{resource} routes.' },
    { status: 410 }
  )
}
