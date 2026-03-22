import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/config'

export function isSupabaseConfigured(): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
}

export function createSupabaseBrowserClient() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase client is not configured')
  }

  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}
