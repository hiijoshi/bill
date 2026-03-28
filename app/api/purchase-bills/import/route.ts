import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess } from '@/lib/api-security'

const clampNonNegative = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

const getCellString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  return ''
}

const getCellOptionalString = (value: unknown): string | null => {
  const normalized = getCellString(value)
  return normalized ? normalized : null
}

const getCellNumber = (value: unknown): number => {
  const normalized = getCellString(value)
  return clampNonNegative(Number(normalized || 0))
}

const getCellDateIso = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString()
  }
  const normalized = getCellString(value)
  const parsedDate = normalized ? new Date(normalized) : new Date()
  return Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString()
}

const getWorksheetCellValue = (value: ExcelJS.CellValue | undefined): unknown => {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (value instanceof Date) {
    return value
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => getCellString(getWorksheetCellValue(entry)))
      .filter(Boolean)
      .join(' ')
  }
  if (typeof value === 'object') {
    if ('result' in value) {
      return getWorksheetCellValue(value.result as ExcelJS.CellValue | undefined)
    }
    if ('text' in value && typeof value.text === 'string') {
      return value.text
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((entry) => entry.text).join('')
    }
    if ('hyperlink' in value && typeof value.hyperlink === 'string') {
      return typeof value.text === 'string' && value.text ? value.text : value.hyperlink
    }
    if ('formula' in value && typeof value.formula === 'string') {
      return value.formula
    }
  }
  return ''
}

const extractWorksheetRows = (worksheet: ExcelJS.Worksheet): Record<string, unknown>[] => {
  const headerMap = new Map<number, string>()
  const headerRow = worksheet.getRow(1)

  headerRow.eachCell((cell, colNumber) => {
    const header = getCellString(getWorksheetCellValue(cell.value))
    if (header) {
      headerMap.set(colNumber, header)
    }
  })

  const rows: Record<string, unknown>[] = []

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return

    const rowData: Record<string, unknown> = {}
    let hasValue = false

    headerMap.forEach((header, colNumber) => {
      const rawValue = getWorksheetCellValue(row.getCell(colNumber).value)
      const normalized = rawValue instanceof Date ? rawValue : getCellString(rawValue)

      if (
        normalized instanceof Date
          ? Number.isFinite(normalized.getTime())
          : Boolean(normalized)
      ) {
        hasValue = true
      }

      rowData[header] = rawValue
    })

    if (hasValue) {
      rows.push(rowData)
    }
  })

  return rows
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const workbook = new ExcelJS.Workbook()
    const workbookBuffer = Buffer.from(await file.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0]
    await workbook.xlsx.load(workbookBuffer)
    const worksheet = workbook.worksheets[0]

    if (!worksheet) {
      return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 })
    }

    const data = extractWorksheetRows(worksheet)

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }
    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const importedBills = []
    const errors = []

    // Get last bill number
    const lastBillRes = await prisma.purchaseBill.findFirst({
      where: { companyId },
      orderBy: { billNo: 'desc' },
      select: { billNo: true }
    })
    
    let lastBillNumber: number = parseInt(lastBillRes?.billNo || '0')

    for (let i = 0; i < data.length; i++) {
      const row = data[i]
      
      try {
        const billNumber = getCellString(row['Bill Number'])
        const farmerName = getCellString(row['Farmer Name'])
        const productName = getCellString(row['Product Name'])
        const weightValue = getCellString(row['Weight'])
        const rateValue = getCellString(row['Rate'])

        // Validate required fields
        if (!billNumber || !farmerName || !productName || !weightValue || !rateValue) {
          errors.push(`Row ${i + 2}: Missing required fields`)
          continue
        }

        // Get product
        const product = await prisma.product.findFirst({
          where: { 
            name: productName,
            companyId 
          }
        })

        if (!product) {
          errors.push(`Row ${i + 2}: Product "${productName}" not found`)
          continue
        }

        // Find or create farmer
        let farmer = await prisma.farmer.findFirst({
          where: { 
            name: farmerName,
            companyId: companyId
          }
        })
        
        if (!farmer) {
          farmer = await prisma.farmer.create({
            data: {
              name: farmerName,
              address: getCellOptionalString(row['Farmer Address']),
              phone1: getCellOptionalString(row['Farmer Contact']),
              companyId: companyId
            }
          })
        }

        lastBillNumber++

        const weight = getCellNumber(row['Weight'])
        const rate = getCellNumber(row['Rate'])
        const hammali = getCellNumber(row['Hammali'])
        const payableAmount = clampNonNegative(getCellNumber(row['Payable Amount']) || (weight * rate) - hammali)
        const paidAmount = getCellNumber(row['Paid Amount'])
        const safePaidAmount = Math.min(payableAmount, paidAmount)
        const balanceAmount = clampNonNegative(payableAmount - safePaidAmount)
        const status = safePaidAmount <= 0 ? 'unpaid' : balanceAmount === 0 ? 'paid' : 'partial'
        
        const purchaseBill = await prisma.purchaseBill.create({
          data: {
            companyId,
            billNo: lastBillNumber.toString(),
            billDate: getCellDateIso(row['Bill Date']),
            farmerId: farmer.id,
            totalAmount: payableAmount,
            paidAmount: safePaidAmount,
            balanceAmount,
            status
          }
        })

        importedBills.push(purchaseBill)
      } catch (error) {
        errors.push(`Row ${i + 2}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    return NextResponse.json({
      success: true,
      imported: importedBills.length,
      errors: errors.length,
      errorDetails: errors,
      totalRows: data.length
    })

  } catch (error) {
    console.error('Error importing Excel:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
