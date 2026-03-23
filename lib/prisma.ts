import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function resolveRuntimeDatabaseUrl(): string | undefined {
  const databaseUrl = process.env.DATABASE_URL
  const directUrl = process.env.DIRECT_URL
  const preferDirectUrl = String(process.env.PRISMA_USE_DIRECT_URL || '')
    .trim()
    .toLowerCase()

  // Default to the primary DATABASE_URL for stability. Some environments can
  // reach the pooled connection but not the direct host reliably. Keep direct
  // usage as an explicit opt-in for local profiling only.
  if (directUrl && ['1', 'true', 'yes', 'on'].includes(preferDirectUrl)) {
    return directUrl
  }

  if (databaseUrl && process.env.NODE_ENV !== 'production') {
    try {
      const nextUrl = new URL(databaseUrl)
      if (nextUrl.searchParams.get('pgbouncer') === 'true') {
        const currentLimit = Number(nextUrl.searchParams.get('connection_limit') || 0)
        if (!Number.isFinite(currentLimit) || currentLimit < 5) {
          nextUrl.searchParams.set('connection_limit', '5')
        }
        if (!nextUrl.searchParams.has('pool_timeout')) {
          nextUrl.searchParams.set('pool_timeout', '30')
        }
        return nextUrl.toString()
      }
    } catch {
      // Fall back to the raw DATABASE_URL when parsing fails.
    }
  }

  return databaseUrl
}

const runtimeDatabaseUrl = resolveRuntimeDatabaseUrl()

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(runtimeDatabaseUrl
      ? {
          datasources: {
            db: {
              url: runtimeDatabaseUrl
            }
          }
        }
      : {}),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']
  })

// Cache in ALL environments to avoid multiple instances
globalForPrisma.prisma = prisma
