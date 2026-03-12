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

const lockFile = path.join(projectRoot, '.next', 'dev', 'lock')
const cacheDir = path.join(projectRoot, '.next', 'dev', 'cache')
const nextDir = path.join(projectRoot, '.next')
const engine = process.env.NEXT_DEV_ENGINE === 'turbopack' ? 'turbopack' : 'webpack'

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function removeDuplicateNextArtifacts(dirPath, depth = 0) {
  if (depth > 3) return
  let entries = []
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        await removeDuplicateNextArtifacts(fullPath, depth + 1)
        return
      }

      if (/ \d+/.test(entry.name)) {
        await fs.rm(fullPath, { force: true })
      }
    })
  )
}

async function run() {
  if (!(await pathExists(nextBin))) {
    console.error('next binary not found. Run: npm install')
    process.exit(1)
  }

  if (await pathExists(lockFile)) {
    await fs.rm(lockFile, { force: true })
  }

  await removeDuplicateNextArtifacts(nextDir)

  if (engine === 'turbopack' && (await pathExists(cacheDir))) {
    await fs.rm(cacheDir, { recursive: true, force: true })
  }

  const args = ['dev', engine === 'turbopack' ? '--turbopack' : '--webpack', ...process.argv.slice(2)]
  const child = spawn(nextBin, args, {
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
