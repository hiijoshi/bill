import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'
import { ensureCompanyAccess } from '@/lib/api-security'

const clampNonNegative = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]
    const data = XLSX.utils.sheet_to_json(worksheet)

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
      const row = data[i] as any
      
      try {
        // Validate required fields
        if (!row['Bill Number'] || !row['Farmer Name'] || !row['Product Name'] || !row['Weight'] || !row['Rate']) {
          errors.push(`Row ${i + 2}: Missing required fields`)
          continue
        }

        // Get product
        const product = await prisma.product.findFirst({
          where: { 
            name: row['Product Name'],
            companyId 
          }
        })

        if (!product) {
          errors.push(`Row ${i + 2}: Product "${row['Product Name']}" not found`)
          continue
        }

        // Find or create farmer
        let farmer = await prisma.farmer.findFirst({
          where: { 
            name: row['Farmer Name'],
            companyId: companyId
          }
        })
        
        if (!farmer) {
          farmer = await prisma.farmer.create({
            data: {
              name: row['Farmer Name'],
              address: row['Farmer Address'] || null,
              phone1: row['Farmer Contact'] || null,
              companyId: companyId
            }
          })
        }

        lastBillNumber++

        const weight = clampNonNegative(parseFloat(row['Weight']) || 0)
        const rate = clampNonNegative(parseFloat(row['Rate']) || 0)
        const hammali = clampNonNegative(parseFloat(row['Hammali']) || 0)
        const payableAmount = clampNonNegative((parseFloat(row['Payable Amount']) || (weight * rate) - hammali))
        const paidAmount = clampNonNegative(parseFloat(row['Paid Amount']) || 0)
        const safePaidAmount = Math.min(payableAmount, paidAmount)
        const balanceAmount = clampNonNegative(payableAmount - safePaidAmount)
        const status = safePaidAmount <= 0 ? 'unpaid' : balanceAmount === 0 ? 'paid' : 'partial'
        
        const purchaseBill = await prisma.purchaseBill.create({
          data: {
            companyId,
            billNo: lastBillNumber.toString(),
            billDate: row['Bill Date'] ? new Date(row['Bill Date']).toISOString() : new Date().toISOString(),
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
