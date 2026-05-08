import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

function resolveSqlitePath(databaseUrl) {
  if (!databaseUrl || !databaseUrl.startsWith('file:')) {
    throw new Error('DATABASE_URL must be a local SQLite file: file:/abs/path/to/dev.db')
  }

  const raw = databaseUrl.slice('file:'.length)
  if (!raw || raw === ':memory:') {
    throw new Error('DATABASE_URL must point to a persisted SQLite file')
  }

  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), 'prisma', raw)
}

function runSqlite(dbPath, sql) {
  execFileSync('sqlite3', [dbPath], {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit']
  })
}

function main() {
  const dumpPathArg = String(process.argv[2] || '').trim()
  if (!dumpPathArg) {
    throw new Error('Usage: node scripts/import-sqlite-dump.mjs /absolute/path/to/turso-export.sql')
  }

  const dumpPath = path.resolve(dumpPathArg)
  const databaseUrl = String(process.env.DATABASE_URL || '').trim()
  const dbPath = resolveSqlitePath(databaseUrl)

  if (!existsSync(dumpPath)) {
    throw new Error(`Dump file not found: ${dumpPath}`)
  }

  const dbDir = path.dirname(dbPath)
  mkdirSync(dbDir, { recursive: true })

  if (existsSync(dbPath)) {
    const backupPath = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
    copyFileSync(dbPath, backupPath)
    console.log(`Backup created: ${backupPath}`)
  }

  const sql = readFileSync(dumpPath, 'utf8')
  runSqlite(dbPath, sql)
  console.log(`Imported dump into: ${dbPath}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
