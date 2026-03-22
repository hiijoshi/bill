function requireEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY' | 'SUPABASE_SERVICE_ROLE_KEY') {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required for Supabase integration`)
  }
  return value
}

export function getSupabaseBrowserConfig() {
  return {
    url: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    publishableKey: requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  }
}

export function getSupabaseServiceRoleKey() {
  return requireEnv('SUPABASE_SERVICE_ROLE_KEY')
}
