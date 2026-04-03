import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess } from '@/lib/api-security'
import { cleanString } from '@/lib/field-validation'
import { getCsvValue, parseCsvBoolean, parseCsvObjects } from '@/lib/master-csv'
import { ensureDefaultPaymentModes } from '@/lib/payment-mode-utils'
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

    const existingModes = await prisma.paymentMode.findMany({
      where: { companyId },
      select: { id: true, code: true }
    })
    const existingMap = new Map(
      existingModes.map((mode) => [mode.code.trim().toUpperCase(), mode.id])
    )

    let imported = 0
    let updated = 0
    let skipped = 0
    const errorDetails: string[] = []

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const name = getCsvValue(row, ['Name', 'Payment Mode'])
      const code = getCsvValue(row, ['Code']).toUpperCase()

      if (!name || !code) {
        skipped += 1
        continue
      }

      const data = {
        companyId,
        name,
        code,
        description: cleanString(getCsvValue(row, ['Description'])),
        isActive: parseCsvBoolean(getCsvValue(row, ['Active', 'Status']), true)
      }

      const existingId = existingMap.get(code)
      if (existingId) {
        await prisma.paymentMode.update({
          where: { id: existingId },
          data
        })
        updated += 1
      } else {
        const created = await prisma.paymentMode.create({ data })
        existingMap.set(code, created.id)
        imported += 1
      }
    }

    await ensureDefaultPaymentModes(prisma, companyId)

    return NextResponse.json({
      success: true,
      imported,
      updated,
      skipped,
      errors: errorDetails.length,
      errorDetails
    })
  } catch (error) {
    console.error('Error importing payment modes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
