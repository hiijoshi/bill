import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { ensureCompanyAccess, normalizeId, parseJsonWithSchema, requireAuthContext } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { parseNonNegativeNumber } from '@/lib/field-validation'

const stockAdjustmentSchema = z.object({
  companyId: z.string().min(1),
  productId: z.string().min(1),
  adjustmentDate: z.string().min(1),
  quantity: z.union([z.string(), z.number()]).optional(),
  shortageWeight: z.union([z.string(), z.number()]).optional(),
  remark: z.string().trim().max(500).optional().nullable(),
  type: z.string().optional(),
  adjustmentType: z.enum(['in', 'out']).optional()
}).refine((data) => data.quantity !== undefined || data.shortageWeight !== undefined, {
  message: 'Adjustment quantity is required',
  path: ['quantity']
})

function safeToDate(value: string): Date {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : new Date()
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, stockAdjustmentSchema)
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const companyId = normalizeId(body.companyId)
    const productId = normalizeId(body.productId)
    const { adjustmentDate, remark } = body
    const adjustmentType = body.adjustmentType === 'in' ? 'in' : 'out'
    const rawQuantity = body.quantity ?? body.shortageWeight

    if (!companyId || !productId) {
      return NextResponse.json({ error: 'Company ID and product ID are required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const parsedQuantity = parseNonNegativeNumber(rawQuantity)
    if (parsedQuantity === null || parsedQuantity <= 0) {
      return NextResponse.json(
        {
          error: `Stock ${adjustmentType === 'in' ? 'in' : 'out'} quantity must be greater than 0`
        },
        { status: 400 }
      )
    }

    const [product, stockSummary] = await Promise.all([
      prisma.product.findFirst({
        where: {
          id: productId,
          companyId
        },
        include: {
          unit: {
            select: {
              symbol: true
            }
          }
        }
      }),
      prisma.stockLedger.aggregate({
        where: {
          companyId,
          productId
        },
        _sum: {
          qtyIn: true,
          qtyOut: true
        }
      })
    ])

    if (!product) {
      return NextResponse.json({ error: 'Selected product was not found' }, { status: 404 })
    }

    const currentStock = Number(stockSummary._sum.qtyIn || 0) - Number(stockSummary._sum.qtyOut || 0)
    if (adjustmentType === 'out' && parsedQuantity > currentStock) {
      return NextResponse.json(
        {
          error: `Stock out cannot exceed current stock (${currentStock.toFixed(2)} ${product.unit.symbol})`
        },
        { status: 400 }
      )
    }

    const qtyIn = adjustmentType === 'in' ? parsedQuantity : 0
    const qtyOut = adjustmentType === 'out' ? parsedQuantity : 0
    const currentStockAfter = currentStock + qtyIn - qtyOut

    const adjustment = await prisma.stockLedger.create({
      data: {
        companyId,
        entryDate: safeToDate(adjustmentDate),
        productId,
        type: 'adjustment',
        qtyOut,
        qtyIn,
        refTable: 'stock_adjustments',
        refId: `${adjustmentType}-${Date.now()}`
      }
    })

    const authResult = requireAuthContext(request)
    if (!authResult.ok) return authResult.response
    const auth = authResult.auth
    await writeAuditLog({
      actor: {
        id: auth.userDbId || auth.userId,
        role: auth.role
      },
      action: 'CREATE',
      resourceType: 'STOCK',
      resourceId: adjustment.id,
      scope: {
        traderId: auth.traderId,
        companyId
      },
      after: {
        adjustmentId: adjustment.id,
        productId,
        productName: product.name,
        adjustmentType,
        quantity: parsedQuantity,
        currentStockBefore: currentStock,
        currentStockAfter
      },
      requestMeta: getAuditRequestMeta(request),
      notes: remark?.trim() || undefined
    })

    return NextResponse.json({
      success: true,
      message: `Stock ${adjustmentType === 'in' ? 'in' : 'out'} adjustment recorded successfully`,
      adjustment,
      currentStockBefore: currentStock,
      currentStockAfter,
      adjustmentType,
      quantity: parsedQuantity,
      unit: product.unit.symbol
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
