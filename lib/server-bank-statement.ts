import 'server-only'

import { createHash } from 'crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getCsvValue, normalizeCsvHeader, parseCsvObjects, parseCsvRows, type CsvImportRow } from '@/lib/master-csv'
import type { StatementDirection, StatementDocumentKind, StatementDocumentMeta } from '@/lib/bank-statement-types'

export type ParsedStatementEntry = {
  rowNo: number
  postedAt: string
  amount: number
  direction: StatementDirection
  description: string
  reference: string | null
  externalId: string
}

export type ParsedStatementResult =
  | ParsedStatementEntry
  | {
      rowNo: number
      reason: string
    }

const CSV_EXTENSIONS = new Set(['csv'])
const EXCEL_EXTENSIONS = new Set(['xls', 'xlsx'])
const PDF_EXTENSIONS = new Set(['pdf'])
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'])
const TEXT_EXTENSIONS = new Set(['txt'])

const DATE_PATTERN = /\b(?:\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/
const DIRECTION_PATTERN = /\b(?:cr|credit|deposit|received|receipt|dr|debit|withdrawal|withdraw|payment|paid)\b/i
const AMOUNT_PATTERN = /-?\d[\d,]*(?:\.\d{1,2})?/g

function normalizeText(value: unknown): string {
  return String(value || '').trim()
}

function normalizeForCompare(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/\s+/g, ' ')
}

function getFileExtension(fileName: string): string {
  const normalized = normalizeText(fileName).toLowerCase()
  const segments = normalized.split('.')
  return segments.length > 1 ? segments.at(-1) || '' : ''
}

