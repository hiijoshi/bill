import 'dotenv/config'

import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'

function resolveSqlitePathFromUrl(url) {
  if (!url.startsWith('file:')) {
    throw new Error('prisma:migrate:baseline supports local SQLite DATABASE_URL (file:) only')
  }

  const raw = url.slice('file:'.length)
  if (!raw || raw === ':memory:') {
    throw new Error('DATABASE_URL must point to a persisted SQLite file')
  }

  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), 'prisma', raw)
}

function runSqliteQuery(dbPath, sql) {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8' }).trim()
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function loadMigrations() {
  const root = path.join(process.cwd(), 'prisma', 'migrations')
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim()
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }

  const dbPath = resolveSqlitePathFromUrl(databaseUrl)
  const userTablesRaw = runSqliteQuery(
    dbPath,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
  )
  const userTables = userTablesRaw ? userTablesRaw.split('\n').map((line) => line.trim()).filter(Boolean) : []

  if (userTables.length === 0) {
    throw new Error('Database is empty. Baseline is only for existing databases with preloaded schema.')
  }

  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const migrations = loadMigrations()
  let appliedCount = 0
  const hasMigrationTable =
    runSqliteQuery(dbPath, "SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name='_prisma_migrations';") === '1'

  for (const migration of migrations) {
    if (hasMigrationTable) {
      const alreadyApplied = runSqliteQuery(
        dbPath,
        `SELECT COUNT(1) FROM "_prisma_migrations" WHERE migration_name='${migration.replace(/'/g, "''")}' AND finished_at IS NOT NULL;`
      )
      if (alreadyApplied === '1') {
        continue
      }
    }

    if (migration.length === 0) {
      continue
    }

    run(npxCommand, ['prisma', 'migrate', 'resolve', '--applied', migration])
    appliedCount += 1
  }

  console.log(`Baselined existing database at ${databaseUrl}`)
  console.log(`Recorded ${appliedCount} migration(s) as already applied`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
