#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const nextBin = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'next.cmd' : 'next'
)
const devSafeScript = path.join(projectRoot, 'scripts', 'dev-safe.mjs')

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function run() {
  if (!(await pathExists(nextBin)) || !(await pathExists(devSafeScript))) {
    console.error('dev dependencies not found. Run: npm install')
    process.exit(1)
  }

  await fs.rm(path.join(projectRoot, '.next'), { recursive: true, force: true })

  // After a full clean, fall back to the safer dev bootstrap instead of forcing
  // Turbopack immediately. This avoids the persistent-cache "write batch /
  // compaction already active" failure when a previous dev cache is still
  // settling. If Turbopack is explicitly desired, NEXT_DEV_ENGINE=turbopack
  // can still be provided and dev-safe will honor it.
  const child = spawn(process.execPath, [devSafeScript, ...process.argv.slice(2)], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })

  child.on('error', (error) => {
    console.error('Failed to start Next.js dev server:', error)
    process.exit(1)
  })
}

void run()