function detectDocumentKind(file: File): StatementDocumentKind | null {
  const extension = getFileExtension(file.name)
  const mimeType = normalizeText(file.type).toLowerCase()

  if (CSV_EXTENSIONS.has(extension) || mimeType.includes('csv')) return 'csv'
  if (EXCEL_EXTENSIONS.has(extension) || mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'excel'
  if (PDF_EXTENSIONS.has(extension) || mimeType.includes('pdf')) return 'pdf'
  if (IMAGE_EXTENSIONS.has(extension) || mimeType.startsWith('image/')) return 'image'
  if (TEXT_EXTENSIONS.has(extension) || mimeType.startsWith('text/')) return 'text'

  return null
}

type ExtractedStatementText = {
  text: string
  pageCount: number
}

type PdfParseModule = typeof import('pdf-parse')
type TesseractModule = typeof import('tesseract.js')
type TesseractWorker = Awaited<ReturnType<TesseractModule['createWorker']>>

let pdfCanvasGlobalsReady: Promise<void> | null = null
let pdfParseModuleReady: Promise<PdfParseModule> | null = null
let ocrWorkerReady: Promise<TesseractWorker> | null = null
let ocrWorkerQueue: Promise<unknown> = Promise.resolve()
let ocrWorkerIdleTimer: ReturnType<typeof setTimeout> | null = null

const OCR_WORKER_IDLE_TIMEOUT_MS = 2 * 60_000
const OCR_MAX_IMAGE_EDGE_PX = 1800
const OCR_MAX_IMAGE_PIXELS = 2_400_000
const PDFJS_WORKER_MODULE_SPECIFIER = 'pdfjs-dist/legacy/build/pdf.worker.mjs'
const TESSERACT_NODE_WORKER_SPECIFIER = 'tesseract.js/src/worker-script/node/index.js'

type StructuredStatementCsvRow = {
  row: CsvImportRow
  rowNo: number
}

const STATEMENT_DATE_HEADERS = new Set(
  ['Date', 'Txn Date', 'Transaction Date', 'Posted Date', 'Value Date', 'Entry Date'].map(normalizeCsvHeader)
)
const STATEMENT_DEBIT_HEADERS = new Set(
  ['Debit', 'Withdrawal', 'Debit Amount', 'Dr Amount', 'Dr', 'Withdrawals', 'Debit (Rs)'].map(normalizeCsvHeader)
)
const STATEMENT_CREDIT_HEADERS = new Set(
  ['Credit', 'Deposit', 'Credit Amount', 'Cr Amount', 'Cr', 'Deposits', 'Credit (Rs)'].map(normalizeCsvHeader)
)
const STATEMENT_AMOUNT_HEADERS = new Set(
  ['Amount', 'Txn Amount', 'Transaction Amount', 'Amount (Rs)'].map(normalizeCsvHeader)
)
const STATEMENT_DESCRIPTION_HEADERS = new Set(
  ['Description', 'Narration', 'Particular', 'Particulars', 'Details', 'Remarks', 'Remark'].map(normalizeCsvHeader)
)
const STATEMENT_REFERENCE_HEADERS = new Set(
  ['Reference', 'Txn Ref', 'Transaction Ref', 'UTR', 'Ref No', 'Cheque No', 'Chq No', 'Voucher No'].map(normalizeCsvHeader)
)

const PLACEHOLDER_DATE_VALUES = new Set([
  'mm/dd/yyyy',
  'dd/mm/yyyy',
  'yyyy-mm-dd',
  'date'
])

const NON_TRANSACTION_ROW_PATTERNS = [
  /\bstatement of account\b/i,
  /\bbank statement\b/i,
  /\bopening balance\b/i,
  /\bclosing balance\b/i,
  /\bavailable balance\b/i,
  /\btotal credit amount\b/i,
  /\btotal debit amount\b/i,
  /\bnumber of transactions\b/i,
  /^transactions?$/i,
  /^page\s+\d+/i
]

const NON_TRANSACTION_TEXT_PATTERNS = [
  ...NON_TRANSACTION_ROW_PATTERNS,
  /^\s*statement period\b/i,
  /^\s*generated on\b/i,
  /^\s*account (?:name|number|no)\b/i,
  /^\s*customer id\b/i,
  /^\s*branch(?: name)?\b/i,
  /^\s*from date\b/i,
  /^\s*to date\b/i
]

const TRANSACTION_HEADER_PATTERNS = [
  /^\s*(?:txn\s+)?date\b.*\b(?:description|narration|particular|remarks?)\b/i,
  /^\s*(?:txn\s+)?date\b.*\b(?:debit|credit|withdrawal|deposit|balance|amount)\b/i,
  /^\s*(?:description|narration|particulars?|remarks?)\b.*\b(?:debit|credit|withdrawal|deposit|balance|amount)\b/i,
  /^\s*(?:withdrawals?|debit)\b.*\b(?:deposits?|credit)\b.*\bbalance\b/i
]

type NumericLineMatch = {
  raw: string
  index: number
  value: number
}

function rowHasAnyHeader(headers: string[], candidates: Set<string>): boolean {
  return headers.some((header) => candidates.has(header))
}

function buildStructuredCsvRecord(headers: string[], rawRow: string[]): CsvImportRow {
  const record: CsvImportRow = {}

  headers.forEach((header, index) => {
    if (!header) return
    record[header] = String(rawRow[index] || '').trim()
  })

  return record
}

function hasNonZeroAmountCell(value: string): boolean {
  const parsed = parseAmountValue(value)
  return typeof parsed === 'number' && parsed > 0
}

function shouldSkipStructuredStatementRow(row: CsvImportRow): boolean {
  const values = Object.values(row).map((value) => normalizeText(value)).filter(Boolean)
  if (values.length === 0) return true

  const typeValue = normalizeForCompare(getCsvValue(row, ['Type']))
  const descriptionValue = normalizeForCompare(
    getCsvValue(row, ['Description', 'Narration', 'Particular', 'Particulars', 'Details', 'Remarks', 'Remark'])
  )
  const dateValue = normalizeText(getCsvValue(row, ['Date', 'Txn Date', 'Transaction Date', 'Posted Date', 'Value Date', 'Entry Date']))
  const referenceValue = normalizeText(
    getCsvValue(row, ['Reference', 'Txn Ref', 'Transaction Ref', 'UTR', 'Ref No', 'Cheque No', 'Chq No', 'Voucher No'])
  )
  const debitValue = normalizeText(
    getCsvValue(row, ['Debit', 'Withdrawal', 'Debit Amount', 'Dr Amount', 'Dr', 'Withdrawals', 'Debit (Rs)'])
  )
  const creditValue = normalizeText(
    getCsvValue(row, ['Credit', 'Deposit', 'Credit Amount', 'Cr Amount', 'Cr', 'Deposits', 'Credit (Rs)'])
  )
  const amountValue = normalizeText(getCsvValue(row, ['Amount', 'Txn Amount', 'Transaction Amount', 'Amount (Rs)']))
  const normalizedDateValue = normalizeForCompare(dateValue)
  const descriptor = `${typeValue} ${descriptionValue}`.trim()
  const hasTransactionAmount =
    hasNonZeroAmountCell(debitValue) ||
    hasNonZeroAmountCell(creditValue) ||
    hasNonZeroAmountCell(amountValue)

  if (!dateValue && (typeValue === 'total' || descriptionValue === 'total')) {
    return true
  }

  if (PLACEHOLDER_DATE_VALUES.has(normalizedDateValue)) {
    return true
  }

  if (NON_TRANSACTION_ROW_PATTERNS.some((pattern) => pattern.test(descriptor))) {
    return true
  }

  if (!hasTransactionAmount && !dateValue && !descriptionValue && !referenceValue) {
    return true
  }

  if (!hasTransactionAmount && !typeValue) {
    return true
  }

  return false
}

function extractStructuredStatementRowsFromMatrix(rawRows: string[][]): StructuredStatementCsvRow[] {
  if (rawRows.length === 0) return []

  const headerRowIndex = rawRows.findIndex((rawRow) => {
    const headers = rawRow.map((cell) => normalizeCsvHeader(cell))
    const hasDate = rowHasAnyHeader(headers, STATEMENT_DATE_HEADERS)
    const hasAmount =
      rowHasAnyHeader(headers, STATEMENT_DEBIT_HEADERS) ||
      rowHasAnyHeader(headers, STATEMENT_CREDIT_HEADERS) ||
      rowHasAnyHeader(headers, STATEMENT_AMOUNT_HEADERS)
    const hasNarration =
      rowHasAnyHeader(headers, STATEMENT_DESCRIPTION_HEADERS) ||
      rowHasAnyHeader(headers, STATEMENT_REFERENCE_HEADERS) ||
      headers.includes(normalizeCsvHeader('Type'))

    return hasDate && hasAmount && hasNarration
  })

  if (headerRowIndex < 0) return []

  const headers = rawRows[headerRowIndex].map((cell) => normalizeCsvHeader(cell))

  return rawRows
    .slice(headerRowIndex + 1)
    .map((rawRow, index) => ({
      row: buildStructuredCsvRecord(headers, rawRow),
      rowNo: headerRowIndex + index + 2
    }))
    .filter(({ row }) => !shouldSkipStructuredStatementRow(row))
}

function extractStructuredStatementCsvRows(text: string): StructuredStatementCsvRow[] {
  const rawRows = parseCsvRows(text).map((row) => row.map((cell) => normalizeText(cell)))
  return extractStructuredStatementRowsFromMatrix(rawRows)
}

function extractInternalLedgerPdfRows(text: string): StructuredStatementCsvRow[] {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => normalizeText(line).replace(/\s+/g, ' '))
    .filter(Boolean)

  if (rawLines.length === 0) return []

  const repeatedTitleCandidate = rawLines[0]
  const repeatedTitle =
    repeatedTitleCandidate && rawLines.filter((line) => line === repeatedTitleCandidate).length > 1
      ? repeatedTitleCandidate
      : ''

  const lines = rawLines.filter((line) => {
    if (line === repeatedTitle) return false
    if (/^page \d+$/i.test(line)) return false
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)) return false
    return true
  })

  const typeHeaderIndex = lines.findIndex((line) => normalizeForCompare(line) === 'type date voucher no')
  const descriptionHeaderIndex = lines.findIndex((line) => normalizeForCompare(line) === 'particular')
  const amountHeaderIndex = lines.findIndex((line) => normalizeForCompare(line) === 'debit (rs) credit (rs) balance')

  if (typeHeaderIndex < 0 || descriptionHeaderIndex <= typeHeaderIndex || amountHeaderIndex <= descriptionHeaderIndex) {
    return []
  }

  const typeLines = lines
    .slice(typeHeaderIndex + 1, descriptionHeaderIndex)
    .filter((line) => normalizeForCompare(line) !== 'total')
  const descriptionLines = lines
    .slice(descriptionHeaderIndex + 1, amountHeaderIndex)
    .filter((line) => normalizeForCompare(line) !== 'total')
  const amountLines = lines
    .slice(amountHeaderIndex + 1)
    .filter((line) => normalizeForCompare(line) !== 'total')

  const transactionCount = Math.min(typeLines.length, descriptionLines.length, amountLines.length)
  if (transactionCount === 0) return []

  const rows: StructuredStatementCsvRow[] = []

  for (let index = 0; index < transactionCount; index += 1) {
    const typeLine = typeLines[index]
    const descriptionLine = descriptionLines[index]
    const amountLine = amountLines[index]

    const typeMatch = /^(.*?)\s+(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\s+(.*)$/.exec(typeLine)
    const amountMatch = /^(-|[\d,]+(?:\.\d{1,2})?)\s+(-|[\d,]+(?:\.\d{1,2})?)\s+(.+)$/.exec(amountLine)

    if (!typeMatch || !amountMatch) {
      return []
    }

    const [, typeValue, dateValue, voucherValue] = typeMatch
    const [, debitValue, creditValue, balanceValue] = amountMatch

    rows.push({
      rowNo: index + 2,
      row: {
        [normalizeCsvHeader('Type')]: normalizeText(typeValue),
        [normalizeCsvHeader('Date')]: normalizeText(dateValue),
        [normalizeCsvHeader('Voucher No')]: normalizeText(voucherValue) === '-' ? '' : normalizeText(voucherValue),
        [normalizeCsvHeader('Particular')]: normalizeText(descriptionLine),
        [normalizeCsvHeader('Debit (Rs)')]: normalizeText(debitValue) === '-' ? '' : normalizeText(debitValue),
        [normalizeCsvHeader('Credit (Rs)')]: normalizeText(creditValue) === '-' ? '' : normalizeText(creditValue),
        [normalizeCsvHeader('Balance')]: normalizeText(balanceValue)
      }
    })
  }

  return rows
}

