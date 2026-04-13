import { createHash } from 'crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { BankStatementError } from '../errors'

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME)
}

function getLegacyStorageRoot() {
  return path.join(/* turbopackIgnore: true */ process.cwd(), 'var', 'bank-statements')
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

function isMissingStoredFileTableError(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const maybeCode = 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  const maybeMessage = 'message' in error ? String((error as { message?: unknown }).message || '') : ''

  return maybeCode === 'P2021' || /BankStatementStoredFile/i.test(maybeMessage)
}

export async function saveBankStatementFile(input: {
  companyId: string
  batchId: string
  fileName: string
  fileMimeType?: string | null
  bytes: Uint8Array
}) {
  const storageRoot = getPreferredStorageRoot()
  const safeName = sanitizeSegment(input.fileName)
  const storageKey = path.join(sanitizeSegment(input.companyId), sanitizeSegment(input.batchId), safeName)
  const fullPath = path.join(storageRoot, storageKey)
  const checksum = createHash('sha256').update(input.bytes).digest('hex')
  const fileSizeBytes = Number(input.bytes.byteLength || 0)

  try {
    await prisma.bankStatementStoredFile.upsert({
      where: {
        batchId: input.batchId
      },
      update: {
        fileName: input.fileName,
        fileMimeType: String(input.fileMimeType || 'application/octet-stream'),
        fileSizeBytes,
        checksum,
        bytes: Buffer.from(input.bytes)
      },
      create: {
        batchId: input.batchId,
        fileName: input.fileName,
        fileMimeType: String(input.fileMimeType || 'application/octet-stream'),
        fileSizeBytes,
        checksum,
        bytes: Buffer.from(input.bytes)
      }
    })
  } catch (error) {
    if (isMissingStoredFileTableError(error)) {
      throw new BankStatementError(
        'UPLOAD_FAILED',
        'Bank statement storage schema is not initialized. Run database migration and try again.',
        {
          status: 503,
          cause: error
        }
      )
    }
    throw error
  }

  let cachedFileSizeBytes = fileSizeBytes
  let cachedFullPath: string | null = null

  try {
    const directory = path.join(storageRoot, sanitizeSegment(input.companyId), sanitizeSegment(input.batchId))
    await mkdir(directory, { recursive: true })
    await writeFile(fullPath, input.bytes)
    const fileStat = await stat(fullPath)
    cachedFileSizeBytes = Number(fileStat.size || fileSizeBytes)
    cachedFullPath = fullPath
  } catch (error) {
    console.warn('[bank-statements] local runtime cache write skipped', {
      storageRoot,
      storageKey,
      message: error instanceof Error ? error.message : String(error)
    })
  }

  return {
    storageDisk: 'database',
    storageBucket: 'bank-statements',
    storageKey,
    fullPath: cachedFullPath,
    checksum,
    fileSizeBytes: cachedFileSizeBytes
  }
}

export async function loadBankStatementFile(input: {
  batchId: string
  storageKey: string
}) {
  try {
    const storedFile = await prisma.bankStatementStoredFile.findUnique({
      where: {
        batchId: input.batchId
      },
      select: {
        bytes: true
      }
    })

    if (storedFile?.bytes) {
      return {
        fullPath: `database:${input.batchId}`,
        bytes: new Uint8Array(storedFile.bytes)
      }
    }
  } catch (error) {
    if (isMissingStoredFileTableError(error)) {
      throw new BankStatementError(
        'UPLOAD_FAILED',
        'Bank statement storage schema is not initialized. Run database migration and try again.',
        {
          status: 503,
          cause: error
        }
      )
    }
    throw error
  }

  const normalizedKey = input.storageKey.replace(/^\/+/, '')
  const roots = getStorageRoots()
  let lastError: unknown = null

  for (const root of roots) {
    const candidatePath = path.join(root, normalizedKey)
    try {
      const bytes = await readFile(candidatePath)
      return {
        fullPath: candidatePath,
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

export async function deleteBankStatementFile(input: {
  batchId?: string | null
  storageKey: string
}) {
  const normalizedKey = input.storageKey.replace(/^\/+/, '')

  if (input.batchId) {
    await prisma.bankStatementStoredFile.deleteMany({
      where: {
        batchId: input.batchId
      }
    }).catch(() => undefined)
  }

  await Promise.all(
    getStorageRoots().map(async (root) => {
      const fullPath = path.join(root, normalizedKey)
      await unlink(fullPath).catch(() => undefined)
    })
  )
}
