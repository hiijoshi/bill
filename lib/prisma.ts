import { PrismaClient } from '@prisma/client'
import { createClient } from '@libsql/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'

import { env, usesTursoRuntime } from '@/lib/config'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const databaseUrl = String(env.DATABASE_URL || '').trim()
  const tursoUrl = String(env.TURSO_DATABASE_URL || '').trim()
  const tursoAuthToken = String(env.TURSO_AUTH_TOKEN || '').trim()

  // Prefer local SQLite in development and use Turso/libSQL only when the
  // normalized runtime config explicitly resolves to that path.
  const libsqlUrl = usesTursoRuntime
    ? tursoUrl ||
      (databaseUrl.startsWith('libsql://') || databaseUrl.startsWith('https://') || databaseUrl.startsWith('http://')
        ? databaseUrl
        : '')
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
    transactionOptions: {
      maxWait: 10_000,
      timeout: 20_000
    }
  })
}

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