function parseAmountValue(raw: string): number | null {
  const normalized = normalizeText(raw)
    .replace(/[,\s₹]/g, '')
    .replace(/cr$/i, '')
    .replace(/dr$/i, '')

  if (!normalized) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return Math.abs(parsed)
}

function isPlaceholderDateValue(value: string): boolean {
  return PLACEHOLDER_DATE_VALUES.has(normalizeForCompare(value))
}

function extractAmountMatchesFromLine(line: string): NumericLineMatch[] {
  const ignoredRanges = Array.from(line.matchAll(DATE_PATTERN)).map((match) => {
    const start = match.index ?? -1
    return [start, start + match[0].length] as const
  })

  return Array.from(line.matchAll(AMOUNT_PATTERN))
    .flatMap((match) => {
      const index = match.index ?? -1
      const parsedValue = parseAmountValue(match[0])
      if (index < 0 || parsedValue === null) {
        return []
      }

      return {
        raw: match[0],
        index,
        value: parsedValue
      }
    })
    .filter((match) => {
      if (!match.raw || match.index < 0) return false

      const insideIgnoredRange = ignoredRanges.some(([start, end]) => match.index >= start && match.index < end)
      if (insideIgnoredRange) return false

      const previousCharacter = line[match.index - 1] || ''
      const nextCharacter = line[match.index + match.raw.length] || ''
      const prefixSlice = line.slice(Math.max(0, match.index - 2), match.index)
      const suffixSlice = line.slice(match.index + match.raw.length, match.index + match.raw.length + 2)
      const hasUnsupportedPrefix = /[a-z]/i.test(previousCharacter) && !/^(?:cr|dr)$/i.test(prefixSlice)
      const hasUnsupportedSuffix = /[a-z]/i.test(nextCharacter) && !/^(?:cr|dr)$/i.test(suffixSlice)

      if (hasUnsupportedPrefix || hasUnsupportedSuffix) {
        return false
      }

      return true
    })
}

function looksLikeStatementHeaderLine(line: string): boolean {
  return TRANSACTION_HEADER_PATTERNS.some((pattern) => pattern.test(line))
}

function shouldIgnoreStatementLine(line: string): boolean {
  const normalized = normalizeText(line).replace(/\s+/g, ' ')
  if (!normalized) return true
  if (isPlaceholderDateValue(normalized)) return true
  if (looksLikeStatementHeaderLine(normalized)) return true
  return NON_TRANSACTION_TEXT_PATTERNS.some((pattern) => pattern.test(normalized))
}

