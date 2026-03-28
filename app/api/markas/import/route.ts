import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess } from '@/lib/api-security'
import { cleanString } from '@/lib/field-validation'
import { getCsvValue, parseCsvBoolean, parseCsvObjects } from '@/lib/master-csv'
import { resolveCompanyIdFromRequest } from '@/lib/request-company'

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

    const existingMarkas = await prisma.marka.findMany({
      where: { companyId },
      select: { id: true, markaNumber: true }
    })
    const existingMap = new Map(
      existingMarkas.map((marka) => [marka.markaNumber.trim().toUpperCase(), marka.id])
    )

    let imported = 0
    let updated = 0
    let skipped = 0
    const errorDetails: string[] = []

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const markaNumber = getCsvValue(row, ['MarkaNumber', 'Marka Number', 'Name']).toUpperCase()

      if (!markaNumber) {
        skipped += 1
        continue
      }

      const data = {
        companyId,
        markaNumber,
        description: cleanString(getCsvValue(row, ['Description'])),
        isActive: parseCsvBoolean(getCsvValue(row, ['Active', 'Status']), true)
      }

      const existingId = existingMap.get(markaNumber)
      if (existingId) {
        await prisma.marka.update({
          where: { id: existingId },
          data
        })
        updated += 1
      } else {
        const created = await prisma.marka.create({ data })
        existingMap.set(markaNumber, created.id)
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
    console.error('Error importing markas:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

