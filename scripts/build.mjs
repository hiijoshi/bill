import { spawnSync } from 'node:child_process'
const env = { ...process.env }

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
