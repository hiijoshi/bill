import { access, copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const targetPath = path.join(rootDir, 'public', 'pdf.worker.mjs')

const candidateSources = [
  path.join(rootDir, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'),
  path.join(rootDir, 'node_modules', 'pdf-parse', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
]

async function resolveWorkerSource() {
  for (const sourcePath of candidateSources) {
    try {
      await access(sourcePath)
      return sourcePath
    } catch {
      // Try next candidate path.
    }
  }

  throw new Error(
    `Unable to locate pdf.worker.mjs. Checked: ${candidateSources.join(', ')}`
  )
}

async function run() {
  const sourcePath = await resolveWorkerSource()
  await mkdir(path.dirname(targetPath), { recursive: true })
  await copyFile(sourcePath, targetPath)
  console.log(`[copy-pdf-worker] copied ${sourcePath} -> ${targetPath}`)
}

run().catch((error) => {
  console.error(
    `[copy-pdf-worker] failed: ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
