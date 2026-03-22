import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateStockBeforeSale } from '@/lib/stock-automation'
import { z } from 'zod'
import { ensureCompanyAccess, getRequestAuthContext, normalizeId, parseJsonWithSchema } from '@/lib/api-security'
import { buildPaginationMeta, parsePaginationParams } from '@/lib/pagination'
import { calculateTaxBreakdown, calculateTotalsBreakdown, normalizeNonNegative } from '@/lib/billing-calculations'
import { getPartyCreditSnapshot } from '@/lib/party-credit'

const salesItemSchema = z.object({
  productId: z.string().min(1),
  salesItemId: z.string().optional(),
  totalWeight: z.coerce.number().nonnegative().optional(),
  qty: z.coerce.number().nonnegative().optional(),
  weight: z.coerce.number().nonnegative().optional(),
  bags: z.coerce.number().int().nonnegative().optional(),
  rate: z.coerce.number().nonnegative().optional(),
  amount: z.coerce.number().nonnegative().optional()
})

const transportBillSchema = z.object({
  transportName: z.string().optional().nullable(),
  lorryNo: z.string().optional().nullable(),
  freightPerQt: z.coerce.number().nonnegative().optional(),
  freightAmount: z.coerce.number().nonnegative().optional(),
  advance: z.coerce.number().nonnegative().optional(),
  toPay: z.coerce.number().nonnegative().optional(),
  otherAmount: z.coerce.number().nonnegative().optional(),
  insuranceAmount: z.coerce.number().nonnegative().optional()
})

const salesCreateSchema = z.object({
  companyId: z.string().min(1),
  invoiceNo: z.string().optional(),
  billNo: z.string().optional(),
  invoiceDate: z.string().optional(),
  billDate: z.string().optional(),
  partyId: z.string().optional(),
  partyName: z.string().optional(),
  partyAddress: z.string().optional(),
  partyContact: z.string().optional(),
  salesItems: z.array(salesItemSchema).min(1),
  transportBill: transportBillSchema.optional(),
  totalAmount: z.union([z.string(), z.number()]).optional(),
  receivedAmount: z.union([z.string(), z.number()]).optional(),
  balanceAmount: z.union([z.string(), z.number()]).optional(),
  status: z.string().optional(),
  allowRiskOverride: z.boolean().optional()
})

const salesUpdateSchema = salesCreateSchema.extend({
  id: z.string().optional()
})

function safeToDate(value?: string): Date {
  if (!value) return new Date()
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : new Date()
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, parsed)
}

