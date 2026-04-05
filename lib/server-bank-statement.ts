import 'server-only'

import { createHash } from 'crypto'

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

let pdfCanvasGlobalsReady: Promise<void> | null = null

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

function shouldSkipStructuredStatementRow(row: CsvImportRow): boolean {
  const values = Object.values(row).map((value) => normalizeText(value)).filter(Boolean)
  if (values.length === 0) return true

  const typeValue = normalizeForCompare(getCsvValue(row, ['Type']))
  const descriptionValue = normalizeForCompare(
    getCsvValue(row, ['Description', 'Narration', 'Particular', 'Particulars', 'Details', 'Remarks', 'Remark'])
  )
  const dateValue = normalizeText(getCsvValue(row, ['Date', 'Txn Date', 'Transaction Date', 'Posted Date', 'Value Date', 'Entry Date']))

  if (!dateValue && (typeValue === 'total' || descriptionValue === 'total')) {
    return true
  }

  return false
}

function extractStructuredStatementCsvRows(text: string): StructuredStatementCsvRow[] {
  const rawRows = parseCsvRows(text)
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
  const amountMatches = Array.from(line.matchAll(AMOUNT_PATTERN))
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
    return { amount: null, direction: null }
  }

  const directionIndex = directionMatch?.index ?? -1
  let preferredAmount = amountMatches[0]?.[0] || ''

  if (directionIndex >= 0) {
    const beforeDirection = amountMatches.filter((match) => (match.index ?? 0) < directionIndex)
    const afterDirection = amountMatches.filter((match) => (match.index ?? 0) > directionIndex)
    preferredAmount = beforeDirection.at(-1)?.[0] || afterDirection[0]?.[0] || preferredAmount
  } else if (amountMatches.length > 1) {
    preferredAmount = amountMatches[0]?.[0] || preferredAmount
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
  return normalizeText(line)
    .replace(/\s+/g, ' ')
    .replace(/\s+\b(?:cr|credit|dr|debit)\b\s*/gi, ' ')
    .trim()
}

function groupStatementTextBlocks(text: string): string[] {
  const sourceLines = text
    .split(/\r?\n/)
    .map((line) => normalizeText(line).replace(/\s+/g, ' '))
    .filter(Boolean)

  const blocks: string[] = []
  let current = ''

  for (const line of sourceLines) {
    const dateMatch = DATE_PATTERN.exec(line)
    const startsNewBlock = Boolean(dateMatch && (dateMatch.index ?? 0) <= 4)

    if (!current) {
      current = line
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

  return blocks
}

function parseStatementTextBlock(block: string, rowNo: number, bankId: string): ParsedStatementResult {
  const dateMatch = DATE_PATTERN.exec(block)
  const rawDate = normalizeText(dateMatch?.[0] || '')
  const postedAt = parseStatementDate(rawDate)

  if (!postedAt) {
    return { rowNo, reason: 'Invalid or missing transaction date' }
  }

  const directionMatch = block.match(DIRECTION_PATTERN)
  const { amount, direction } = chooseAmountFromLine(block, directionMatch)
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
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error('Excel statement does not contain any worksheet')
  }

  const sheet = workbook.Sheets[firstSheetName]
  const rows = xlsxModule.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  if (rows.length === 0) {
    throw new Error('Uploaded Excel statement is empty')
  }

  return rows.map((row, index) => parseStatementRow(normalizeWorksheetRow(row), index + 2, bankId))
}

async function extractPdfText(buffer: Buffer): Promise<ExtractedStatementText> {
  await ensurePdfCanvasGlobals()
  const pdfParseModule = await import('pdf-parse')
  const parser = new pdfParseModule.PDFParse({ data: buffer })

  try {
    const [info, parsed] = await Promise.all([
      parser.getInfo(),
      parser.getText()
    ])

    return {
      text: normalizeText(parsed.text || ''),
      pageCount: Number(info.total || 0)
    }
  } finally {
    await parser.destroy()
  }
}

async function recognizeTextFromImages(buffers: Buffer[]): Promise<string> {
  const tesseractModule = await import('tesseract.js')
  const worker = await tesseractModule.createWorker('eng')

  try {
    const pageTexts: string[] = []

    for (const buffer of buffers) {
      if (!buffer || buffer.length === 0) continue
      const result = await worker.recognize(buffer)
      const text = normalizeText(result.data?.text || '')
      if (text) {
        pageTexts.push(text)
      }
    }

    return pageTexts.join('\n\n')
  } finally {
    await worker.terminate()
  }
}

async function extractPdfOcrText(buffer: Buffer): Promise<ExtractedStatementText> {
  await ensurePdfCanvasGlobals()
  const pdfParseModule = await import('pdf-parse')
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
  return recognizeTextFromImages([buffer])
}

async function parseTextStatement(text: string, bankId: string): Promise<ParsedStatementResult[]> {
  const structuredCsvRows = extractStructuredStatementCsvRows(text)
  if (structuredCsvRows.length > 0) {
    return structuredCsvRows.map(({ row, rowNo }) => parseStatementRow(row, rowNo, bankId))
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
