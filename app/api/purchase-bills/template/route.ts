import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { ensureCompanyAccess, requireRoles } from '@/lib/api-security'

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const companyId =
      new URL(request.url).searchParams.get('companyId')?.trim() || authResult.auth.companyId || null
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    // Create template data
    const templateData = [
      {
        'Bill Number': 'PUR-1001',
        'Bill Date': '2024-01-15',
        'Farmer Name': 'John Farmer',
        'Farmer Address': '123 Farm Road, Village',
        'Farmer Contact': '+91-9876543210',
        'Krashak Anubandh Number': 'KA123456',
        'Marka Number': 'M789012',
        'Product Name': 'Wheat',
        'No. of Bags': 50,
        'Hammali': 350,
        'Weight': 5000,
        'Rate': 25,
        'Payable Amount': 116500,
        'Paid Amount': 116500
      },
      {
        'Bill Number': 'PUR-1002',
        'Bill Date': '2024-01-16',
        'Farmer Name': 'Jane Farmer',
        'Farmer Address': '456 Agriculture Lane, Village',
        'Farmer Contact': '+91-9876543211',
        'Krashak Anubandh Number': 'KA789012',
        'Marka Number': 'M345678',
        'Product Name': 'Rice',
        'No. of Bags': 25,
        'Hammali': 175,
        'Weight': 2500,
        'Rate': 30,
        'Payable Amount': 73250,
        'Paid Amount': 50000
      }
    ]

    // Create workbook
    const worksheet = XLSX.utils.json_to_sheet(templateData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Purchase Bills Template')

    // Generate buffer
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

    // Return as downloadable file
    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="purchase-bills-template.xlsx"'
      }
    })

  } catch (error) {
    console.error('Error generating template:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
