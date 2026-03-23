import { createClient } from '@supabase/supabase-js'

import { getSupabaseServiceRoleKey, getSupabaseBrowserConfig } from './shared'

export function createSupabaseAdminClient() {
  const config = getSupabaseBrowserConfig()
  const serviceRoleKey = getSupabaseServiceRoleKey()

  if (!config || !serviceRoleKey) {
    throw new Error('Supabase admin client is not configured')
  }

  // Do NOT cache the admin client as a singleton — on Vercel serverless
  // each invocation should get a fresh client to avoid stale auth state.
  return createClient(config.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}
