import { deployMigrations } from './prisma-migrate-utils.mjs'

async function main() {
  const result = await deployMigrations({ allowBaseline: true })

  if (result.mode === 'baselined') {
    console.log(`Baselined existing database at ${result.targetUrl}`)
    console.log(`Recorded ${result.baselineResult.inserted} migrations as already applied`)
    return
  }

  if (result.mode === 'baselined-and-applied') {
    console.log(`Baselined existing database at ${result.targetUrl}`)
    console.log(`Recorded ${result.baselineResult.inserted} existing migrations as already applied`)
    console.log(`Applied ${result.applied.length} pending migrations after baseline`)
    return
  }

  if (result.mode === 'applied') {
    console.log(`Applied ${result.applied.length} migrations to ${result.targetUrl}`)
    return
  }

  console.log(`No pending migrations for ${result.targetUrl}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
