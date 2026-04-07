import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

// Load .env files when running outside of Next.js (e.g. direct Node/tsx execution).
// Next.js already handles loading environment variables for the application so
// this is primarily for CLI/utility use.
if (typeof window === 'undefined' && typeof process !== 'undefined') {
  try {
    loadDotenv({ quiet: true })
  } catch {
    // ignore when dotenv isn't available (e.g., production) or import fails
  }
}

function normalizeFlag(value: string | undefined | null): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on'
}

function normalizeString(value: string | undefined | null): string {
  return String(value || '').trim()
}

function shouldUseTursoRuntime(input: {
  DATABASE_URL?: string
  TURSO_DATABASE_URL?: string
  USE_TURSO?: string
  NODE_ENV?: 'development' | 'production' | 'test'
}): boolean {
  const databaseUrl = normalizeString(input.DATABASE_URL)
  const tursoUrl = normalizeString(input.TURSO_DATABASE_URL)
  const useTurso = normalizeFlag(input.USE_TURSO)
  const isProduction = input.NODE_ENV === 'production'

  if (databaseUrl.startsWith('libsql:') || databaseUrl.startsWith('http://') || databaseUrl.startsWith('https://')) {
    return true
  }

  if (!tursoUrl) {
    return false
  }

  return useTurso || isProduction || !databaseUrl
}

function hasAnySupabaseConfig(input: {
  NEXT_PUBLIC_SUPABASE_URL?: string
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}): boolean {
  return Boolean(
    normalizeString(input.NEXT_PUBLIC_SUPABASE_URL) ||
      normalizeString(input.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
      normalizeString(input.SUPABASE_SERVICE_ROLE_KEY)
  )
}

// Define the schema for required environment variables. This will throw immediately if any
// of the values are missing or invalid, which helps catch configuration errors early.
const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  TURSO_DATABASE_URL: z.string().optional(),
  TURSO_AUTH_TOKEN: z.string().optional(),
  USE_TURSO: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32, { message: 'JWT_SECRET must be at least 32 characters' }),
  REFRESH_SECRET: z.string().min(32).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ALLOWED_ORIGINS: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  MFA_ENABLED: z.string().optional(),
  MFA_ISSUER: z.string().optional(),
  CAPTCHA_ENABLED: z.string().optional(),
  CAPTCHA_PROVIDER: z.string().optional(),
  CAPTCHA_SITE_KEY: z.string().optional(),
  CAPTCHA_SECRET_KEY: z.string().optional(),
  SUPER_ADMIN_SECOND_SECRET: z.string().optional(),
  SUPER_ADMIN_ACCESS_EXPIRES_IN: z.string().optional(),
  SUPER_ADMIN_REFRESH_EXPIRES_IN: z.string().optional(),
  AUDIT_LOGGING_ENABLED: z.string().optional(),
  LOG_SERVICE_URL: z.string().optional(),
  LOG_SERVICE_TOKEN: z.string().optional(),
  SUPER_ADMIN_REMOTE_ACCESS: z.string().optional(),
  REDIS_URL: z.string().optional()
}).superRefine((value, ctx) => {
  const databaseUrl = normalizeString(value.DATABASE_URL)
  const tursoUrl = normalizeString(value.TURSO_DATABASE_URL)
  const tursoAuthToken = normalizeString(value.TURSO_AUTH_TOKEN)
  const usesTursoRuntime = shouldUseTursoRuntime({
    DATABASE_URL: value.DATABASE_URL,
    TURSO_DATABASE_URL: value.TURSO_DATABASE_URL,
    USE_TURSO: value.USE_TURSO,
    NODE_ENV: value.NODE_ENV
  })
  const hasSupabaseConfig = hasAnySupabaseConfig(value)
  const allowedOrigins = normalizeString(value.ALLOWED_ORIGINS)

  if (!databaseUrl && !tursoUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL or TURSO_DATABASE_URL is required'
    })
  }

  if (usesTursoRuntime && !tursoAuthToken) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['TURSO_AUTH_TOKEN'],
      message: 'TURSO_AUTH_TOKEN is required when the runtime database uses Turso/libSQL'
    })
  }

  if (value.NODE_ENV === 'production' && !allowedOrigins) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ALLOWED_ORIGINS'],
      message: 'ALLOWED_ORIGINS is required in production'
    })
  }

  if (hasSupabaseConfig) {
    if (!normalizeString(value.NEXT_PUBLIC_SUPABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEXT_PUBLIC_SUPABASE_URL'],
        message: 'NEXT_PUBLIC_SUPABASE_URL is required when Supabase auth is enabled'
      })
    }

    if (!normalizeString(value.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'],
        message: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required when Supabase auth is enabled'
      })
    }

    if (!normalizeString(value.SUPABASE_SERVICE_ROLE_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SUPABASE_SERVICE_ROLE_KEY'],
        message: 'SUPABASE_SERVICE_ROLE_KEY is required when Supabase auth is enabled'
      })
    }
  }
})

// Parse the current process.env according to the schema. An error will be thrown if the
// schema validation fails, preventing the application from starting with bad config.
export const env = envSchema.parse(process.env)

// Helper to compute derived values or defaults if needed
export const ALLOWED_ORIGIN =
  env.ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:3000'

export const isProduction = env.NODE_ENV === 'production'
export const usesTursoRuntime = shouldUseTursoRuntime(env)
