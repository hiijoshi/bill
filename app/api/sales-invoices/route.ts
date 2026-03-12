import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess } from '@/lib/api-security'
import { z } from 'zod'

const salesItemSchema = z.object({
  productId: z.string().min(1),
  weight: z.coerce.number().positive(),
  bags: z.coerce.number().int().min(0).optional(),
  rate: z.coerce.number().positive('Rate must be greater than 0'),
  amount: z.coerce.number().nonnegative()
})

const salesInvoiceSchema = z.object({
  salesBill: z.object({
    companyId: z.string().min(1),
    billNo: z.string().min(1),
    billDate: z.string().min(1),
    partyId: z.string().min(1),
    totalAmount: z.coerce.number().nonnegative(),
    receivedAmount: z.coerce.number().nonnegative().optional(),
    balanceAmount: z.coerce.number().nonnegative().optional(),
    status: z.string().optional()
  }),
  transportBill: z.object({
    transportName: z.string().optional().nullable(),
    lorryNo: z.string().optional().nullable(),
    freightPerQt: z.coerce.number().nonnegative().optional(),
    freightAmount: z.coerce.number().nonnegative().optional(),
    advance: z.coerce.number().nonnegative().optional(),
    toPay: z.coerce.number().nonnegative().optional(),
    otherAmount: z.coerce.number().nonnegative().optional(),
    insuranceAmount: z.coerce.number().nonnegative().optional()
  }).optional(),
  salesItems: z.array(salesItemSchema).min(1)
})

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const firmId = searchParams.get('companyId') || searchParams.get('firmId')

    if (!firmId) {
      return NextResponse.json({ error: 'Firm ID is required' }, { status: 400 })
    }
    const denied = await ensureCompanyAccess(request, firmId)
    if (denied) return denied

    const salesInvoices = await prisma.salesBill.findMany({
      where: { companyId: firmId }, // Use companyId instead of firmId
      include: {
        party: true,
        salesItems: {
          include: {
            product: true
          }
        }
      },
      orderBy: { billDate: 'desc' }
    })

    return NextResponse.json(salesInvoices)
  } catch (error) {
    console.error('Error fetching sales invoices:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json()
    const parsed = salesInvoiceSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request data' }, { status: 400 })
    }
    const body = parsed.data
    const { 
      salesBill,
      transportBill,
      salesItems
    } = body

    // Extract sales bill data
    const { companyId, billNo, billDate, partyId, totalAmount, receivedAmount, balanceAmount, status } = salesBill

    // Validation
    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    // Check for duplicate invoice number
    const existingInvoice = await prisma.salesBill.findFirst({
      where: { 
        companyId, 
        billNo 
      }
    })

    if (existingInvoice) {
      return NextResponse.json({ 
        error: `Bill number ${billNo} already exists for this company` 
      }, { status: 400 })
    }

    // Create sales bill with transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create sales bill
      const salesBillRecord = await tx.salesBill.create({
        data: {
          companyId,
          billNo,
          billDate: new Date(billDate),
          partyId,
          totalAmount,
          receivedAmount: receivedAmount || 0,
          balanceAmount: balanceAmount || totalAmount,
          status: status || 'unpaid'
        }
      })

      // Create sales items
      for (const item of salesItems) {
        await tx.salesItem.create({
          data: {
            salesBillId: salesBillRecord.id,
            productId: item.productId,
            weight: item.weight,
            bags: item.bags ?? null,
            rate: item.rate,
            amount: item.amount
          }
        })

        await tx.stockLedger.create({
          data: {
            companyId,
            entryDate: new Date(billDate),
            productId: item.productId,
            type: 'sales',
            qtyOut: item.weight,
            refTable: 'sales_bills',
            refId: salesBillRecord.id
          }
        })
      }

      // Create transport bill if data provided
      let transportBillRecord = null
      if (transportBill && (transportBill.transportName || transportBill.lorryNo)) {
        transportBillRecord = await tx.transportBill.create({
          data: {
            salesBillId: salesBillRecord.id,
            transportName: transportBill.transportName,
            lorryNo: transportBill.lorryNo,
            freightPerQt: transportBill.freightPerQt ?? 0,
            freightAmount: transportBill.freightAmount ?? 0,
            advance: transportBill.advance ?? 0,
            toPay: transportBill.toPay ?? 0,
            otherAmount: transportBill.otherAmount ?? 0,
            insuranceAmount: transportBill.insuranceAmount ?? 0
          }
        })
      }

      return {
        salesBill: salesBillRecord,
        transportBill: transportBillRecord
      }
    })

    return NextResponse.json({
      success: true,
      salesBillId: result.salesBill.id,
      salesBill: result.salesBill,
      transportBill: result.transportBill
    })
  } catch (error) {
    console.error('Error creating sales bill:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
