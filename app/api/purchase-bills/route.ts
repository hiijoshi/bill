import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import {
  ensureCompanyAccess,
  forbidden,
  getRequestAuthContext,
  hasCompanyAccess,
  isSuperAdmin,
  parseJsonWithSchema,
  unauthorized
} from '@/lib/api-security'
import { normalizeTenDigitPhone, parseNonNegativeNumber } from '@/lib/field-validation'
import { buildPaginationMeta, parsePaginationParams } from '@/lib/pagination'
import { calculateTaxBreakdown } from '@/lib/billing-calculations'

type PaymentStatus = 'unpaid' | 'partial' | 'paid'

const purchaseCreateSchema = z.object({
  companyId: z.string().min(1),
  billNumber: z.union([z.string(), z.number()]).optional(),
  billNo: z.union([z.string(), z.number()]).optional(),
  billDate: z.string().min(1),
  farmerName: z.string().min(1),
  farmerAddress: z.string().optional(),
  farmerContact: z.string().optional(),
  krashakAnubandhNumber: z.string().optional(),
  markaNumber: z.string().optional(),
  productId: z.string().min(1),
  noOfBags: z.union([z.string(), z.number()]).optional(),
  hammali: z.union([z.string(), z.number()]).optional(),
  weight: z.union([z.string(), z.number()]),
  rate: z.union([z.string(), z.number()]),
  payableAmount: z.union([z.string(), z.number()]).optional(),
  totalAmount: z.union([z.string(), z.number()]).optional(),
  paidAmount: z.union([z.string(), z.number()]).optional(),
  balance: z.union([z.string(), z.number()]).optional(),
  paymentStatus: z.string().optional(),
  status: z.string().optional(),
  userUnitName: z.string().optional().nullable(),
  kgEquivalent: z.union([z.string(), z.number()]).optional().nullable(),
  totalWeightQt: z.union([z.string(), z.number()]).optional().nullable()
})

const purchaseUpdateSchema = purchaseCreateSchema.extend({
  id: z.string().min(1),
  balanceAmount: z.union([z.string(), z.number()]).optional()
})

function parseRequiredNonNegative(value: unknown, label: string): number | NextResponse {
  const num = parseNonNegativeNumber(value)
  if (num === null) {
    return NextResponse.json({ error: `${label} must be a non-negative number` }, { status: 400 })
  }
  return num
}

function clampNonNegative(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

function sanitizePurchaseBill<T extends {
  totalAmount?: unknown
  paidAmount?: unknown
  balanceAmount?: unknown
  status?: unknown
  purchaseItems?: Array<{
    qty?: unknown
    rate?: unknown
    hammali?: unknown
    amount?: unknown
    kgEquivalent?: unknown
    totalWeightQt?: unknown
  }>
}>(bill: T): T {
  const safeTotalAmount = clampNonNegative(bill.totalAmount)
  const safePaidAmount = clampNonNegative(bill.paidAmount)
  const safeBalanceAmount = Math.max(0, safeTotalAmount - safePaidAmount)

  return {
    ...bill,
    totalAmount: safeTotalAmount,
    paidAmount: safePaidAmount,
    balanceAmount: safeBalanceAmount,
    status: deriveStatus(safePaidAmount, safeTotalAmount),
    purchaseItems: Array.isArray(bill.purchaseItems)
      ? bill.purchaseItems.map((item) => ({
          ...item,
          qty: clampNonNegative(item.qty),
          rate: clampNonNegative(item.rate),
          hammali: clampNonNegative(item.hammali),
          amount: clampNonNegative(item.amount),
          kgEquivalent: clampNonNegative(item.kgEquivalent),
          totalWeightQt: clampNonNegative(item.totalWeightQt)
        }))
      : bill.purchaseItems
  } as T
}

function deriveStatus(paid: number, total: number): PaymentStatus {
  if (total <= 0) return 'unpaid'
  if (paid <= 0) return 'unpaid'
  if (paid >= total) return 'paid'
  return 'partial'
}

function parseBillDate(value: string): Date | NextResponse {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return NextResponse.json({ error: 'Invalid bill date' }, { status: 400 })
  }
  return date
}

function parseBillNumber(value: unknown): string | NextResponse {
  if (value === undefined || value === null || String(value).trim() === '') {
    return NextResponse.json({ error: 'Bill number is required' }, { status: 400 })
  }
  return String(value).trim()
}

