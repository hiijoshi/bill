import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { getSupabaseBrowserConfig } from '@/lib/supabase/shared'

type PendingCookie = {
  name: string
  value: string
  options?: Record<string, unknown>
}

export function createSupabaseRouteClient(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return null
  }

  const config = getSupabaseBrowserConfig()
  if (!config) return null

  const pendingCookies: PendingCookie[] = []

  const supabase = createServerClient(
    config.url,
    config.publishableKey,
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
