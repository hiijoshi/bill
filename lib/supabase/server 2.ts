import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

import { getSupabaseBrowserConfig } from './shared'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  const config = getSupabaseBrowserConfig()

  if (!config) {
    throw new Error('Supabase is not configured')
  }

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Server Components cannot always mutate cookies; middleware/route handlers should own writes.
        }
      }
    }
  })
}