function inferTrailingColumnAmount(line: string): { amount: number | null; direction: StatementDirection | null } {
  const numericMatches = extractAmountMatchesFromLine(line)
  if (numericMatches.length < 2) {
    return { amount: null, direction: null }
  }

  const trailingValues = numericMatches.slice(-3).map((match) => match.value)
  const candidateValues = (trailingValues.length >= 3 ? trailingValues.slice(0, 2) : trailingValues.slice(-2)).map((value) =>
    Number(value.toFixed(2))
  )

  if (candidateValues.length < 2) {
    return { amount: null, direction: null }
  }

  const [firstValue, secondValue] = candidateValues
  const firstIsZero = firstValue <= 0
  const secondIsZero = secondValue <= 0

  if (!firstIsZero && secondIsZero) {
    return { amount: firstValue, direction: 'out' }
  }

  if (firstIsZero && !secondIsZero) {
    return { amount: secondValue, direction: 'in' }
  }

  return { amount: null, direction: null }
}

function looksLikeTransactionStart(line: string): boolean {
  if (shouldIgnoreStatementLine(line)) return false

  const dateMatch = DATE_PATTERN.exec(line)
  if (!dateMatch || (dateMatch.index ?? 0) > 4) return false
  if (isPlaceholderDateValue(dateMatch[0])) return false
  if (!parseStatementDate(dateMatch[0])) return false

  const directionMatch = line.match(DIRECTION_PATTERN)
  const directAmount = chooseAmountFromLine(line, directionMatch)
  if (directAmount.amount && directAmount.direction) {
    return true
  }

  const inferredAmount = inferTrailingColumnAmount(line)
  return Boolean(inferredAmount.amount && inferredAmount.direction)
}

function shouldSkipStatementTextBlock(block: string): boolean {
  if (shouldIgnoreStatementLine(block)) return true

  const dateMatch = DATE_PATTERN.exec(block)
  if (!dateMatch || isPlaceholderDateValue(dateMatch[0]) || !parseStatementDate(dateMatch[0])) {
    return true
  }

  const directionMatch = block.match(DIRECTION_PATTERN)
  const directAmount = chooseAmountFromLine(block, directionMatch)
  if (directAmount.amount && directAmount.direction) {
    return false
  }

  const inferredAmount = inferTrailingColumnAmount(block)
  return !(inferredAmount.amount && inferredAmount.direction)
}

async function ensurePdfCanvasGlobals(): Promise<void> {
  if (pdfCanvasGlobalsReady) {
    return pdfCanvasGlobalsReady
  }

  pdfCanvasGlobalsReady = (async () => {
    const globalScope = globalThis as typeof globalThis
    const mutableGlobalScope = globalScope as any

    if (
      typeof globalScope.DOMMatrix !== 'undefined' &&
      typeof globalScope.ImageData !== 'undefined' &&
      typeof globalScope.Path2D !== 'undefined'
    ) {
      return
    }

    const canvasModule = await import('@napi-rs/canvas')

    if (typeof globalScope.DOMMatrix === 'undefined') {
      mutableGlobalScope.DOMMatrix = canvasModule.DOMMatrix
    }
    if (typeof globalScope.ImageData === 'undefined') {
      mutableGlobalScope.ImageData = canvasModule.ImageData
    }
    if (typeof globalScope.Path2D === 'undefined') {
      mutableGlobalScope.Path2D = canvasModule.Path2D
    }
  })()

  try {
    await pdfCanvasGlobalsReady
  } catch (error) {
    pdfCanvasGlobalsReady = null
    throw error
  }
}

async function getPdfParseModule(): Promise<PdfParseModule> {
  if (pdfParseModuleReady) {
    return pdfParseModuleReady
  }

  pdfParseModuleReady = (async () => {
    // Preload the pdf.js worker so fake-worker mode does not rely on a fragile bundled relative path.
    const workerModuleSpecifier = PDFJS_WORKER_MODULE_SPECIFIER
    await import(workerModuleSpecifier)

    const pdfParseModule = await import('pdf-parse')

    try {
      const requireFromApp = createRequire(`${process.cwd()}/package.json`)
      const workerPath = requireFromApp.resolve(PDFJS_WORKER_MODULE_SPECIFIER)
      pdfParseModule.PDFParse.setWorker(pathToFileURL(workerPath).href)
    } catch {
      // If path resolution fails in an environment, the preloaded worker above is still available.
    }

    return pdfParseModule
  })()

  try {
    return await pdfParseModuleReady
  } catch (error) {
    pdfParseModuleReady = null
    throw error
  }
}

function clearOcrWorkerIdleTimer() {
  if (!ocrWorkerIdleTimer) return
  clearTimeout(ocrWorkerIdleTimer)
  ocrWorkerIdleTimer = null
}

function scheduleOcrWorkerCleanup() {
  clearOcrWorkerIdleTimer()
  ocrWorkerIdleTimer = setTimeout(() => {
    const workerPromise = ocrWorkerReady
    ocrWorkerReady = null
    if (!workerPromise) return

    void workerPromise
      .then(async (worker) => {
        await worker.terminate()
      })
      .catch(() => {})
  }, OCR_WORKER_IDLE_TIMEOUT_MS)

  ocrWorkerIdleTimer.unref?.()
}

