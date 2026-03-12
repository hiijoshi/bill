import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json(
    { error: 'Endpoint disabled. Use /api/super-admin/traders instead.' },
    { status: 410 }
  )
}

export async function POST() {
  return NextResponse.json(
    { error: 'Endpoint disabled. Use /api/super-admin/traders instead.' },
    { status: 410 }
  )
}

export async function PUT() {
  return NextResponse.json(
    { error: 'Endpoint disabled. Use /api/super-admin/traders instead.' },
    { status: 410 }
  )
}

export async function DELETE() {
  return NextResponse.json(
    { error: 'Endpoint disabled. Use /api/super-admin/traders instead.' },
    { status: 410 }
  )
}
