import type { NextRequest, NextResponse } from 'next/server'

export type DisabledRouteClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  applyCookies: <T>(response: NextResponse<T>) => NextResponse<T>
}

export function createSupabaseRouteClient(request: NextRequest): DisabledRouteClient | null {
  void request
  return null
}
