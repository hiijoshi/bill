import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess } from '@/lib/api-security'
import { cleanString, normalizeTenDigitPhone } from '@/lib/field-validation'
import { getCsvValue, parseCsvObjects } from '@/lib/master-csv'
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

    const existingSuppliers = await prisma.supplier.findMany({
      where: { companyId },
      select: { id: true, name: true }
    })
    const existingMap = new Map(
      existingSuppliers.map((supplier) => [supplier.name.trim().toLowerCase(), supplier.id])
    )

    let imported = 0
    let updated = 0
    let skipped = 0
    const errorDetails: string[] = []

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const rowNumber = index + 2
      const name = getCsvValue(row, ['Name', 'Supplier Name'])

      if (!name) {
        skipped += 1
        continue
      }

      const phone1Raw = getCsvValue(row, ['Phone1', 'Phone', 'Primary Phone'])
      const phone2Raw = getCsvValue(row, ['Phone2', 'Secondary Phone'])
      const phone1 = phone1Raw ? normalizeTenDigitPhone(phone1Raw) : null
      const phone2 = phone2Raw ? normalizeTenDigitPhone(phone2Raw) : null

      if (phone1Raw && !phone1) {
        errorDetails.push(`Row ${rowNumber}: Primary phone must be exactly 10 digits for supplier "${name}"`)
        continue
      }

      if (phone2Raw && !phone2) {
        errorDetails.push(`Row ${rowNumber}: Secondary phone must be exactly 10 digits for supplier "${name}"`)
        continue
      }

      const data = {
        companyId,
        name,
        address: cleanString(getCsvValue(row, ['Address'])),
        phone1,
        phone2,
        ifscCode: cleanString(getCsvValue(row, ['IFSCCode', 'IFSC Code']))?.toUpperCase() || null,
        bankName: cleanString(getCsvValue(row, ['BankName', 'Bank Name'])),
        accountNo: cleanString(getCsvValue(row, ['AccountNo', 'Account Number'])),
        gstNumber: cleanString(getCsvValue(row, ['GSTNumber', 'GST Number']))
      }

      const existingId = existingMap.get(name.trim().toLowerCase())
      if (existingId) {
        await prisma.supplier.update({
          where: { id: existingId },
          data
        })
        updated += 1
      } else {
        const created = await prisma.supplier.create({ data })
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
    console.error('Error importing suppliers:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

