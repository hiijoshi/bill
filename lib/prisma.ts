import { PrismaClient } from '@prisma/client'

import { env } from '@/lib/config'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const client = new PrismaClient({
    datasourceUrl: env.DATABASE_URL,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    transactionOptions: {
      maxWait: 5000,
      timeout: 10000
    }
  })

  // SQLite tuning for better multi-user behavior on smaller servers.
  if ((env.DATABASE_URL || '').startsWith('file:')) {
    void client.$queryRawUnsafe('PRAGMA busy_timeout = 5000').catch(() => {})
    void client.$queryRawUnsafe('PRAGMA foreign_keys = ON').catch(() => {})
  }

  return client
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
