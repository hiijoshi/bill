import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess } from '@/lib/api-security'
import { cleanString } from '@/lib/field-validation'
import { getCsvValue, parseCsvBoolean, parseCsvObjects, parseCsvOptionalNumber } from '@/lib/master-csv'
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

    const [units, existingProducts] = await Promise.all([
      prisma.unit.findMany({
        where: { companyId },
        select: { id: true, name: true, symbol: true }
      }),
      prisma.product.findMany({
        where: { companyId },
        select: { id: true, name: true }
      })
    ])

    const unitMap = new Map<string, string>()
    units.forEach((unit) => {
      unitMap.set(unit.symbol.trim().toLowerCase(), unit.id)
      unitMap.set(unit.name.trim().toLowerCase(), unit.id)
    })

    const existingMap = new Map(
      existingProducts.map((product) => [product.name.trim().toLowerCase(), product.id])
    )

    let imported = 0
    let updated = 0
    let skipped = 0
    const errorDetails: string[] = []

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const rowNumber = index + 2
      const name = getCsvValue(row, ['Name', 'Product Name'])
      const unitValue = getCsvValue(row, ['Unit', 'Unit Symbol', 'UnitName'])

      if (!name) {
        skipped += 1
        continue
      }

      if (!unitValue) {
        errorDetails.push(`Row ${rowNumber}: Unit is required for product "${name}"`)
        continue
      }

      const unitId = unitMap.get(unitValue.trim().toLowerCase())
      if (!unitId) {
        errorDetails.push(`Row ${rowNumber}: Unit "${unitValue}" was not found for product "${name}"`)
        continue
      }

      const gstRaw = getCsvValue(row, ['GST', 'GSTRate', 'GST Rate'])
      const sellingPriceRaw = getCsvValue(row, ['SellingPrice', 'Selling Price', 'Price'])
      const gstRate = parseCsvOptionalNumber(gstRaw)
      const sellingPrice = parseCsvOptionalNumber(sellingPriceRaw)

      if (gstRaw && gstRate === null) {
        errorDetails.push(`Row ${rowNumber}: GST rate must be numeric for product "${name}"`)
        continue
      }

      if (sellingPriceRaw && sellingPrice === null) {
        errorDetails.push(`Row ${rowNumber}: Selling price must be numeric for product "${name}"`)
        continue
      }

      const data = {
        companyId,
        name,
        unitId,
        hsnCode: cleanString(getCsvValue(row, ['HSN', 'HSNCode', 'HSN Code'])),
        gstRate,
        sellingPrice,
        description: cleanString(getCsvValue(row, ['Description'])),
        isActive: parseCsvBoolean(getCsvValue(row, ['Active', 'Status']), true)
      }

      const existingId = existingMap.get(name.trim().toLowerCase())
      if (existingId) {
        await prisma.product.update({
          where: { id: existingId },
          data
        })
        updated += 1
      } else {
        const created = await prisma.product.create({ data })
        existingMap.set(name.trim().toLowerCase(), created.id)
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
    console.error('Error importing products:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

