export type CsvImportRow = Record<string, string>

export const normalizeCsvHeader = (value: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

export const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentValue = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChar = text[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentValue)
      currentValue = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1
      }
      currentRow.push(currentValue)
      if (currentRow.some((cell) => cell.trim() !== '')) {
        rows.push(currentRow.map((cell) => cell.trim()))
      }
      currentRow = []
      currentValue = ''
      continue
    }

    currentValue += char
  }

  if (currentValue || currentRow.length > 0) {
    currentRow.push(currentValue)
    if (currentRow.some((cell) => cell.trim() !== '')) {
      rows.push(currentRow.map((cell) => cell.trim()))
    }
  }

  return rows
}

export const parseCsvObjects = (text: string): CsvImportRow[] => {
  const rows = parseCsvRows(text)
  if (rows.length === 0) return []

  const headers = rows[0].map((header) => normalizeCsvHeader(header))
  return rows.slice(1).map((row) => {
    const record: CsvImportRow = {}
    headers.forEach((header, index) => {
      if (!header) return
      record[header] = String(row[index] || '').trim()
    })
    return record
  })
}

export const getCsvValue = (record: CsvImportRow, keys: string[]): string => {
  for (const key of keys) {
    const value = record[normalizeCsvHeader(key)]
    if (value) {
      return value.trim()
    }
  }
  return ''
}

export const parseCsvBoolean = (value: string, fallback = true): boolean => {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return fallback
  if (['true', '1', 'yes', 'y', 'active', 'enabled'].includes(normalized)) return true
  if (['false', '0', 'no', 'n', 'inactive', 'disabled'].includes(normalized)) return false
  return fallback
}

export const parseCsvOptionalNumber = (value: string): number | null => {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