function extractBillSequence(billNo: string): number {
  if (!billNo) return 0
  const trimmed = billNo.trim()
  if (!trimmed) return 0
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10)
  const chunks = trimmed.match(/\d+/g)
  if (!chunks || chunks.length === 0) return 0
  const lastChunk = chunks[chunks.length - 1]
  const parsed = Number.parseInt(lastChunk, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function deriveStatus(balanceAmount: number, receivedAmount: number): 'paid' | 'partial' | 'unpaid' {
  if (balanceAmount <= 0) return 'paid'
  if (receivedAmount > 0) return 'partial'
  return 'unpaid'
}

function normalizeBillNo(invoiceNo: unknown, billNo: unknown): string {
  const fromInvoice = String(invoiceNo || '').trim()
  if (fromInvoice) return fromInvoice
  const fromBillNo = String(billNo || '').trim()
  if (fromBillNo) return fromBillNo
  return '1'
}

function normalizeSalesItems(items: Array<z.infer<typeof salesItemSchema>>) {
  return items.map((item) => {
    const weight = toNonNegativeNumber(item.weight ?? item.totalWeight ?? item.qty, 0)
    const rate = toNonNegativeNumber(item.rate, 0)
    const bags = item.bags !== undefined ? Math.floor(toNonNegativeNumber(item.bags, 0)) : null
    const amount = item.amount !== undefined ? toNonNegativeNumber(item.amount, 0) : Number((weight * rate).toFixed(2))

    return {
      productId: item.productId,
      weight,
      rate,
      bags,
      amount
    }
  })
}

async function enrichSalesItemsWithTax(
  companyId: string,
  items: Array<{ productId: string; weight: number; rate: number; bags: number | null; amount: number }>
) {
  const productIds = Array.from(new Set(items.map((item) => item.productId)))
  const [products, salesItemMasters] = await Promise.all([
    prisma.product.findMany({
      where: {
        companyId,
        id: { in: productIds }
      },
      select: {
        id: true,
        gstRate: true
      }
    }),
    prisma.salesItemMaster.findMany({
      where: {
        companyId,
        productId: { in: productIds }
      },
      select: {
        productId: true,
        gstRate: true
      }
    })
  ])

  const productMap = new Map(products.map((product) => [product.id, product]))
  const salesItemMasterMap = new Map(salesItemMasters.map((item) => [item.productId, item]))

  return items.map((item) => {
    const product = productMap.get(item.productId)
    const salesItemMaster = salesItemMasterMap.get(item.productId)
    if (!product) {
      throw new Error('Selected product not found')
    }

    const tax = calculateTaxBreakdown(item.amount, salesItemMaster?.gstRate ?? product.gstRate)
    return {
      ...item,
      taxableAmount: tax.taxableAmount,
      gstRateSnapshot: tax.gstRate,
      gstAmount: tax.gstAmount,
      lineTotal: tax.lineTotal
    }
  })
}

async function assertPartyCreditRisk(args: {
  companyId: string
  partyId: string
  pendingSaleAmount: number
  referenceDate: Date
  excludeBillId?: string | null
  allowRiskOverride?: boolean
}) {
  const snapshot = await getPartyCreditSnapshot({
    companyId: args.companyId,
    partyId: args.partyId,
    pendingSaleAmount: args.pendingSaleAmount,
    referenceDate: args.referenceDate,
    excludeBillId: args.excludeBillId,
  })

  if (!snapshot) {
    throw new Error('Selected party not found')
  }

  if (snapshot.warning && !args.allowRiskOverride) {
    return NextResponse.json(
      {
        error: 'Buyer limit warning',
        message: 'Party has overdue balance or exceeds the configured credit limit.',
        creditRisk: snapshot,
      },
      { status: 409 }
    )
  }

  return null
}

function sanitizeSalesBill<T extends {
  totalAmount?: unknown
  receivedAmount?: unknown
  balanceAmount?: unknown
  status?: unknown
  salesItems?: Array<{ qty?: unknown; weight?: unknown; rate?: unknown; amount?: unknown; bags?: unknown }>
  transportBills?: Array<{
    freightPerQt?: unknown
    freightAmount?: unknown
    advance?: unknown
    toPay?: unknown
    otherAmount?: unknown
    insuranceAmount?: unknown
  }>
}>(bill: T): T {
  const safeTotalAmount = toNonNegativeNumber(bill.totalAmount, 0)
  const safeReceivedAmount = toNonNegativeNumber(bill.receivedAmount, 0)
  const safeBalanceAmount = Math.max(0, safeTotalAmount - safeReceivedAmount)
  const safeStatus = deriveStatus(safeBalanceAmount, safeReceivedAmount)

  return {
    ...bill,
    totalAmount: safeTotalAmount,
    receivedAmount: safeReceivedAmount,
    balanceAmount: safeBalanceAmount,
    status: safeStatus,
    salesItems: Array.isArray(bill.salesItems)
      ? bill.salesItems.map((item) => ({
          ...item,
          qty: toNonNegativeNumber(item.qty ?? item.weight, 0),
          weight: toNonNegativeNumber(item.weight ?? item.qty, 0),
          bags: Math.floor(toNonNegativeNumber(item.bags, 0)),
          rate: toNonNegativeNumber(item.rate, 0),
          amount: toNonNegativeNumber(item.amount, 0)
        }))
      : bill.salesItems,
    transportBills: Array.isArray(bill.transportBills)
      ? bill.transportBills.map((item) => ({
          ...item,
          freightPerQt: toNonNegativeNumber(item.freightPerQt, 0),
          freightAmount: toNonNegativeNumber(item.freightAmount, 0),
          advance: toNonNegativeNumber(item.advance, 0),
          toPay: toNonNegativeNumber(item.toPay, 0),
          otherAmount: toNonNegativeNumber(item.otherAmount, 0),
          insuranceAmount: toNonNegativeNumber(item.insuranceAmount, 0)
        }))
      : bill.transportBills
  } as T
}

async function resolveSalesParty(input: {
  companyId: string
  partyId?: string
  partyName?: string
  partyAddress?: string
  partyContact?: string
}) {
  const normalizedPartyId = normalizeId(input.partyId)
  if (normalizedPartyId) {
    const existingById = await prisma.party.findFirst({
      where: {
        id: normalizedPartyId,
        companyId: input.companyId
      }
    })

    if (!existingById) {
      throw new Error('Selected party not found')
    }

    if (input.partyAddress !== undefined || input.partyContact !== undefined) {
      return prisma.party.update({
        where: { id: existingById.id },
        data: {
          address: input.partyAddress ?? existingById.address,
          phone1: input.partyContact ?? existingById.phone1
        }
      })
    }

    return existingById
  }

  const normalizedPartyName = String(input.partyName || '').trim()
  if (!normalizedPartyName) {
    throw new Error('Party selection is required')
  }

  let party = await prisma.party.findFirst({
    where: {
      companyId: input.companyId,
      name: normalizedPartyName
    }
  })

  if (!party) {
    party = await prisma.party.create({
      data: {
        companyId: input.companyId,
        type: 'buyer',
        name: normalizedPartyName,
        address: input.partyAddress || null,
        phone1: input.partyContact || null
      }
    })
    return party
  }

  if (input.partyAddress !== undefined || input.partyContact !== undefined) {
    party = await prisma.party.update({
      where: { id: party.id },
      data: {
        address: input.partyAddress ?? party.address,
        phone1: input.partyContact ?? party.phone1
      }
    })
  }

  return party
}

function normalizeTransportBillData(input?: z.infer<typeof transportBillSchema>) {
  if (!input) return null

  const payload = {
    transportName: input.transportName?.trim() || null,
    lorryNo: input.lorryNo?.trim() || null,
    freightPerQt: toNonNegativeNumber(input.freightPerQt, 0),
    freightAmount: toNonNegativeNumber(input.freightAmount, 0),
    advance: toNonNegativeNumber(input.advance, 0),
    toPay: toNonNegativeNumber(input.toPay, 0),
    otherAmount: toNonNegativeNumber(input.otherAmount, 0),
    insuranceAmount: toNonNegativeNumber(input.insuranceAmount, 0)
  }

  const hasData = Boolean(
    payload.transportName ||
      payload.lorryNo ||
      payload.freightPerQt > 0 ||
      payload.freightAmount > 0 ||
      payload.advance > 0 ||
      payload.toPay > 0 ||
      payload.otherAmount > 0 ||
      payload.insuranceAmount > 0
  )

  if (!hasData) return null
  return payload
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, salesCreateSchema)
    if (!parsed.ok) return parsed.response

    const body = parsed.data
    const companyId = normalizeId(body.companyId)

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const normalizedItems = normalizeSalesItems(body.salesItems)
    const invalidItem = normalizedItems.find((item) => item.weight <= 0 || !item.productId)
    if (invalidItem) {
      return NextResponse.json({ error: 'Each sales item must have product and weight > 0' }, { status: 400 })
    }

    const stockValidation = await validateStockBeforeSale(
      companyId,
      normalizedItems.map((item) => ({
        productId: item.productId,
        weight: item.weight
      }))
    )

    if (!stockValidation.isValid) {
      return NextResponse.json(
        {
          error: 'Stock validation failed',
          message: stockValidation.message,
          stockDetails: stockValidation.stockDetails
        },
        { status: 400 }
      )
    }

    const party = await resolveSalesParty({
      companyId,
      partyId: body.partyId,
      partyName: body.partyName,
      partyAddress: body.partyAddress,
      partyContact: body.partyContact
    })

    const transportData = normalizeTransportBillData(body.transportBill)
    const taxedItems = await enrichSalesItemsWithTax(companyId, normalizedItems)
    const totals = calculateTotalsBreakdown({
      taxableAmounts: taxedItems.map((item) => item.taxableAmount),
      gstAmounts: taxedItems.map((item) => item.gstAmount),
      freightAmount: transportData?.freightAmount,
      otherAmount: transportData?.otherAmount,
      insuranceAmount: transportData?.insuranceAmount
    })

    const nextTotal = body.totalAmount !== undefined
      ? toNonNegativeNumber(body.totalAmount, totals.grandTotal)
      : totals.grandTotal

    const nextReceived = body.receivedAmount !== undefined ? toNonNegativeNumber(body.receivedAmount, 0) : 0
    if (nextReceived > nextTotal) {
      return NextResponse.json({ error: 'Received amount cannot exceed total amount' }, { status: 400 })
    }

    const nextBalance = body.balanceAmount !== undefined
      ? toNonNegativeNumber(body.balanceAmount, Math.max(0, nextTotal - nextReceived))
      : Math.max(0, nextTotal - nextReceived)

    const nextStatus = String(body.status || deriveStatus(nextBalance, nextReceived)).toLowerCase()
    const billDateValue = safeToDate(body.invoiceDate || body.billDate)
    const billNo = normalizeBillNo(body.invoiceNo, body.billNo)

    const riskDenied = await assertPartyCreditRisk({
      companyId,
      partyId: party.id,
      pendingSaleAmount: nextBalance,
      referenceDate: billDateValue,
      allowRiskOverride: body.allowRiskOverride === true
    })
    if (riskDenied) return riskDenied

    const auth = getRequestAuthContext(request)
    const userId = auth?.userId || 'system'

    const createdSalesBill = await prisma.$transaction(async (tx) => {
      const salesBill = await tx.salesBill.create({
        data: {
          companyId,
          billNo,
          billDate: billDateValue,
          partyId: party.id,
          subTotalAmount: totals.subTotalAmount,
          gstAmount: totals.gstAmount,
          totalAmount: nextTotal,
          receivedAmount: nextReceived,
          balanceAmount: nextBalance,
          status: nextStatus,
          createdBy: userId
        }
      })

      for (const item of taxedItems) {
        await tx.salesItem.create({
          data: {
            salesBillId: salesBill.id,
            productId: item.productId,
            weight: item.weight,
            bags: item.bags,
            rate: item.rate,
            taxableAmount: item.taxableAmount,
            gstRateSnapshot: item.gstRateSnapshot,
            gstAmount: item.gstAmount,
            lineTotal: item.lineTotal,
            amount: item.amount
          }
        })

        await tx.stockLedger.create({
          data: {
            companyId,
            entryDate: billDateValue,
            productId: item.productId,
            type: 'sales',
            qtyOut: item.weight,
            refTable: 'sales_bills',
            refId: salesBill.id
          }
        })
      }

      if (transportData) {
        await tx.transportBill.create({
          data: {
            salesBillId: salesBill.id,
            ...transportData
          }
        })
      }

      return tx.salesBill.findFirst({
        where: { id: salesBill.id },
        include: {
          party: true,
          salesItems: {
            include: { product: true }
          },
          transportBills: true
        }
      })
    })

    return NextResponse.json({ success: true, salesBill: createdSalesBill }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('not found') || message.includes('required') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = normalizeId(searchParams.get('companyId'))
    const billId = normalizeId(searchParams.get('billId'))
    const last = searchParams.get('last')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (last === 'true') {
      const bills = await prisma.salesBill.findMany({
        where: { companyId },
        select: { billNo: true }
      })
      const lastBillNumber = bills.reduce((max, bill) => {
        const value = extractBillSequence(bill.billNo)
        return Number.isFinite(value) ? Math.max(max, value) : max
      }, 0)
      return NextResponse.json({ lastBillNumber })
    }

    if (billId) {
      const bill = await prisma.salesBill.findFirst({
        where: {
          id: billId,
          companyId
        },
        include: {
          party: true,
          salesItems: {
            include: {
              product: true
            }
          },
          transportBills: true
        }
      })

      if (!bill) {
        return NextResponse.json({ error: 'Sales bill not found' }, { status: 404 })
      }

      return NextResponse.json(sanitizeSalesBill(bill))
    }

    const pagination = parsePaginationParams(searchParams, { defaultPageSize: 50, maxPageSize: 200 })

    const whereClause: {
      companyId: string
      billDate?: { gte?: Date; lte?: Date }
      OR?: Array<{ billNo: { contains: string } } | { status: { contains: string } }>
    } = { companyId }

    if (dateFrom || dateTo) {
      whereClause.billDate = {}
      if (dateFrom) whereClause.billDate.gte = safeToDate(dateFrom)
      if (dateTo) whereClause.billDate.lte = safeToDate(`${dateTo}T23:59:59.999`)
    }

    if (pagination.search) {
      whereClause.OR = [{ billNo: { contains: pagination.search } }, { status: { contains: pagination.search } }]
    }

    const [salesBills, total] = await Promise.all([
      prisma.salesBill.findMany({
        where: whereClause,
        include: {
          party: true,
          salesItems: {
            include: {
              product: true
            }
          },
          transportBills: true
        },
        orderBy: { createdAt: 'desc' },
        ...(pagination.enabled ? { skip: pagination.skip, take: pagination.pageSize } : {})
      }),
      pagination.enabled ? prisma.salesBill.count({ where: whereClause }) : Promise.resolve(0)
    ])

    const safeSalesBills = salesBills.map((bill) => sanitizeSalesBill(bill))

    if (pagination.enabled) {
      return NextResponse.json({
        data: safeSalesBills,
        meta: buildPaginationMeta(total, pagination)
      })
    }

    return NextResponse.json(safeSalesBills)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, salesUpdateSchema)
    if (!parsed.ok) return parsed.response

    const body = parsed.data
    const companyId = normalizeId(body.companyId)
    const billId = normalizeId(body.id || new URL(request.url).searchParams.get('billId'))

    if (!companyId || !billId) {
      return NextResponse.json({ error: 'Company ID and bill ID are required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const existing = await prisma.salesBill.findFirst({
      where: {
        id: billId,
        companyId
      },
      include: {
        salesItems: true,
        transportBills: true,
        party: true
      }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Sales bill not found' }, { status: 404 })
    }

    const hasSalesItems = Array.isArray(body.salesItems) && body.salesItems.length > 0
    const normalizedItems = hasSalesItems ? normalizeSalesItems(body.salesItems) : null

    if (normalizedItems) {
      const invalidItem = normalizedItems.find((item) => item.weight <= 0 || !item.productId)
      if (invalidItem) {
        return NextResponse.json({ error: 'Each sales item must have product and weight > 0' }, { status: 400 })
      }
    }

    const transportData = normalizeTransportBillData(body.transportBill)

    const hasPartyInput =
      Boolean(normalizeId(body.partyId)) ||
      Boolean(String(body.partyName || '').trim()) ||
      body.partyAddress !== undefined ||
      body.partyContact !== undefined

    const party = hasPartyInput
      ? await resolveSalesParty({
          companyId,
          partyId: body.partyId,
          partyName: body.partyName,
          partyAddress: body.partyAddress,
          partyContact: body.partyContact
        })
      : existing.party

    const taxedItems = normalizedItems ? await enrichSalesItemsWithTax(companyId, normalizedItems) : null
    const totals = taxedItems
      ? calculateTotalsBreakdown({
          taxableAmounts: taxedItems.map((item) => item.taxableAmount),
          gstAmounts: taxedItems.map((item) => item.gstAmount),
          freightAmount: transportData?.freightAmount ?? existing.transportBills[0]?.freightAmount,
          otherAmount: transportData?.otherAmount ?? existing.transportBills[0]?.otherAmount,
          insuranceAmount: transportData?.insuranceAmount ?? existing.transportBills[0]?.insuranceAmount
        })
      : {
          subTotalAmount: normalizeNonNegative((existing as { subTotalAmount?: number }).subTotalAmount),
          gstAmount: normalizeNonNegative((existing as { gstAmount?: number }).gstAmount),
          freightAmount: normalizeNonNegative(existing.transportBills[0]?.freightAmount),
          otherAmount: normalizeNonNegative(existing.transportBills[0]?.otherAmount),
          insuranceAmount: normalizeNonNegative(existing.transportBills[0]?.insuranceAmount),
          grandTotal: toNonNegativeNumber(existing.totalAmount, 0)
        }

    const nextTotal = body.totalAmount !== undefined
      ? toNonNegativeNumber(body.totalAmount, totals.grandTotal)
      : normalizedItems
        ? totals.grandTotal
        : toNonNegativeNumber(existing.totalAmount, 0)

    const nextReceived = body.receivedAmount !== undefined
      ? toNonNegativeNumber(body.receivedAmount, toNonNegativeNumber(existing.receivedAmount, 0))
      : toNonNegativeNumber(existing.receivedAmount, 0)

    if (nextReceived > nextTotal) {
      return NextResponse.json({ error: 'Received amount cannot exceed total amount' }, { status: 400 })
    }

    const nextBalance = body.balanceAmount !== undefined
      ? toNonNegativeNumber(body.balanceAmount, Math.max(0, nextTotal - nextReceived))
      : Math.max(0, nextTotal - nextReceived)

    const nextStatus = String(body.status || deriveStatus(nextBalance, nextReceived)).toLowerCase()
    const nextBillDate = body.invoiceDate || body.billDate ? safeToDate(body.invoiceDate || body.billDate) : existing.billDate
    const hasBillNoInput = String(body.invoiceNo || '').trim() || String(body.billNo || '').trim()
    const nextBillNo = hasBillNoInput ? normalizeBillNo(body.invoiceNo, body.billNo) : existing.billNo

    const riskDenied = await assertPartyCreditRisk({
      companyId,
      partyId: party.id,
      pendingSaleAmount: nextBalance,
      referenceDate: nextBillDate,
      excludeBillId: existing.id,
      allowRiskOverride: body.allowRiskOverride === true
    })
    if (riskDenied) return riskDenied

    const updated = await prisma.$transaction(async (tx) => {
      const bill = await tx.salesBill.update({
        where: { id: existing.id },
        data: {
          billNo: nextBillNo,
          billDate: nextBillDate,
          partyId: party.id,
          subTotalAmount: totals.subTotalAmount,
          gstAmount: totals.gstAmount,
          totalAmount: nextTotal,
          receivedAmount: nextReceived,
          balanceAmount: nextBalance,
          status: nextStatus
        }
      })

      if (normalizedItems) {
        const nextItems = taxedItems || []
        await tx.salesItem.deleteMany({ where: { salesBillId: existing.id } })
        await tx.stockLedger.deleteMany({
          where: {
            companyId,
            refTable: 'sales_bills',
            refId: existing.id
          }
        })

        for (const item of nextItems) {
          await tx.salesItem.create({
            data: {
              salesBillId: existing.id,
              productId: item.productId,
              weight: item.weight,
              bags: item.bags,
              rate: item.rate,
              taxableAmount: item.taxableAmount,
              gstRateSnapshot: item.gstRateSnapshot,
              gstAmount: item.gstAmount,
              lineTotal: item.lineTotal,
              amount: item.amount
            }
          })

          await tx.stockLedger.create({
            data: {
              companyId,
              entryDate: nextBillDate,
              productId: item.productId,
              type: 'sales',
              qtyOut: item.weight,
              refTable: 'sales_bills',
              refId: existing.id
            }
          })
        }
      }

      const existingTransportBill = await tx.transportBill.findFirst({
        where: { salesBillId: existing.id }
      })

      if (transportData) {
        if (existingTransportBill) {
          await tx.transportBill.update({
            where: { id: existingTransportBill.id },
            data: transportData
          })
        } else {
          await tx.transportBill.create({
            data: {
              salesBillId: existing.id,
              ...transportData
            }
          })
        }
      } else if (body.transportBill && existingTransportBill) {
        await tx.transportBill.delete({
          where: { id: existingTransportBill.id }
        })
      }

      return tx.salesBill.findFirst({
        where: { id: bill.id },
        include: {
          party: true,
          salesItems: {
            include: {
              product: true
            }
          },
          transportBills: true
        }
      })
    })

    return NextResponse.json({ success: true, salesBill: updated })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('not found') || message.includes('required') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams
    const companyId = normalizeId(searchParams.get('companyId'))
    const billId = normalizeId(searchParams.get('billId'))

    if (!companyId || !billId) {
      return NextResponse.json({ error: 'Company ID and bill ID are required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const existing = await prisma.salesBill.findFirst({
      where: {
        id: billId,
        companyId
      },
      select: { id: true }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Sales bill not found' }, { status: 404 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.stockLedger.deleteMany({
        where: {
          companyId,
          refTable: 'sales_bills',
          refId: billId
        }
      })
      await tx.salesBill.delete({
        where: { id: billId }
      })
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
