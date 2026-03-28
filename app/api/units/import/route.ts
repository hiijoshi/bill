import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess } from '@/lib/api-security'
import { cleanString } from '@/lib/field-validation'
import { getCsvValue, parseCsvObjects, parseCsvOptionalNumber } from '@/lib/master-csv'
import { resolveCompanyIdFromRequest } from '@/lib/request-company'

const RESERVED_UNITS = new Set(['kg', 'qt'])

export async function POST(request: NextRequest) {
  try {
    const companyId = resolveCompanyIdFromRequest(request)
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

    const existingUnits = await prisma.unit.findMany({
      where: { companyId },
      select: { id: true, symbol: true, isUniversal: true }
    })
    const existingMap = new Map(
      existingUnits.map((unit) => [unit.symbol.trim().toLowerCase(), { id: unit.id, isUniversal: unit.isUniversal }])
    )

    let imported = 0
    let updated = 0
    let skipped = 0
    const errorDetails: string[] = []

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const rowNumber = index + 2
      const name = getCsvValue(row, ['Name', 'Unit Name'])
      const symbol = getCsvValue(row, ['Symbol', 'Unit Symbol']).toLowerCase()

      if (!name || !symbol) {
        skipped += 1
        continue
      }

      if (RESERVED_UNITS.has(symbol)) {
        errorDetails.push(`Row ${rowNumber}: ${symbol} is a system-managed universal unit and cannot be imported`)
        continue
      }

      const kgEquivalentRaw = getCsvValue(row, ['KGEquivalent', 'KG Equivalent'])
      const kgEquivalent = parseCsvOptionalNumber(kgEquivalentRaw)
      if (kgEquivalent === null || kgEquivalent <= 0) {
        errorDetails.push(`Row ${rowNumber}: KG equivalent must be greater than zero for unit "${name}"`)
        continue
      }

      const data = {
        companyId,
        name,
        symbol,
        kgEquivalent,
        isUniversal: false,
        description: cleanString(getCsvValue(row, ['Description']))
      }

      const existing = existingMap.get(symbol)
      if (existing?.isUniversal) {
        errorDetails.push(`Row ${rowNumber}: ${symbol} is a locked universal unit and cannot be updated`)
        continue
      }

      if (existing?.id) {
        await prisma.unit.update({
          where: { id: existing.id },
          data
        })
        updated += 1
      } else {
        const created = await prisma.unit.create({ data })
        existingMap.set(symbol, { id: created.id, isUniversal: false })
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
    console.error('Error importing units:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

