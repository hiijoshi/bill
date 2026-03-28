import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess } from '@/lib/api-security'
import { cleanString, normalizeTenDigitPhone } from '@/lib/field-validation'
import {
  normalizePartyOpeningBalanceAmount,
  normalizePartyOpeningBalanceType,
} from '@/lib/party-opening-balance'
import { ensurePartyOpeningBalanceSchema } from '@/lib/party-opening-balance-schema'

type PartyImportRow = Record<string, string>

const normalizeHeader = (value: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

const parseCsvRows = (text: string): string[][] => {
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

const parseCsvObjects = (text: string): PartyImportRow[] => {
  const rows = parseCsvRows(text)
  if (rows.length === 0) return []

  const headers = rows[0].map((header) => normalizeHeader(header))
  return rows.slice(1).map((row) => {
    const record: PartyImportRow = {}
    headers.forEach((header, index) => {
      if (!header) return
      record[header] = String(row[index] || '').trim()
    })
    return record
  })
}

const getRecordValue = (record: PartyImportRow, keys: string[]): string => {
  for (const key of keys) {
    const value = record[normalizeHeader(key)]
    if (value) return value.trim()
  }
  return ''
}

const parseOptionalDate = (value: string): Date | null => {
  const normalized = String(value || '').trim()
  if (!normalized) return null

  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    return new Date(Number(year), Number(month) - 1, Number(day))
  }

  const indianMatch = normalized.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/)
  if (indianMatch) {
    const [, day, month, year] = indianMatch
    return new Date(Number(year), Number(month) - 1, Number(day))
  }

  const parsed = new Date(normalized)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

const normalizeOptionalNumber = (value: string): number | null => {
  if (!String(value || '').trim()) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, parsed)
}

export async function POST(request: NextRequest) {
  try {
    await ensurePartyOpeningBalanceSchema(prisma)

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')?.trim() || ''

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'CSV file is required' }, { status: 400 })
    }

    const rows = parseCsvObjects(await file.text())
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Uploaded CSV is empty' }, { status: 400 })
    }

    let imported = 0
    let updated = 0
    let skipped = 0
    const errorDetails: string[] = []

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const rowNumber = index + 2

      const name = getRecordValue(row, ['Name', 'Party Name'])
      if (!name) {
        skipped += 1
        continue
      }

      const typeValue = getRecordValue(row, ['Type', 'Party Type']).toLowerCase()
      const type = typeValue === 'farmer' ? 'farmer' : 'buyer'
      const phone1Raw = getRecordValue(row, ['Phone1', 'Primary Phone', 'Phone'])
      const phone2Raw = getRecordValue(row, ['Phone2', 'Secondary Phone'])
      const phone1 = phone1Raw ? normalizeTenDigitPhone(phone1Raw) : null
      const phone2 = phone2Raw ? normalizeTenDigitPhone(phone2Raw) : null

      if (phone1Raw && !phone1) {
        errorDetails.push(`Row ${rowNumber}: Primary phone must be exactly 10 digits`)
        continue
      }

      if (phone2Raw && !phone2) {
        errorDetails.push(`Row ${rowNumber}: Secondary phone must be exactly 10 digits`)
        continue
      }

      const partyData = {
        companyId,
        type,
        name,
        address: cleanString(getRecordValue(row, ['Address'])),
        phone1,
        phone2,
        openingBalance: normalizePartyOpeningBalanceAmount(
          getRecordValue(row, ['OpeningBalance', 'Opening Principal', 'OpeningPrincipal'])
        ),
        openingBalanceType: normalizePartyOpeningBalanceType(
          getRecordValue(row, ['OpeningBalanceType', 'Opening Principal Type', 'OpeningPrincipalType'])
        ),
        openingBalanceDate: parseOptionalDate(
          getRecordValue(row, ['OpeningBalanceDate', 'Opening Date', 'OpeningDate'])
        ),
        creditLimit: normalizeOptionalNumber(getRecordValue(row, ['CreditLimit', 'Credit Limit'])),
        creditDays: normalizeOptionalNumber(getRecordValue(row, ['CreditDays', 'Credit Days'])),
        bankName: cleanString(getRecordValue(row, ['BankName', 'Bank Name'])),
        accountNo: cleanString(getRecordValue(row, ['AccountNo', 'Account Number'])),
        ifscCode: cleanString(getRecordValue(row, ['IFSCCode', 'IFSC Code']))?.toUpperCase() || null,
      }

      const existing = await prisma.party.findFirst({
        where: {
          companyId,
          type,
          name
        },
        select: {
          id: true
        }
      })

      if (existing) {
        await prisma.party.update({
          where: { id: existing.id },
          data: partyData
        })
        updated += 1
      } else {
        await prisma.party.create({
          data: partyData
        })
        imported += 1
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      updated,
      skipped,
      errors: errorDetails.length,
      errorDetails
    })
  } catch (error) {
    console.error('Error importing parties:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
