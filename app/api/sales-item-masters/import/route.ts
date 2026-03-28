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

    const [products, existingItems] = await Promise.all([
      prisma.product.findMany({
        where: { companyId },
        select: { id: true, name: true }
      }),
      prisma.salesItemMaster.findMany({
        where: { companyId },
        select: { id: true, productId: true, salesItemName: true }
      })
    ])

    const productMap = new Map(products.map((product) => [product.name.trim().toLowerCase(), product.id]))
    const existingMap = new Map(
      existingItems.map((item) => [
        `${item.productId}::${item.salesItemName.trim().toLowerCase()}`,
        item.id
      ])
    )

    let imported = 0
    let updated = 0
    let skipped = 0
    const errorDetails: string[] = []

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const rowNumber = index + 2
      const productName = getCsvValue(row, ['ProductName', 'Product Name', 'Product'])
      const salesItemName = getCsvValue(row, ['SalesItemName', 'Sales Item Name', 'Name'])

      if (!productName || !salesItemName) {
        skipped += 1
        continue
      }

      const productId = productMap.get(productName.trim().toLowerCase())
      if (!productId) {
        errorDetails.push(`Row ${rowNumber}: Product "${productName}" was not found for sales item "${salesItemName}"`)
        continue
      }

      const gstRaw = getCsvValue(row, ['GST', 'GSTRate', 'GST Rate'])
      const priceRaw = getCsvValue(row, ['SellingPrice', 'Selling Price', 'Price'])
      const gstRate = parseCsvOptionalNumber(gstRaw)
      const sellingPrice = parseCsvOptionalNumber(priceRaw)

      if (gstRaw && gstRate === null) {
        errorDetails.push(`Row ${rowNumber}: GST rate must be numeric for sales item "${salesItemName}"`)
        continue
      }

      if (priceRaw && sellingPrice === null) {
        errorDetails.push(`Row ${rowNumber}: Selling price must be numeric for sales item "${salesItemName}"`)
        continue
      }

      const data = {
        companyId,
        productId,
        salesItemName,
        hsnCode: cleanString(getCsvValue(row, ['HSN', 'HSNCode', 'HSN Code'])),
        gstRate,
        sellingPrice,
        description: cleanString(getCsvValue(row, ['Description'])),
        isActive: parseCsvBoolean(getCsvValue(row, ['Active', 'Status']), true)
      }

      const key = `${productId}::${salesItemName.trim().toLowerCase()}`
      const existingId = existingMap.get(key)
      if (existingId) {
        await prisma.salesItemMaster.update({
          where: { id: existingId },
          data
        })
        updated += 1
      } else {
        const created = await prisma.salesItemMaster.create({ data })
        existingMap.set(key, created.id)
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
    console.error('Error importing sales items:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

