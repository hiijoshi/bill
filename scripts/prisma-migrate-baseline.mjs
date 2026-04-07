import {
  baselineExistingDatabase,
  createMigrationClient,
  detectBaselineMigrationName,
  getUserTableNames,
  loadMigrations,
  resolveMigrationDatabaseUrl
} from './prisma-migrate-utils.mjs'

async function main() {
  const client = createMigrationClient()
  const userTables = await getUserTableNames(client)

  if (userTables.length === 0) {
    throw new Error('Database is empty. Baseline is only for existing databases with preloaded schema.')
  }

  const baselineMigrationName = await detectBaselineMigrationName(client)
  if (!baselineMigrationName) {
    throw new Error(
      'Existing database does not match any verified schema checkpoint closely enough for a safe automatic baseline.'
    )
  }

  const result = await baselineExistingDatabase(client, loadMigrations(), 'manual-baseline', baselineMigrationName)

  console.log(`Baselined existing database at ${resolveMigrationDatabaseUrl()}`)
  console.log(`Recorded ${result.inserted} migrations as already applied`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
