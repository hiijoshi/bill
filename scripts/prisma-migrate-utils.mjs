import 'dotenv/config'

import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { createClient } from '@libsql/client'

const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "checksum" TEXT NOT NULL,
  "finished_at" DATETIME,
  "migration_name" TEXT NOT NULL,
  "logs" TEXT,
  "rolled_back_at" DATETIME,
  "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
`

function normalizeFlag(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on'
}

function normalizeString(value) {
  return String(value || '').trim()
}

function resolveMigrationDatabaseUrl() {
  const explicitUrl = normalizeString(process.env.MIGRATE_DATABASE_URL)
  const databaseUrl = normalizeString(process.env.DATABASE_URL)
  const tursoUrl = normalizeString(process.env.TURSO_DATABASE_URL)
  const useTurso = normalizeFlag(process.env.USE_TURSO)
  const isProduction = normalizeString(process.env.NODE_ENV) === 'production'

  if (explicitUrl) {
    return explicitUrl
  }

  if (tursoUrl && (useTurso || isProduction || !databaseUrl || /^(libsql|https?):/i.test(databaseUrl))) {
    return tursoUrl
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL or TURSO_DATABASE_URL is required to run migrations')
  }

  if (!databaseUrl.startsWith('file:')) {
    return databaseUrl
  }

  const rawPath = databaseUrl.slice('file:'.length)
  if (!rawPath || rawPath === ':memory:') {
    return databaseUrl
  }

  if (path.isAbsolute(rawPath)) {
    return `file:${rawPath}`
  }

  return `file:${path.join(process.cwd(), 'prisma', rawPath)}`
}

function createMigrationClient() {
  const url = resolveMigrationDatabaseUrl()
  const authToken = normalizeString(process.env.TURSO_AUTH_TOKEN)
  const isRemote = /^(libsql|https?):/i.test(url)

  if (isRemote && !authToken) {
    throw new Error('TURSO_AUTH_TOKEN is required when applying migrations to Turso/libSQL')
  }

  return createClient({
    url,
    ...(authToken ? { authToken } : {})
  })
}

function loadMigrations() {
  const migrationsRoot = path.join(process.cwd(), 'prisma', 'migrations')

  return readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
    .map((entry) => {
      const migrationPath = path.join(migrationsRoot, entry.name, 'migration.sql')
      const sql = readFileSync(migrationPath, 'utf8')

      return {
        name: entry.name,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
        path: migrationPath
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

async function tableExists(client, tableName) {
  const result = await client.execute({
    sql: 'SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1',
    args: ['table', tableName]
  })

  return result.rows.length > 0
}

async function getUserTableNames(client) {
  const result = await client.execute(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name <> '_prisma_migrations'
    ORDER BY name
  `)

  return result.rows.map((row) => String(row.name))
}

async function getTableColumns(client, tableName) {
  const result = await client.execute(`PRAGMA table_info("${tableName}")`)
  return new Set(result.rows.map((row) => String(row.name)))
}

async function ensureMigrationsTable(client) {
  await client.executeMultiple(MIGRATIONS_TABLE_SQL)
}

async function getAppliedMigrations(client) {
  if (!(await tableExists(client, '_prisma_migrations'))) {
    return []
  }

  const result = await client.execute(`
    SELECT migration_name
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL
      AND rolled_back_at IS NULL
    ORDER BY migration_name
  `)

  return result.rows.map((row) => String(row.migration_name))
}

async function hasSharedLateStageSchema(client, existingTables) {
  const requiredTables = [
    'Trader',
    'Company',
    'User',
    'Payment',
    'PurchaseBill',
    'SalesBill',
    'SubscriptionPlan',
    'TraderSubscription',
    'SalesAdditionalCharge',
    'Bank',
    'Marka',
    'PaymentMode'
  ]

  if (requiredTables.some((tableName) => !existingTables.has(tableName))) {
    return false
  }

  const paymentColumns = await getTableColumns(client, 'Payment')
  const companyColumns = await getTableColumns(client, 'Company')
  const userColumns = await getTableColumns(client, 'User')

  return (
    paymentColumns.has('billDate') &&
    paymentColumns.has('deletedAt') &&
    companyColumns.has('locked') &&
    companyColumns.has('deletedAt') &&
    userColumns.has('companyId')
  )
}

