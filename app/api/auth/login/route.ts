import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { traderId, userId, password } = await request.json()

    if (!traderId || !userId || !password) {
      return NextResponse.json(
        { error: 'Trader ID, User ID and password are required' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Login route is working'
    })
  } catch {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 500 }
    )
  }
}