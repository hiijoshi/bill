import { createHash } from 'crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { BankStatementError } from '../errors'

const STORAGE_ROOT = path.join(process.cwd(), 'var', 'bank-statements')

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
  const safeName = sanitizeSegment(input.fileName)
  const directory = path.join(STORAGE_ROOT, sanitizeSegment(input.companyId), sanitizeSegment(input.batchId))
  await mkdir(directory, { recursive: true })

  const storageKey = path.join(sanitizeSegment(input.companyId), sanitizeSegment(input.batchId), safeName)
  const fullPath = path.join(STORAGE_ROOT, storageKey)
  await writeFile(fullPath, input.bytes)

  const checksum = createHash('sha256').update(input.bytes).digest('hex')
  const fileStat = await stat(fullPath)

  return {
    storageDisk: 'local',
    storageBucket: 'bank-statements',
    storageKey,
    fullPath,
    checksum,
    fileSizeBytes: Number(fileStat.size || input.bytes.byteLength)
  }
}

export async function loadBankStatementFile(storageKey: string) {
  const normalizedKey = storageKey.replace(/^\/+/, '')
  const fullPath = path.join(STORAGE_ROOT, normalizedKey)
  const bytes = await readFile(fullPath).catch((error) => {
    throw new BankStatementError('UPLOAD_FAILED', 'Stored bank statement file could not be loaded.', {
      status: 404,
      details: { storageKey: normalizedKey },
      cause: error
    })
  })

  return {
    fullPath,
    bytes: new Uint8Array(bytes)
  }
}

export async function deleteBankStatementFile(storageKey: string) {
  const normalizedKey = storageKey.replace(/^\/+/, '')
  const fullPath = path.join(STORAGE_ROOT, normalizedKey)
  await unlink(fullPath).catch(() => undefined)
}