async function getSharedOcrWorker(): Promise<TesseractWorker> {
  clearOcrWorkerIdleTimer()

  if (!ocrWorkerReady) {
    ocrWorkerReady = (async () => {
      const tesseractModule = await import('tesseract.js')
      const requireFromApp = createRequire(import.meta.url)
      const workerOptions: Record<string, unknown> = {
        logger: () => undefined
      }

      try {
        workerOptions.workerPath = requireFromApp.resolve(TESSERACT_NODE_WORKER_SPECIFIER)
      } catch {
        // Fall back to tesseract.js default worker resolution if explicit resolution is unavailable.
      }

      const worker = await tesseractModule.createWorker('eng', tesseractModule.OEM.LSTM_ONLY, workerOptions)

      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: tesseractModule.PSM.SINGLE_BLOCK
      })

      return worker
    })()
  }

  try {
    return await ocrWorkerReady
  } catch (error) {
    ocrWorkerReady = null
    throw error
  }
}

async function optimizeImageBufferForOcr(buffer: Buffer): Promise<Buffer> {
  try {
    const canvasModule = await import('@napi-rs/canvas')
    const image = await canvasModule.loadImage(buffer)

    const sourceWidth = Math.max(1, Math.round(Number(image.width || 0)))
    const sourceHeight = Math.max(1, Math.round(Number(image.height || 0)))
    if (!sourceWidth || !sourceHeight) return buffer

    const longestEdge = Math.max(sourceWidth, sourceHeight)
    const totalPixels = sourceWidth * sourceHeight
    const edgeScale = OCR_MAX_IMAGE_EDGE_PX / longestEdge
    const areaScale = Math.sqrt(OCR_MAX_IMAGE_PIXELS / totalPixels)
    const scale = Math.min(1, edgeScale, areaScale)

    if (scale >= 0.995) {
      return buffer
    }

    const targetWidth = Math.max(1, Math.round(sourceWidth * scale))
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = canvasModule.createCanvas(targetWidth, targetHeight)
    const context = canvas.getContext('2d')

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.filter = 'grayscale(1) contrast(1.08)'
    context.drawImage(image, 0, 0, targetWidth, targetHeight)

    return canvas.toBuffer('image/jpeg', 0.82)
  } catch (error) {
    console.warn('[bank-statements] image optimization skipped', {
      message: error instanceof Error ? error.message : String(error)
    })
    return buffer
  }
}