async function detectBaselineMigrationName(client) {
  const existingTables = new Set(await getUserTableNames(client))
  const hasLateStageSchema = await hasSharedLateStageSchema(client, existingTables)

  if (!hasLateStageSchema) {
    return null
  }

  if (existingTables.has('FinancialYear')) {
    const financialYearColumns = await getTableColumns(client, 'FinancialYear')
    if (financialYearColumns.has('status') && financialYearColumns.has('isActive')) {
      return '20260406153000_add_financial_years'
    }
  }

  return '20260406110000_phase3_performance_and_sales_additional_charges'
}

async function recordAppliedMigration(client, migration) {
  const now = new Date().toISOString()

  await client.execute({
    sql: `
      INSERT INTO "_prisma_migrations" (
        id,
        checksum,
        finished_at,
        migration_name,
        logs,
        rolled_back_at,
        started_at,
        applied_steps_count
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)
    `,
    args: [randomUUID(), migration.checksum, now, migration.name, now]
  })
}

async function baselineExistingDatabase(client, migrations, reason, throughMigrationName = null) {
  await ensureMigrationsTable(client)
  const applied = new Set(await getAppliedMigrations(client))
  let inserted = 0
  const migrationsToRecord =
    throughMigrationName == null
      ? migrations
      : migrations.filter((migration) => migration.name <= throughMigrationName)

  for (const migration of migrationsToRecord) {
    if (applied.has(migration.name)) {
      continue
    }

    await recordAppliedMigration(client, migration)
    inserted += 1
  }

  return { inserted, reason, throughMigrationName }
}

async function applyMigration(client, migration) {
  const migrationId = randomUUID()
  const startedAt = new Date().toISOString()

  await client.execute({
    sql: `
      INSERT INTO "_prisma_migrations" (
        id,
        checksum,
        finished_at,
        migration_name,
        logs,
        rolled_back_at,
        started_at,
        applied_steps_count
      ) VALUES (?, ?, NULL, ?, NULL, NULL, ?, 0)
    `,
    args: [migrationId, migration.checksum, migration.name, startedAt]
  })

  try {
    await client.executeMultiple(migration.sql)

    await client.execute({
      sql: `
        UPDATE "_prisma_migrations"
        SET finished_at = ?, applied_steps_count = 1
        WHERE id = ?
      `,
      args: [new Date().toISOString(), migrationId]
    })
  } catch (error) {
    await client.execute({
      sql: `
        UPDATE "_prisma_migrations"
        SET logs = ?
        WHERE id = ?
      `,
      args: [error instanceof Error ? error.message : String(error), migrationId]
    })

    throw error
  }
}

async function deployMigrations({ allowBaseline = true } = {}) {
  const client = createMigrationClient()
  const migrations = loadMigrations()
  const hasMigrationsTable = await tableExists(client, '_prisma_migrations')
  const userTables = await getUserTableNames(client)

  if (!hasMigrationsTable && userTables.length > 0) {
    const baselineMigrationName = await detectBaselineMigrationName(client)

    if (!allowBaseline) {
      throw new Error(
        'Database already contains tables but has no migration history. Run npm run prisma:migrate:baseline first.'
      )
    }

    if (!baselineMigrationName) {
      throw new Error(
        'Database contains existing tables without migration history, but the schema does not match the current application shape. Refusing unsafe automatic baseline.'
      )
    }

    const baselineResult = await baselineExistingDatabase(
      client,
      migrations,
      'existing-schema-checkpoint',
      baselineMigrationName
    )
    const appliedAfterBaseline = new Set(await getAppliedMigrations(client))
    const pendingAfterBaseline = migrations.filter((migration) => !appliedAfterBaseline.has(migration.name))

    for (const migration of pendingAfterBaseline) {
      await applyMigration(client, migration)
    }

    return {
      mode: pendingAfterBaseline.length > 0 ? 'baselined-and-applied' : 'baselined',
      applied: pendingAfterBaseline.map((migration) => migration.name),
      baselineResult,
      targetUrl: resolveMigrationDatabaseUrl()
    }
  }

  await ensureMigrationsTable(client)

  const appliedMigrations = new Set(await getAppliedMigrations(client))
  const pendingMigrations = migrations.filter((migration) => !appliedMigrations.has(migration.name))

  for (const migration of pendingMigrations) {
    await applyMigration(client, migration)
  }

  return {
    mode: pendingMigrations.length > 0 ? 'applied' : 'noop',
    applied: pendingMigrations.map((migration) => migration.name),
    targetUrl: resolveMigrationDatabaseUrl()
  }
}

export {
  baselineExistingDatabase,
  createMigrationClient,
  detectBaselineMigrationName,
  deployMigrations,
  getAppliedMigrations,
  getUserTableNames,
  hasSharedLateStageSchema,
  loadMigrations,
  resolveMigrationDatabaseUrl
}
