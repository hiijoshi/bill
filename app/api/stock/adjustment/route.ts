import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'
import { parseNonNegativeNumber } from '@/lib/field-validation'

const stockAdjustmentSchema = z.object({
  companyId: z.string().min(1),
  productId: z.string().min(1),
  adjustmentDate: z.string().min(1),
  shortageWeight: z.union([z.string(), z.number()]),
  remark: z.string().optional(),
  type: z.string().optional()
})

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, stockAdjustmentSchema)
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const { companyId, productId, adjustmentDate, shortageWeight, remark, type } = body

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied
    const parsedShortage = parseNonNegativeNumber(shortageWeight)
    if (parsedShortage === null || parsedShortage <= 0) {
      return NextResponse.json({ error: 'Shortage weight must be greater than 0' }, { status: 400 })
    }

    // Create stock ledger entry for shortage
    await prisma.stockLedger.create({
      data: {
        companyId,
        entryDate: new Date(adjustmentDate),
        productId,
        type: 'adjustment',
        qtyOut: parsedShortage,
        qtyIn: 0,
        refTable: 'stock_adjustments',
        refId: 'adjustment-' + Date.now(),
      },
    })

    return NextResponse.json({ 
      success: true, 
      message: 'Stock adjustment recorded successfully' 
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
