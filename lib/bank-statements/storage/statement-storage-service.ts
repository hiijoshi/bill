import { createHash } from 'crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { BankStatementError } from '../errors'

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME)
}

function getLegacyStorageRoot() {
  return path.join(process.cwd(), 'var', 'bank-statements')
}

function getPreferredStorageRoot() {
  const configured = String(process.env.BANK_STATEMENT_STORAGE_DIR || '').trim()
  if (configured) {
    return path.resolve(configured)
  }

  if (isServerlessRuntime()) {
    return path.join(tmpdir(), 'mbill', 'bank-statements')
  }

  return getLegacyStorageRoot()
}

function getStorageRoots() {
  const preferred = getPreferredStorageRoot()
  const roots = [preferred]
  const legacy = getLegacyStorageRoot()

  if (legacy !== preferred) {
    roots.push(legacy)
  }

  return roots
}

function sanitizeSegment(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'file'
}

export async function saveBankStatementFile(input: {
  companyId: string
  batchId: string
  fileName: string
  bytes: Uint8Array
}) {
  const storageRoot = getPreferredStorageRoot()
  const safeName = sanitizeSegment(input.fileName)
  const directory = path.join(storageRoot, sanitizeSegment(input.companyId), sanitizeSegment(input.batchId))
  await mkdir(directory, { recursive: true })

  const storageKey = path.join(sanitizeSegment(input.companyId), sanitizeSegment(input.batchId), safeName)
  const fullPath = path.join(storageRoot, storageKey)
  await writeFile(fullPath, input.bytes)

  const checksum = createHash('sha256').update(input.bytes).digest('hex')
  const fileStat = await stat(fullPath)

  return {
    storageDisk: storageRoot.startsWith(tmpdir()) ? 'tmp' : 'local',
    storageBucket: 'bank-statements',
    storageKey,
    fullPath,
    checksum,
    fileSizeBytes: Number(fileStat.size || input.bytes.byteLength)
  }
}

export async function loadBankStatementFile(storageKey: string) {
  const normalizedKey = storageKey.replace(/^\/+/, '')
  const roots = getStorageRoots()
  let resolvedPath: string | null = null
  let lastError: unknown = null

  for (const root of roots) {
    const candidatePath = path.join(root, normalizedKey)
    try {
      const bytes = await readFile(candidatePath)
      resolvedPath = candidatePath
      return {
        fullPath: resolvedPath,
        bytes: new Uint8Array(bytes)
      }
    } catch (error) {
      lastError = error
    }
  }

  throw new BankStatementError('UPLOAD_FAILED', 'Stored bank statement file could not be loaded from runtime storage.', {
    status: 404,
    details: { storageKey: normalizedKey, searchedRoots: roots },
    cause: lastError
  })
}

export async function deleteBankStatementFile(storageKey: string) {
  const normalizedKey = storageKey.replace(/^\/+/, '')

  await Promise.all(
    getStorageRoots().map(async (root) => {
      const fullPath = path.join(root, normalizedKey)
      await unlink(fullPath).catch(() => undefined)
    })
  )
}
