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

// Define the schema for required environment variables. This will throw immediately if any
// of the values are missing or invalid, which helps catch configuration errors early.
const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32, { message: 'JWT_SECRET must be at least 32 characters' }),
  REFRESH_SECRET: z.string().min(32).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ALLOWED_ORIGINS: z.string().optional(),
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
  REDIS_URL: z.string().optional(),
  AUTH_BRUTE_FORCE_ENABLED: z.string().optional(),
  AUTH_LOGIN_RATE_LIMIT_ENABLED: z.string().optional(),
  AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: z.string().optional(),
  AUTH_LOGIN_RATE_LIMIT_MAX_REQUESTS: z.string().optional(),
  AUTH_ACCOUNT_LOCKOUT_ENABLED: z.string().optional(),
  AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS: z.string().optional(),
  AUTH_REFRESH_RATE_LIMIT_ENABLED: z.string().optional(),
  AUTH_REFRESH_RATE_LIMIT_WINDOW_MS: z.string().optional(),
  AUTH_REFRESH_RATE_LIMIT_MAX_REQUESTS: z.string().optional()
}).superRefine((value, ctx) => {
  const databaseUrl = normalizeString(value.DATABASE_URL)
  const allowedOrigins = normalizeString(value.ALLOWED_ORIGINS)

  if (!databaseUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL is required'
    })
  }

  if (value.NODE_ENV === 'production' && !allowedOrigins) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ALLOWED_ORIGINS'],
      message: 'ALLOWED_ORIGINS is required in production'
    })
  }
})

// Parse the current process.env according to the schema. An error will be thrown if the
// schema validation fails, preventing the application from starting with bad config.
export const env = envSchema.parse(process.env)

// Helper to compute derived values or defaults if needed
export const ALLOWED_ORIGIN =
  env.ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:3000'

export const isProduction = env.NODE_ENV === 'production'
export const usesTursoRuntime = false
export const isSupabaseRuntimeEnabled = false

export function isCloudDatabaseUrl(url: string | undefined | null): boolean {
  const normalized = normalizeString(url).toLowerCase()
  return normalized.startsWith('libsql:') || normalized.startsWith('http://') || normalized.startsWith('https://')
}

export function isMfaEnabled(): boolean {
  return normalizeFlag(env.MFA_ENABLED)
}
