import { spawnSync } from 'node:child_process'

const env = { ...process.env }

// Prisma schema uses a sqlite datasource for client generation, while runtime
// can still switch to Turso via the Prisma libsql adapter. When Turso is the
// only configured database in Vercel, provide a harmless fallback DATABASE_URL
// so `prisma generate` and `next build` do not fail on missing sqlite config.
if (!env.DATABASE_URL && env.TURSO_DATABASE_URL) {
  env.DATABASE_URL = 'file:./dev.db'
}

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run(npxCommand, ['prisma', 'generate'])
run(npxCommand, ['next', 'build'])
