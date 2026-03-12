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

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function run() {
  if (!(await pathExists(nextBin))) {
    console.error('next binary not found. Run: npm install')
    process.exit(1)
  }

  await fs.rm(path.join(projectRoot, '.next'), { recursive: true, force: true })

  const args = ['dev', '--turbopack', ...process.argv.slice(2)]
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