async function writeOcrTempImage(buffer: Buffer) {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'mbill-ocr-'))
  const fingerprint = createHash('sha1').update(buffer).digest('hex').slice(0, 16)
  const filePath = path.join(tempDirectory, `${fingerprint}.jpg`)

  await writeFile(filePath, buffer)

  return {
    filePath,
    cleanup: async () => {
      await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

async function recognizeTextWithSharedOcrWorker(buffer: Buffer): Promise<string> {
  const task = ocrWorkerQueue.then(async () => {
    const worker = await getSharedOcrWorker()
    const tempImage = await writeOcrTempImage(buffer)

    try {
      const result = await worker.recognize(tempImage.filePath)
      return normalizeText(result.data?.text || '')
    } finally {
      await tempImage.cleanup()
    }
  })

  ocrWorkerQueue = task.then(() => undefined, () => undefined)

  try {
    return await task
  } finally {
    scheduleOcrWorkerCleanup()
  }
}

function parseStatementDate(raw: string): string | null {
  const normalized = normalizeText(raw)
  if (!normalized) return null

  if (/^\d{4}-\d{2}-\d{2}/.test(normalized)) {
    return normalized.slice(0, 10)
  }

  const slashParts = normalized.split(/[\/.-]/).map((part) => part.trim()).filter(Boolean)
  if (slashParts.length === 3 && slashParts.every((part) => /^\d+$/.test(part))) {
    let day = 0
    let month = 0
    let year = 0

    if (slashParts[0].length === 4) {
      year = Number(slashParts[0])
      month = Number(slashParts[1])
      day = Number(slashParts[2])
    } else {
      day = Number(slashParts[0])
      month = Number(slashParts[1])
      year = Number(slashParts[2])
      if (year < 100) year += 2000
    }

    const candidate = new Date(Date.UTC(year, month - 1, day))
    if (
      Number.isFinite(candidate.getTime()) &&
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === day
    ) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  const parsed = new Date(normalized)
  if (!Number.isFinite(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function buildExternalId(bankId: string, entry: Omit<ParsedStatementEntry, 'externalId'>): string {
  const hash = createHash('sha1')
    .update(
      [
        bankId,
        entry.postedAt,
        entry.amount.toFixed(2),
        entry.direction,
        normalizeForCompare(entry.reference),
        normalizeForCompare(entry.description)
      ].join('|')
    )
    .digest('hex')
    .slice(0, 24)

  return `bankstmt:${bankId}:${hash}`
}

function parseStatementRow(
  row: Record<string, string>,
  rowNo: number,
  bankId: string
): ParsedStatementResult {
  const postedAt =
    parseStatementDate(
      getCsvValue(row, ['Date', 'Txn Date', 'Transaction Date', 'Posted Date', 'Value Date', 'Entry Date'])
    )

  if (!postedAt) {
    return { rowNo, reason: 'Invalid or missing transaction date' }
  }

  const debitAmount = parseAmountValue(
    getCsvValue(row, ['Debit', 'Withdrawal', 'Debit Amount', 'Dr Amount', 'Dr', 'Withdrawals', 'Debit (Rs)'])
  )
  const creditAmount = parseAmountValue(
    getCsvValue(row, ['Credit', 'Deposit', 'Credit Amount', 'Cr Amount', 'Cr', 'Deposits', 'Credit (Rs)'])
  )

  let amount: number | null = null
  let direction: StatementDirection | null = null

  if ((debitAmount || 0) > 0) {
    amount = debitAmount
    direction = 'out'
  } else if ((creditAmount || 0) > 0) {
    amount = creditAmount
    direction = 'in'
  } else {
    const signedAmount = Number(
      normalizeText(getCsvValue(row, ['Amount', 'Txn Amount', 'Transaction Amount', 'Amount (Rs)'])).replace(/[,\s₹]/g, '')
    )
    const directionRaw = normalizeForCompare(getCsvValue(row, ['Direction', 'Type', 'Txn Type']))

    if (Number.isFinite(signedAmount) && signedAmount !== 0) {
      amount = Math.abs(signedAmount)
      if (directionRaw.includes('debit') || directionRaw.includes('withdraw') || directionRaw === 'dr' || signedAmount < 0) {
        direction = 'out'
      } else if (directionRaw.includes('credit') || directionRaw.includes('deposit') || directionRaw === 'cr' || signedAmount > 0) {
        direction = 'in'
      }
    }
  }

  if (!amount || !direction) {
    return { rowNo, reason: 'Could not determine debit / credit amount' }
  }

  const description = normalizeText(
    getCsvValue(row, ['Description', 'Narration', 'Particular', 'Particulars', 'Details', 'Remarks', 'Remark'])
  )
  const reference = normalizeText(
    getCsvValue(row, ['Reference', 'Txn Ref', 'Transaction Ref', 'UTR', 'Ref No', 'Cheque No', 'Chq No', 'Voucher No'])
  ) || null

  const entryBase = {
    rowNo,
    postedAt,
    amount,
    direction,
    description,
    reference
  }

  return {
    ...entryBase,
    externalId: buildExternalId(bankId, entryBase)
  }
}

function normalizeWorksheetRow(row: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [String(key || '').trim(), normalizeText(value)])
  )
}

function chooseAmountFromLine(
  line: string,
  directionMatch: RegExpMatchArray | null
): { amount: number | null; direction: StatementDirection | null } {
  const amountMatches = extractAmountMatchesFromLine(line)
  if (amountMatches.length === 0) {
    return { amount: null, direction: null }
  }

  const normalizedLine = normalizeForCompare(line)
  const directionToken = directionMatch?.[0] ? normalizeForCompare(directionMatch[0]) : ''
  let direction: StatementDirection | null = null

  if (directionToken) {
    if (directionToken.startsWith('cr') || directionToken.includes('credit') || directionToken.includes('deposit') || directionToken.includes('receipt')) {
      direction = 'in'
    } else if (directionToken.startsWith('dr') || directionToken.includes('debit') || directionToken.includes('withdraw') || directionToken.includes('payment')) {
      direction = 'out'
    }
  }

  if (!direction) {
    if (normalizedLine.includes(' credited ') || normalizedLine.includes(' received ')) {
      direction = 'in'
    } else if (normalizedLine.includes(' debited ') || normalizedLine.includes(' paid ') || normalizedLine.includes(' withdrawn ')) {
      direction = 'out'
    }
  }

  if (!direction) {
    const inferredFromColumns = inferTrailingColumnAmount(line)
    if (inferredFromColumns.amount && inferredFromColumns.direction) {
      return inferredFromColumns
    }

    return { amount: null, direction: null }
  }

  const directionIndex = directionMatch?.index ?? -1
  const directionEnd = directionIndex >= 0 ? directionIndex + (directionMatch?.[0]?.length || 0) : -1
  let preferredAmount = amountMatches[0]?.raw || ''

  if (directionIndex >= 0) {
    const beforeDirection = amountMatches.filter((match) => match.index < directionIndex && match.value > 0)
    const afterDirection = amountMatches.filter((match) => match.index >= directionEnd && match.value > 0)
    const nearestBefore = beforeDirection.at(-1) || null
    const nearestAfter = afterDirection[0] || null

    if (nearestBefore && nearestAfter) {
      const beforeDistance = Math.max(0, directionIndex - (nearestBefore.index + nearestBefore.raw.length))
      const afterDistance = Math.max(0, nearestAfter.index - directionEnd)
      preferredAmount = beforeDistance <= afterDistance ? nearestBefore.raw : nearestAfter.raw
    } else {
      preferredAmount = nearestBefore?.raw || nearestAfter?.raw || preferredAmount
    }
  } else if (amountMatches.length > 1) {
    preferredAmount = amountMatches[0]?.raw || preferredAmount
  }

  return {
    amount: parseAmountValue(preferredAmount),
    direction
  }
}

function extractReferenceFromLine(line: string): string | null {
  const referencePatterns = [
    /(?:utr|txn(?:\.|\s)?id|transaction(?: id| ref(?:erence)?)|rrn|ref(?:erence)?|cheque(?: no)?|chq(?: no)?|upi|imps|neft|rtgs)[\s:./-]*([a-z0-9/-]{4,})/i,
    /\b([a-z]{2,}[0-9]{4,}|[0-9]{6,}[a-z0-9-]{2,})\b/i
  ]

  for (const pattern of referencePatterns) {
    const match = pattern.exec(line)
    const candidate = normalizeText(match?.[1] || '')
    if (candidate.length >= 4) return candidate
  }

  return null
}

function cleanStatementDescription(line: string): string {
  const cleaned = normalizeText(line)
    .replace(/\s+/g, ' ')
    .replace(DATE_PATTERN, ' ')
    .replace(/\s+\b(?:cr|credit|dr|debit)\b\s*/gi, ' ')
    .replace(/(?:\s+-?\d[\d,]*(?:\.\d{1,2})?){1,3}\s*$/g, ' ')
    .trim()

  return cleaned || normalizeText(line).replace(/\s+/g, ' ')
}

function groupStatementTextBlocks(text: string): string[] {
  const sourceLines = text
    .split(/\r?\n/)
    .map((line) => normalizeText(line).replace(/\s+/g, ' '))
    .filter(Boolean)

  const blocks: string[] = []
  let current = ''

  for (const line of sourceLines) {
    if (shouldIgnoreStatementLine(line)) {
      continue
    }

    const startsNewBlock = looksLikeTransactionStart(line)

    if (!current) {
      if (startsNewBlock) {
        current = line
      }
      continue
    }

    if (startsNewBlock) {
      blocks.push(current)
      current = line
      continue
    }

    current = `${current} ${line}`.trim()
  }

  if (current) {
    blocks.push(current)
  }

  return blocks.filter((block) => !shouldSkipStatementTextBlock(block))
}

function parseStatementTextBlock(block: string, rowNo: number, bankId: string): ParsedStatementResult {
  const dateMatch = DATE_PATTERN.exec(block)
  const rawDate = normalizeText(dateMatch?.[0] || '')
  const postedAt = parseStatementDate(rawDate)

  if (!postedAt) {
    return { rowNo, reason: 'Invalid or missing transaction date' }
  }

  const directionMatch = block.match(DIRECTION_PATTERN)
  const resolvedAmount = chooseAmountFromLine(block, directionMatch)
  const inferredAmount = (!resolvedAmount.amount || !resolvedAmount.direction) ? inferTrailingColumnAmount(block) : null
  const amount = resolvedAmount.amount ?? inferredAmount?.amount ?? null
  const direction = resolvedAmount.direction ?? inferredAmount?.direction ?? null
  if (!amount || !direction) {
    return { rowNo, reason: 'Could not determine debit / credit amount' }
  }

  const reference = extractReferenceFromLine(block)
  const entryBase = {
    rowNo,
    postedAt,
    amount,
    direction,
    description: cleanStatementDescription(block),
    reference
  }

  return {
    ...entryBase,
    externalId: buildExternalId(bankId, entryBase)
  }
}

async function parseExcelStatement(buffer: Buffer, bankId: string): Promise<ParsedStatementResult[]> {
  const xlsxModule = await import('xlsx')
  const workbook = xlsxModule.read(buffer, { type: 'buffer', cellDates: false, raw: false })
  if (workbook.SheetNames.length === 0) {
    throw new Error('Excel statement does not contain any worksheet')
  }

  const fallbackTexts: string[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const rawRows = xlsxModule.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false
    }) as Array<Array<string | number | null>>

    if (rawRows.length === 0) {
      continue
    }

    const structuredRows = extractStructuredStatementRowsFromMatrix(
      rawRows.map((row) => row.map((cell) => normalizeText(cell)))
    )
    if (structuredRows.length > 0) {
      return structuredRows.map(({ row, rowNo }) => parseStatementRow(row, rowNo, bankId))
    }

    const fallbackText = normalizeText(xlsxModule.utils.sheet_to_csv(sheet))
    if (fallbackText) {
      fallbackTexts.push(fallbackText)
    }
  }

  const combinedFallbackText = fallbackTexts.join('\n')
  if (!combinedFallbackText) {
    throw new Error('Uploaded Excel statement is empty')
  }

  return parseTextStatement(combinedFallbackText, bankId)
}

async function extractPdfText(buffer: Buffer): Promise<ExtractedStatementText> {
  await ensurePdfCanvasGlobals()
  const pdfParseModule = await getPdfParseModule()
  const parser = new pdfParseModule.PDFParse({ data: buffer })

  try {
    const parsed = await parser.getText()

    return {
      text: normalizeText(parsed.text || ''),
      pageCount: Number(parsed.total || parsed.pages.length || 0)
    }
  } finally {
    await parser.destroy()
  }
}

async function recognizeTextFromImages(buffers: Buffer[]): Promise<string> {
  const pageTexts: string[] = []

  for (const buffer of buffers) {
    if (!buffer || buffer.length === 0) continue
    const text = await recognizeTextWithSharedOcrWorker(buffer)
    if (text) {
      pageTexts.push(text)
    }
  }

  return pageTexts.join('\n\n')
}

async function extractPdfOcrText(buffer: Buffer): Promise<ExtractedStatementText> {
  await ensurePdfCanvasGlobals()
  const pdfParseModule = await getPdfParseModule()
  const parser = new pdfParseModule.PDFParse({ data: buffer })

  try {
    const screenshots = await parser.getScreenshot({
      desiredWidth: 1400,
      imageBuffer: true,
      imageDataUrl: false
    })

    const pageBuffers = (screenshots.pages || []).flatMap((page) => {
      const bytes = page?.data
      if (!bytes || bytes.length === 0) {
        return []
      }
      return [Buffer.from(bytes)]
    })

    return {
      text: await recognizeTextFromImages(pageBuffers),
      pageCount: Number(screenshots.total || pageBuffers.length || 0)
    }
  } finally {
    await parser.destroy()
  }
}

async function extractImageText(buffer: Buffer): Promise<string> {
  const optimizedBuffer = await optimizeImageBufferForOcr(buffer)
  return recognizeTextFromImages([optimizedBuffer])
}

async function parseTextStatement(text: string, bankId: string): Promise<ParsedStatementResult[]> {
  const structuredCsvRows = extractStructuredStatementCsvRows(text)
  if (structuredCsvRows.length > 0) {
    return structuredCsvRows.map(({ row, rowNo }) => parseStatementRow(row, rowNo, bankId))
  }

  const internalLedgerPdfRows = extractInternalLedgerPdfRows(text)
  if (internalLedgerPdfRows.length > 0) {
    return internalLedgerPdfRows.map(({ row, rowNo }) => parseStatementRow(row, rowNo, bankId))
  }

  const csvRows = parseCsvObjects(text).filter((row) => !shouldSkipStructuredStatementRow(row))
  if (csvRows.length > 0 && Object.keys(csvRows[0] || {}).length > 1) {
    return csvRows.map((row, index) => parseStatementRow(row, index + 2, bankId))
  }

  const blocks = groupStatementTextBlocks(text)
  if (blocks.length === 0) {
    throw new Error('Could not detect any transaction rows in the uploaded statement')
  }

  return blocks.map((block, index) => parseStatementTextBlock(block, index + 1, bankId))
}

export async function parseBankStatementFile(file: File, bankId: string): Promise<{
  document: StatementDocumentMeta
  entries: ParsedStatementResult[]
}> {
  const kind = detectDocumentKind(file)
  if (!kind) {
    throw new Error('Unsupported statement file. Upload CSV, Excel, PDF, TXT, or image file.')
  }

  if (!bankId) {
    throw new Error('Bank is required to parse the statement')
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  switch (kind) {
    case 'csv': {
      const text = normalizeText(await file.text())
      const structuredCsvRows = extractStructuredStatementCsvRows(text)
      const rows = structuredCsvRows.length > 0
        ? structuredCsvRows
        : parseCsvObjects(text)
            .filter((row) => !shouldSkipStructuredStatementRow(row))
            .map((row, index) => ({ row, rowNo: index + 2 }))

      if (rows.length === 0) {
        throw new Error('Uploaded CSV statement is empty')
      }

      return {
        document: {
          kind,
          parser: 'CSV table parser',
          fileName: file.name,
          recognitionMode: 'structured',
          note:
            structuredCsvRows.length > 0
              ? 'Detected the exported ledger table and read rows directly from the uploaded CSV file.'
              : 'Rows were read directly from the uploaded CSV file.'
        },
        entries: rows.map(({ row, rowNo }) => parseStatementRow(row, rowNo, bankId))
      }
    }

    case 'excel':
      return {
        document: {
          kind,
          parser: 'Excel worksheet parser',
          fileName: file.name,
          recognitionMode: 'structured',
          note: 'Rows were read directly from the uploaded worksheet.'
        },
        entries: await parseExcelStatement(buffer, bankId)
      }

    case 'pdf': {
      const pdfTextResult = await extractPdfText(buffer)
      const pdfText = pdfTextResult.text

      if (pdfText) {
        try {
          return {
            document: {
              kind,
              parser: 'PDF text parser',
              fileName: file.name,
              recognitionMode: 'text',
              pageCount: pdfTextResult.pageCount,
              note: 'This PDF included readable text, so rows were parsed directly from the document.'
            },
            entries: await parseTextStatement(pdfText, bankId)
          }
        } catch {
          // Fall back to OCR for scanned/poorly structured PDFs that have text but no readable rows.
        }
      }

      const pdfOcrResult = await extractPdfOcrText(buffer)
      if (!pdfOcrResult.text) {
        throw new Error(
          'This PDF could not be recognized into readable statement rows. Upload a clearer PDF/image or use CSV/Excel for the fastest result.'
        )
      }

      return {
        document: {
          kind,
          parser: pdfText ? 'PDF OCR fallback parser' : 'PDF OCR parser',
          fileName: file.name,
          recognitionMode: 'ocr',
          pageCount: pdfOcrResult.pageCount || pdfTextResult.pageCount,
          note: pdfText
            ? 'The PDF text was not structured enough for statement rows, so OCR scan was used automatically.'
            : 'This scanned PDF was recognized using OCR page scanning.'
        },
        entries: await parseTextStatement(pdfOcrResult.text, bankId)
      }
    }

    case 'image': {
      const text = await extractImageText(buffer)
      if (!text) {
        throw new Error('Could not recognize text from statement image')
      }

      return {
        document: {
          kind,
          parser: 'OCR image parser',
          fileName: file.name,
          recognitionMode: 'ocr',
          pageCount: 1,
          note: 'The uploaded image was scanned with OCR to detect statement rows.'
        },
        entries: await parseTextStatement(text, bankId)
      }
    }

    case 'text': {
      const text = normalizeText(await file.text())
      if (!text) {
        throw new Error('Uploaded statement text file is empty')
      }

      return {
        document: {
          kind,
          parser: 'Plain text parser',
          fileName: file.name,
          recognitionMode: 'text',
          note: 'Rows were read directly from the uploaded text file.'
        },
        entries: await parseTextStatement(text, bankId)
      }
    }
  }
}

export function inferStatementPaymentMode(entry: Pick<ParsedStatementEntry, 'description' | 'reference'>): string {
  const haystack = normalizeForCompare(`${entry.description} ${entry.reference || ''}`)

  if (
    haystack.includes('upi') ||
    haystack.includes('gpay') ||
    haystack.includes('google pay') ||
    haystack.includes('phonepe') ||
    haystack.includes('paytm') ||
    haystack.includes('bharatpe') ||
    haystack.includes('qr')
  ) {
    return 'UPI'
  }

  if (haystack.includes('rtgs')) return 'RTGS'
  if (haystack.includes('neft')) return 'NEFT'
  if (haystack.includes('cheque') || haystack.includes('chq') || haystack.includes('check')) return 'CHEQUE'
  if (haystack.includes('imps') || haystack.includes('transfer') || haystack.includes('netbanking') || haystack.includes('online')) {
    return 'NEFT'
  }

  return 'NEFT'
}
