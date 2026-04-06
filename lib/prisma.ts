import { PrismaClient } from '@prisma/client'
import { createClient } from '@libsql/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim()
  const tursoUrl = String(process.env.TURSO_DATABASE_URL || '').trim()
  const tursoAuthToken = String(process.env.TURSO_AUTH_TOKEN || '').trim()
  const useTurso = String(process.env.USE_TURSO || '').trim().toLowerCase() === 'true'
  const isProduction = process.env.NODE_ENV === 'production'

  // Prefer local SQLite in development unless Turso is explicitly enabled.
  const libsqlUrl = (useTurso || (isProduction && (tursoUrl || databaseUrl.startsWith('libsql://'))))
    ? tursoUrl || (databaseUrl.startsWith('libsql://') ? databaseUrl : '')
    : ''

  const adapter = libsqlUrl
    ? new PrismaLibSQL(
        createClient({
          url: libsqlUrl,
          ...(tursoAuthToken ? { authToken: tursoAuthToken } : {})
        })
      )
    : undefined

  return new PrismaClient({
    ...(adapter ? { adapter } : {}),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
