import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { env } from '@/lib/config'
import { isSupabaseConfigured } from '@/lib/supabase/client'

type PendingCookie = {
  name: string
  value: string
  options?: Record<string, unknown>
}

export function createSupabaseRouteClient(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return null
  }

  const pendingCookies: PendingCookie[] = []

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            pendingCookies.push({ name, value, options })
          })
        }
      }
    }
  )

  const applyCookies = <T>(response: NextResponse<T>) => {
    pendingCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options)
    })
    return response
  }

  return {
    supabase,
    applyCookies
  }
}
