// Load .env files when running outside of Next.js (e.g. direct Node/tsx execution).
// Next.js already handles loading environment variables for the application so
// this is primarily for CLI/utility use.
if (typeof window === 'undefined' && typeof process !== 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-empty-function
    require('dotenv').config()
  } catch {
    // ignore when dotenv isn't available (e.g., production) or import fails
  }
}

import { z } from 'zod'

// Define the schema for required environment variables. This will throw immediately if any
// of the values are missing or invalid, which helps catch configuration errors early.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, { message: 'DATABASE_URL is required' }),
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
  AUDIT_LOGGING_ENABLED: z.string().optional(),
  LOG_SERVICE_URL: z.string().optional(),
  LOG_SERVICE_TOKEN: z.string().optional()
})

// Parse the current process.env according to the schema. An error will be thrown if the
// schema validation fails, preventing the application from starting with bad config.
export const env = envSchema.parse(process.env)

// Helper to compute derived values or defaults if needed
export const ALLOWED_ORIGIN =
  env.ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:3000'

export const isProduction = env.NODE_ENV === 'production'