async function ensurePurchaseBillReadAccess(
  request: NextRequest,
  companyId: string
): Promise<NextResponse | null> {
  const auth = getRequestAuthContext(request)
  if (!auth) {
    return unauthorized('Authentication required')
  }

  const allowedCompany = await hasCompanyAccess(companyId, auth)
  if (!allowedCompany) {
    return forbidden('Company access denied')
  }

  if (isSuperAdmin(auth)) {
    return null
  }

  if (!auth.userDbId) {
    return forbidden('Insufficient privileges')
  }

  const permissions = await prisma.userPermission.findMany({
    where: {
      userId: auth.userDbId,
      companyId,
      module: { in: ['PURCHASE_LIST', 'PURCHASE_ENTRY'] }
    },
    select: {
      module: true,
      canRead: true,
      canWrite: true
    }
  })

  const hasListRead = permissions.some((permission) => {
    if (permission.module !== 'PURCHASE_LIST') return false
    return permission.canRead || permission.canWrite
  })

  const hasEntryWrite = permissions.some((permission) => {
    if (permission.module !== 'PURCHASE_ENTRY') return false
    return permission.canWrite
  })

  if (!hasListRead && !hasEntryWrite) {
    return forbidden('Missing privilege: PURCHASE_LIST (read) or PURCHASE_ENTRY (write)')
  }

  return null
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, purchaseCreateSchema)
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const {
      companyId,
      billNumber,
      billNo,
      billDate,
      farmerName,
      farmerAddress,
      farmerContact,
      krashakAnubandhNumber,
      markaNumber,
      productId,
      noOfBags,
      hammali,
      weight,
      rate,
      payableAmount,
      paidAmount,
      userUnitName,
      kgEquivalent,
      totalWeightQt
    } = body

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const normalizedBillNumber = parseBillNumber(billNumber ?? billNo)
    if (normalizedBillNumber instanceof NextResponse) return normalizedBillNumber

    const normalizedBillDate = parseBillDate(billDate)
    if (normalizedBillDate instanceof NextResponse) return normalizedBillDate

    const farmerPhone = normalizeTenDigitPhone(farmerContact)
    if (farmerContact !== undefined && farmerContact !== null && farmerContact !== '' && !farmerPhone) {
      return NextResponse.json({ error: 'Farmer contact must be exactly 10 digits' }, { status: 400 })
    }

    const parsedWeight = parseRequiredNonNegative(weight, 'Weight')
    if (parsedWeight instanceof NextResponse) return parsedWeight

    const parsedRate = parseRequiredNonNegative(rate, 'Rate')
    if (parsedRate instanceof NextResponse) return parsedRate

    const parsedHammali = parseNonNegativeNumber(hammali) ?? 0
    const fallbackPayable = Math.max(0, (parsedWeight * parsedRate) - parsedHammali)
    const parsedPayable = parseRequiredNonNegative(payableAmount ?? fallbackPayable, 'Payable amount')
    if (parsedPayable instanceof NextResponse) return parsedPayable

    const parsedKgEquivalent = parseNonNegativeNumber(kgEquivalent)
    const parsedTotalWeightQt = parseNonNegativeNumber(totalWeightQt) ?? parsedWeight
    const auth = getRequestAuthContext(request)
    const userId = auth?.userId || 'system'

    const purchaseBill = await prisma.$transaction(async (tx) => {
      const [company, product] = await Promise.all([
        tx.company.findFirst({
          where: { id: companyId, deletedAt: null },
          select: { id: true, name: true, mandiAccountNumber: true }
        }),
        tx.product.findFirst({
          where: { id: productId, companyId },
          select: { id: true, name: true, gstRate: true }
        })
      ])

      if (!company) {
        throw new Error('Company not found')
      }

      if (!product) {
        throw new Error('Product not found')
      }

      let farmer = await tx.farmer.findFirst({
        where: {
          companyId,
          name: farmerName
        }
      })

      if (!farmer) {
        farmer = await tx.farmer.create({
          data: {
            companyId,
            name: farmerName,
            address: farmerAddress || null,
            phone1: farmerPhone,
            krashakAnubandhNumber: krashakAnubandhNumber || null
          }
        })
      } else {
        farmer = await tx.farmer.update({
          where: { id: farmer.id },
          data: {
            address: farmerAddress || farmer.address,
            phone1: farmerPhone || farmer.phone1,
            krashakAnubandhNumber: krashakAnubandhNumber || farmer.krashakAnubandhNumber
          }
        })
      }

      const tax = calculateTaxBreakdown(parsedPayable, product.gstRate)
      const parsedFinalTotal = parseNonNegativeNumber(body.totalAmount) ?? tax.lineTotal
      const parsedPaid = parseNonNegativeNumber(paidAmount) ?? 0
      if (parsedPaid > parsedFinalTotal) {
        throw new Error('Paid amount cannot exceed total amount')
      }

      const parsedBalance = Math.max(0, parsedFinalTotal - parsedPaid)
      const finalStatus = deriveStatus(parsedPaid, parsedFinalTotal)

      const createdBill = await tx.purchaseBill.create({
        data: {
          companyId,
          billNo: normalizedBillNumber,
          billDate: normalizedBillDate,
          farmerId: farmer.id,
          farmerNameSnapshot: farmerName,
          farmerAddressSnapshot: farmerAddress || null,
          farmerContactSnapshot: farmerPhone || null,
          krashakAnubandhSnapshot: krashakAnubandhNumber || null,
          companyNameSnapshot: company.name,
          mandiAccountNumberSnapshot: company.mandiAccountNumber || null,
          subTotalAmount: tax.taxableAmount,
          gstAmount: tax.gstAmount,
          totalAmount: parsedFinalTotal,
          paidAmount: parsedPaid,
          balanceAmount: parsedBalance,
          status: finalStatus,
          createdBy: userId
        }
      })

      await tx.purchaseItem.create({
        data: {
          purchaseBillId: createdBill.id,
          productId,
          productNameSnapshot: product.name,
          qty: parsedWeight,
          rate: parsedRate,
          hammali: parsedHammali,
          bags: noOfBags ? parseInt(String(noOfBags), 10) : null,
          markaNo: markaNumber || null,
          taxableAmount: tax.taxableAmount,
          gstRateSnapshot: tax.gstRate,
          gstAmount: tax.gstAmount,
          lineTotal: tax.lineTotal,
          amount: parsedPayable,
          userUnitName: userUnitName || null,
          kgEquivalent: parsedKgEquivalent,
          totalWeightQt: parsedTotalWeightQt
        }
      })

      await tx.stockLedger.create({
        data: {
          companyId,
          entryDate: normalizedBillDate,
          productId,
          type: 'purchase',
          qtyIn: parsedWeight,
          refTable: 'purchase_bills',
          refId: createdBill.id
        }
      })

      return createdBill
    })

    return NextResponse.json({ success: true, id: purchaseBill.id, purchaseBill })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('cannot exceed') ? 400 : message.includes('not found') ? 404 : 500
    return NextResponse.json(
      {
        error: message
      },
      { status }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')?.trim() || null
    const last = searchParams.get('last')
    const billId = searchParams.get('billId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (billId) {
      let targetCompanyId = companyId

      if (!targetCompanyId) {
        const billLookup = await prisma.purchaseBill.findFirst({
          where: { id: billId },
          select: { companyId: true }
        })

        if (!billLookup) {
          return NextResponse.json({ error: 'Purchase bill not found' }, { status: 404 })
        }

        targetCompanyId = billLookup.companyId
      }

      const denied = await ensurePurchaseBillReadAccess(request, targetCompanyId)
      if (denied) return denied

      const purchaseBill = await prisma.purchaseBill.findFirst({
        where: { id: billId, companyId: targetCompanyId },
        include: {
          company: {
            select: {
              id: true,
              name: true,
              mandiAccountNumber: true
            }
          },
          farmer: true,
          purchaseItems: {
            include: {
              product: true
            }
          }
        }
      })

      if (!purchaseBill) {
        return NextResponse.json({ error: 'Purchase bill not found' }, { status: 404 })
      }
      return NextResponse.json(sanitizePurchaseBill(purchaseBill))
    }

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (last === 'true') {
      const bills = await prisma.purchaseBill.findMany({
        where: { companyId },
        select: { billNo: true }
      })
      const lastBillNumber = bills.reduce((max, bill) => {
        const value = Number.parseInt(bill.billNo, 10)
        return Number.isFinite(value) ? Math.max(max, value) : max
      }, 0)
      return NextResponse.json({ lastBillNumber })
    }

    const whereClause: {
      companyId: string
      billDate?: { gte?: Date; lte?: Date }
      OR?: Array<{ billNo: { contains: string } } | { status: { contains: string } }>
    } = { companyId }

    if (dateFrom || dateTo) {
      whereClause.billDate = {}
      if (dateFrom) whereClause.billDate.gte = new Date(dateFrom)
      if (dateTo) whereClause.billDate.lte = new Date(dateTo)
    }

    const pagination = parsePaginationParams(searchParams, { defaultPageSize: 50, maxPageSize: 200 })
    if (pagination.search) {
      whereClause.OR = [{ billNo: { contains: pagination.search } }, { status: { contains: pagination.search } }]
    }

    const [purchaseBills, total] = await Promise.all([
      prisma.purchaseBill.findMany({
        where: whereClause,
        include: {
          company: {
            select: {
              id: true,
              name: true,
              mandiAccountNumber: true
            }
          },
          farmer: true,
          purchaseItems: {
            include: {
              product: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        ...(pagination.enabled ? { skip: pagination.skip, take: pagination.pageSize } : {})
      }),
      pagination.enabled ? prisma.purchaseBill.count({ where: whereClause }) : Promise.resolve(0)
    ])

    const safePurchaseBills = purchaseBills.map((bill) => sanitizePurchaseBill(bill))

    if (pagination.enabled) {
      return NextResponse.json({
        data: safePurchaseBills,
        meta: buildPaginationMeta(total, pagination)
      })
    }

    return NextResponse.json(safePurchaseBills)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const billId = searchParams.get('billId')
    const companyId = searchParams.get('companyId')

    if (!billId || !companyId) {
      return NextResponse.json({ error: 'Bill ID and Company ID are required' }, { status: 400 })
    }
    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const purchaseBill = await prisma.purchaseBill.findFirst({
      where: { id: billId, companyId },
      include: {
        purchaseItems: true
      }
    })

    if (!purchaseBill) {
      return NextResponse.json({ error: 'Purchase bill not found' }, { status: 404 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.stockLedger.deleteMany({
        where: {
          refTable: 'purchase_bills',
          refId: billId
        }
      })

      await tx.purchaseItem.deleteMany({
        where: { purchaseBillId: billId }
      })

      await tx.purchaseBill.delete({
        where: { id: billId }
      })
    })

    return NextResponse.json({ success: true, message: 'Purchase bill deleted successfully' })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, purchaseUpdateSchema)
    if (!parsed.ok) return parsed.response

    const body = parsed.data
    const {
      id,
      companyId,
      billNumber,
      billNo,
      billDate,
      farmerName,
      farmerAddress,
      farmerContact,
      krashakAnubandhNumber,
      markaNumber,
      productId,
      noOfBags,
      hammali,
      weight,
      rate,
      payableAmount,
      paidAmount,
      userUnitName,
      kgEquivalent,
      totalWeightQt
    } = body

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const normalizedBillNumber = parseBillNumber(billNumber ?? billNo)
    if (normalizedBillNumber instanceof NextResponse) return normalizedBillNumber

    const normalizedBillDate = parseBillDate(billDate)
    if (normalizedBillDate instanceof NextResponse) return normalizedBillDate

    const farmerPhone = normalizeTenDigitPhone(farmerContact)
    if (farmerContact !== undefined && farmerContact !== null && farmerContact !== '' && !farmerPhone) {
      return NextResponse.json({ error: 'Farmer contact must be exactly 10 digits' }, { status: 400 })
    }

    const parsedWeight = parseRequiredNonNegative(weight, 'Weight')
    if (parsedWeight instanceof NextResponse) return parsedWeight

    const parsedRate = parseRequiredNonNegative(rate, 'Rate')
    if (parsedRate instanceof NextResponse) return parsedRate

    const parsedHammali = parseNonNegativeNumber(hammali) ?? 0
    const fallbackPayable = Math.max(0, (parsedWeight * parsedRate) - parsedHammali)
    const parsedPayable = parseRequiredNonNegative(payableAmount ?? fallbackPayable, 'Payable amount')
    if (parsedPayable instanceof NextResponse) return parsedPayable

    const parsedKgEquivalent = parseNonNegativeNumber(kgEquivalent)
    const parsedTotalWeightQt = parseNonNegativeNumber(totalWeightQt) ?? parsedWeight

    const purchaseBill = await prisma.$transaction(async (tx) => {
      const existingBill = await tx.purchaseBill.findFirst({
        where: { id, companyId },
        include: {
          purchaseItems: { select: { id: true } }
        }
      })

      if (!existingBill) {
        throw new Error('Purchase bill not found')
      }

      const [company, product] = await Promise.all([
        tx.company.findFirst({
          where: { id: companyId, deletedAt: null },
          select: { id: true, name: true, mandiAccountNumber: true }
        }),
        tx.product.findFirst({
          where: { id: productId, companyId },
          select: { id: true, name: true, gstRate: true }
        })
      ])

      if (!company) {
        throw new Error('Company not found')
      }

      if (!product) {
        throw new Error('Product not found')
      }

      let farmer = await tx.farmer.findFirst({
        where: {
          companyId,
          name: farmerName
        }
      })

      if (!farmer) {
        farmer = await tx.farmer.create({
          data: {
            companyId,
            name: farmerName,
            address: farmerAddress || null,
            phone1: farmerPhone,
            krashakAnubandhNumber: krashakAnubandhNumber || null
          }
        })
      } else {
        farmer = await tx.farmer.update({
          where: { id: farmer.id },
          data: {
            address: farmerAddress || farmer.address,
            phone1: farmerPhone || farmer.phone1,
            krashakAnubandhNumber: krashakAnubandhNumber || farmer.krashakAnubandhNumber
          }
        })
      }

    const tax = calculateTaxBreakdown(parsedPayable, product.gstRate)
    const parsedFinalTotal = parseNonNegativeNumber(body.totalAmount) ?? tax.lineTotal
    const parsedPaid = parseNonNegativeNumber(paidAmount) ?? 0
    if (parsedPaid > parsedFinalTotal) {
      throw new Error('Paid amount cannot exceed total amount')
    }

    const parsedBalance = Math.max(0, parsedFinalTotal - parsedPaid)
    const finalStatus = deriveStatus(parsedPaid, parsedFinalTotal)

      const updatedBill = await tx.purchaseBill.update({
        where: { id },
        data: {
          companyId,
          billNo: normalizedBillNumber,
          billDate: normalizedBillDate,
          farmerId: farmer.id,
          farmerNameSnapshot: farmerName,
          farmerAddressSnapshot: farmerAddress || null,
          farmerContactSnapshot: farmerPhone || null,
          krashakAnubandhSnapshot: krashakAnubandhNumber || null,
          companyNameSnapshot: company.name,
          mandiAccountNumberSnapshot: company.mandiAccountNumber || null,
          subTotalAmount: tax.taxableAmount,
          gstAmount: tax.gstAmount,
          totalAmount: parsedFinalTotal,
          paidAmount: parsedPaid,
          balanceAmount: parsedBalance,
          status: finalStatus
        }
      })

      const existingItemId = existingBill.purchaseItems[0]?.id
      if (existingItemId) {
        await tx.purchaseItem.update({
          where: { id: existingItemId },
          data: {
            productId,
            productNameSnapshot: product.name,
            qty: parsedWeight,
            rate: parsedRate,
            hammali: parsedHammali,
            bags: noOfBags ? parseInt(String(noOfBags), 10) : null,
            markaNo: markaNumber || null,
            taxableAmount: tax.taxableAmount,
            gstRateSnapshot: tax.gstRate,
            gstAmount: tax.gstAmount,
            lineTotal: tax.lineTotal,
            amount: parsedPayable,
            userUnitName: userUnitName || null,
            kgEquivalent: parsedKgEquivalent,
            totalWeightQt: parsedTotalWeightQt
          }
        })
      } else {
        await tx.purchaseItem.create({
          data: {
            purchaseBillId: id,
            productId,
            productNameSnapshot: product.name,
            qty: parsedWeight,
            rate: parsedRate,
            hammali: parsedHammali,
            bags: noOfBags ? parseInt(String(noOfBags), 10) : null,
            markaNo: markaNumber || null,
            taxableAmount: tax.taxableAmount,
            gstRateSnapshot: tax.gstRate,
            gstAmount: tax.gstAmount,
            lineTotal: tax.lineTotal,
            amount: parsedPayable,
            userUnitName: userUnitName || null,
            kgEquivalent: parsedKgEquivalent,
            totalWeightQt: parsedTotalWeightQt
          }
        })
      }

      const existingLedger = await tx.stockLedger.findFirst({
        where: {
          refTable: 'purchase_bills',
          refId: id
        }
      })

      if (existingLedger) {
        await tx.stockLedger.update({
          where: { id: existingLedger.id },
          data: {
            companyId,
            entryDate: normalizedBillDate,
            productId,
            qtyIn: parsedWeight
          }
        })
      } else {
        await tx.stockLedger.create({
          data: {
            companyId,
            entryDate: normalizedBillDate,
            productId,
            type: 'purchase',
            qtyIn: parsedWeight,
            refTable: 'purchase_bills',
            refId: id
          }
        })
      }

      return updatedBill
    })

    return NextResponse.json({ success: true, id: purchaseBill.id, purchaseBill })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('cannot exceed') ? 400 : message.includes('not found') ? 404 : 500
    return NextResponse.json(
      {
        error: message
      },
      { status }
    )
  }
}
