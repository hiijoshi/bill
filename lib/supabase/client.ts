import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/config'
import { getSupabaseBrowserConfig } from './shared'

export function isSupabaseConfigured(): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
}

export function createSupabaseBrowserClient() {
  const config = getSupabaseBrowserConfig()
  if (!config) {
    throw new Error('Supabase client is not configured')
  }

  return createBrowserClient(config.url, config.publishableKey)
}
