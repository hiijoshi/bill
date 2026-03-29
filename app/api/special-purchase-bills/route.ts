import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess, parseBooleanParam, parseJsonWithSchema, requireAuthContext } from '@/lib/api-security'
import { cleanString, normalizeTenDigitPhone, parseNonNegativeNumber } from '@/lib/field-validation'
import { calculateTaxBreakdown, roundCurrency } from '@/lib/billing-calculations'
import { buildPurchasePaymentSyncNote } from '@/lib/purchase-payment-sync'

const writeSchema = z.object({
  id: z.string().optional(),
  companyId: z.string().trim().min(1),
  supplierInvoiceNo: z.string().trim().min(1),
  billDate: z.string().trim().min(1),
  supplierName: z.string().trim().min(1),
  supplierAddress: z.string().optional().nullable(),
  supplierContact: z.string().optional().nullable(),
  supplierContact2: z.string().optional().nullable(),
  supplierGstNumber: z.string().optional().nullable(),
  supplierIfscCode: z.string().optional().nullable(),
  supplierBankName: z.string().optional().nullable(),
  supplierAccountNo: z.string().optional().nullable(),
  productId: z.string().trim().min(1),
  noOfBags: z.union([z.number(), z.string()]).optional().nullable(),
  weight: z.union([z.number(), z.string()]),
  rate: z.union([z.number(), z.string()]),
  netAmount: z.union([z.number(), z.string()]).optional().nullable(),
  otherAmount: z.union([z.number(), z.string()]).optional().nullable(),
  grossAmount: z.union([z.number(), z.string()]).optional().nullable(),
  paidAmount: z.union([z.number(), z.string()]).optional().nullable(),
  balance: z.union([z.number(), z.string()]).optional().nullable(),
  balanceAmount: z.union([z.number(), z.string()]).optional().nullable(),
  paymentStatus: z.string().optional().nullable(),
  status: z.string().optional().nullable()
}).strict()

function clampNonNegative(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

function deriveStatus(paid: number, total: number): 'unpaid' | 'partial' | 'paid' {
  if (total <= 0) return 'unpaid'
  if (paid <= 0) return 'unpaid'
  if (paid >= total) return 'paid'
  return 'partial'
}

function sanitizeSpecialPurchaseBill<T extends {
  totalAmount?: unknown
  paidAmount?: unknown
  balanceAmount?: unknown
  status?: unknown
  specialPurchaseItems?: Array<{
    noOfBags?: unknown
    weight?: unknown
    rate?: unknown
    netAmount?: unknown
    otherAmount?: unknown
    grossAmount?: unknown
  }>
}>(bill: T): T {
  const safeTotalAmount = clampNonNegative(bill.totalAmount)
  const safePaidAmount = clampNonNegative(bill.paidAmount)
  const rawStatus = String(bill.status || '').trim().toLowerCase()
  const safeBalanceAmount =
    rawStatus === 'cancelled'
      ? clampNonNegative(bill.balanceAmount)
      : Math.max(0, safeTotalAmount - safePaidAmount)

  return {
    ...bill,
    totalAmount: safeTotalAmount,
    paidAmount: safePaidAmount,
    balanceAmount: safeBalanceAmount,
    status: rawStatus === 'cancelled' ? 'cancelled' : deriveStatus(safePaidAmount, safeTotalAmount),
    specialPurchaseItems: Array.isArray(bill.specialPurchaseItems)
      ? bill.specialPurchaseItems.map((item) => ({
          ...item,
          noOfBags: clampNonNegative(item.noOfBags),
          weight: clampNonNegative(item.weight),
          rate: clampNonNegative(item.rate),
          netAmount: clampNonNegative(item.netAmount),
          otherAmount: clampNonNegative(item.otherAmount),
          grossAmount: clampNonNegative(item.grossAmount)
        }))
      : bill.specialPurchaseItems
  } as T
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, writeSchema)
    if (!parsed.ok) return parsed.response

    const body = parsed.data

    const denied = await ensureCompanyAccess(request, body.companyId)
    if (denied) return denied
    const supplierPhone = normalizeTenDigitPhone(body.supplierContact)
    const supplierPhone2 = normalizeTenDigitPhone(body.supplierContact2)
    if (body.supplierContact && !supplierPhone) {
      return NextResponse.json({ error: 'Supplier contact must be exactly 10 digits' }, { status: 400 })
    }
    if (body.supplierContact2 && !supplierPhone2) {
      return NextResponse.json({ error: 'Supplier alternate contact must be exactly 10 digits' }, { status: 400 })
    }

    const weight = parseNonNegativeNumber(body.weight)
    const rate = parseNonNegativeNumber(body.rate)
    const netAmount = parseNonNegativeNumber(body.netAmount)
    const otherAmount = parseNonNegativeNumber(body.otherAmount) ?? 0
    const paidAmount = parseNonNegativeNumber(body.paidAmount) ?? 0
    if (weight === null) return NextResponse.json({ error: 'Weight must be a non-negative number' }, { status: 400 })
    if (rate === null) return NextResponse.json({ error: 'Rate must be a non-negative number' }, { status: 400 })
    if (netAmount === null) return NextResponse.json({ error: 'Net amount must be a non-negative number' }, { status: 400 })

    const authResult = requireAuthContext(request)
    if (!authResult.ok) return authResult.response
    const userId = authResult.auth.userId

    const product = await prisma.product.findFirst({
      where: {
        id: body.productId,
        companyId: body.companyId
      },
      select: {
        id: true,
        gstRate: true
      }
    })

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const tax = calculateTaxBreakdown(netAmount, product.gstRate)
    const grossAmount = parseNonNegativeNumber(body.grossAmount) ?? roundCurrency(tax.lineTotal + otherAmount)
    if (paidAmount > grossAmount) {
      return NextResponse.json({ error: 'Paid amount cannot exceed gross amount' }, { status: 400 })
    }
    const balanceAmount = Math.max(0, grossAmount - paidAmount)
    const normalizedStatus = deriveStatus(paidAmount, grossAmount)

    const billDateValue = new Date(body.billDate)

    const specialPurchaseBill = await prisma.$transaction(async (tx) => {
      let supplier = await tx.supplier.findFirst({
        where: {
          companyId: body.companyId,
          name: body.supplierName,
        },
      })

      if (!supplier) {
        supplier = await tx.supplier.create({
          data: {
            companyId: body.companyId,
            name: body.supplierName,
            address: cleanString(body.supplierAddress),
            phone1: supplierPhone,
            phone2: supplierPhone2,
            gstNumber: cleanString(body.supplierGstNumber),
            ifscCode: cleanString(body.supplierIfscCode)?.toUpperCase() || null,
            bankName: cleanString(body.supplierBankName),
            accountNo: cleanString(body.supplierAccountNo),
          },
        })
      } else {
        supplier = await tx.supplier.update({
          where: { id: supplier.id },
          data: {
            address: cleanString(body.supplierAddress) ?? supplier.address,
            phone1: supplierPhone || supplier.phone1,
            phone2: supplierPhone2 || supplier.phone2,
            gstNumber: cleanString(body.supplierGstNumber) ?? supplier.gstNumber,
            ifscCode: cleanString(body.supplierIfscCode)?.toUpperCase() ?? supplier.ifscCode,
            bankName: cleanString(body.supplierBankName) ?? supplier.bankName,
            accountNo: cleanString(body.supplierAccountNo) ?? supplier.accountNo,
          },
        })
      }

      const createdBill = await tx.specialPurchaseBill.create({
        data: {
          companyId: body.companyId,
          supplierInvoiceNo: body.supplierInvoiceNo,
          billDate: billDateValue,
          supplierId: supplier.id,
          subTotalAmount: tax.taxableAmount,
          gstAmount: tax.gstAmount,
          totalAmount: grossAmount,
          paidAmount,
          balanceAmount,
          status: normalizedStatus,
          createdBy: userId,
        },
      })

      await tx.specialPurchaseItem.create({
        data: {
          specialPurchaseBillId: createdBill.id,
          productId: body.productId,
          noOfBags: body.noOfBags ? parseInt(String(body.noOfBags), 10) : null,
          weight,
          rate,
          taxableAmount: tax.taxableAmount,
          gstRateSnapshot: tax.gstRate,
          gstAmount: tax.gstAmount,
          netAmount: tax.taxableAmount,
          otherAmount,
          grossAmount,
        },
      })

      await tx.stockLedger.create({
        data: {
          companyId: body.companyId,
          entryDate: billDateValue,
          productId: body.productId,
          type: 'purchase',
          qtyIn: weight,
          refTable: 'special_purchase_bills',
          refId: createdBill.id,
        },
      })

      if (paidAmount > 0) {
        await tx.payment.create({
          data: {
            companyId: body.companyId,
            billType: 'purchase',
            billId: createdBill.id,
            billDate: billDateValue,
            payDate: billDateValue,
            amount: paidAmount,
            mode: 'cash',
            cashAmount: paidAmount,
            cashPaymentDate: billDateValue,
            onlinePayAmount: null,
            onlinePaymentDate: null,
            status: 'paid',
            note: buildPurchasePaymentSyncNote('special'),
            farmerId: null,
            partyId: null
          }
        })
      }

      return createdBill
    })

    return NextResponse.json({ success: true, specialPurchaseBill })
  } catch (error) {
    console.error('Error creating special purchase bill:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    const billId = searchParams.get('billId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const includeCancelled = parseBooleanParam(searchParams.get('includeCancelled'))

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (billId) {
      const specialPurchaseBill = await prisma.specialPurchaseBill.findFirst({
        where: {
          id: billId,
          companyId,
          ...(includeCancelled ? {} : { status: { not: 'cancelled' } })
        },
        include: {
          supplier: true,
          specialPurchaseItems: {
            include: {
              product: true,
            },
          },
        },
      })

      if (!specialPurchaseBill) {
        return NextResponse.json({ error: 'Special purchase bill not found' }, { status: 404 })
      }

      return NextResponse.json(sanitizeSpecialPurchaseBill(specialPurchaseBill))
    }

    const whereClause: {
      companyId: string
      status?: { not: string }
      billDate?: {
        gte?: Date
        lte?: Date
      }
    } = {
      companyId,
      ...(includeCancelled ? {} : { status: { not: 'cancelled' } })
    }

    if (dateFrom || dateTo) {
      whereClause.billDate = {}
      if (dateFrom) {
        whereClause.billDate.gte = new Date(dateFrom)
      }
      if (dateTo) {
        whereClause.billDate.lte = new Date(dateTo)
      }
    }

    const specialPurchaseBills = await prisma.specialPurchaseBill.findMany({
      where: whereClause,
      include: {
        supplier: true,
        specialPurchaseItems: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(specialPurchaseBills.map((bill) => sanitizeSpecialPurchaseBill(bill)))
  } catch (error) {
    console.error('Error fetching special purchase bills:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, writeSchema)
    if (!parsed.ok) return parsed.response

    const body = parsed.data

    if (!body.id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, body.companyId)
    if (denied) return denied
    const supplierPhone = normalizeTenDigitPhone(body.supplierContact)
    const supplierPhone2 = normalizeTenDigitPhone(body.supplierContact2)
    if (body.supplierContact && !supplierPhone) {
      return NextResponse.json({ error: 'Supplier contact must be exactly 10 digits' }, { status: 400 })
    }
    if (body.supplierContact2 && !supplierPhone2) {
      return NextResponse.json({ error: 'Supplier alternate contact must be exactly 10 digits' }, { status: 400 })
    }

    const weight = parseNonNegativeNumber(body.weight)
    const rate = parseNonNegativeNumber(body.rate)
    const netAmount = parseNonNegativeNumber(body.netAmount)
    const otherAmount = parseNonNegativeNumber(body.otherAmount) ?? 0
    const paidAmount = parseNonNegativeNumber(body.paidAmount) ?? 0
    if (weight === null) return NextResponse.json({ error: 'Weight must be a non-negative number' }, { status: 400 })
    if (rate === null) return NextResponse.json({ error: 'Rate must be a non-negative number' }, { status: 400 })
    if (netAmount === null) return NextResponse.json({ error: 'Net amount must be a non-negative number' }, { status: 400 })

    const product = await prisma.product.findFirst({
      where: {
        id: body.productId,
        companyId: body.companyId
      },
      select: {
        id: true,
        gstRate: true
      }
    })

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const tax = calculateTaxBreakdown(netAmount, product.gstRate)
    const grossAmount = parseNonNegativeNumber(body.grossAmount) ?? roundCurrency(tax.lineTotal + otherAmount)
    if (paidAmount > grossAmount) {
      return NextResponse.json({ error: 'Paid amount cannot exceed gross amount' }, { status: 400 })
    }
    const balanceAmount = Math.max(0, grossAmount - paidAmount)
    const normalizedStatus = deriveStatus(paidAmount, grossAmount)

    const billDateValue = new Date(body.billDate)

    const specialPurchaseBill = await prisma.$transaction(async (tx) => {
      const existingBill = await tx.specialPurchaseBill.findFirst({
        where: {
          id: body.id,
          companyId: body.companyId
        },
        select: {
          id: true,
          status: true
        }
      })

      if (!existingBill) {
        throw new Error('Special purchase bill not found')
      }

      if (String(existingBill.status || '').toLowerCase() === 'cancelled') {
        throw new Error('Cancelled special purchase bill cannot be updated')
      }

      const specialPurchaseBillId = existingBill.id

      const recordedPaymentAggregate = await tx.payment.aggregate({
        where: {
          companyId: body.companyId,
          billType: 'purchase',
          billId: specialPurchaseBillId,
          deletedAt: null
        },
        _sum: {
          amount: true
        }
      })

      const recordedPaidAmount = clampNonNegative(recordedPaymentAggregate._sum.amount)

      if (recordedPaidAmount > grossAmount) {
        throw new Error('Final total cannot be less than recorded payment history')
      }

      if (paidAmount < recordedPaidAmount) {
        throw new Error('Paid amount cannot be less than recorded payment history')
      }

      const paymentDelta = Math.max(0, paidAmount - recordedPaidAmount)

      let supplier = await tx.supplier.findFirst({
        where: {
          companyId: body.companyId,
          name: body.supplierName,
        },
      })

      if (!supplier) {
        supplier = await tx.supplier.create({
          data: {
            companyId: body.companyId,
            name: body.supplierName,
            address: cleanString(body.supplierAddress),
            phone1: supplierPhone,
            phone2: supplierPhone2,
            gstNumber: cleanString(body.supplierGstNumber),
            ifscCode: cleanString(body.supplierIfscCode)?.toUpperCase() || null,
            bankName: cleanString(body.supplierBankName),
            accountNo: cleanString(body.supplierAccountNo),
          },
        })
      } else {
        supplier = await tx.supplier.update({
          where: { id: supplier.id },
          data: {
            address: cleanString(body.supplierAddress) ?? supplier.address,
            phone1: supplierPhone || supplier.phone1,
            phone2: supplierPhone2 || supplier.phone2,
            gstNumber: cleanString(body.supplierGstNumber) ?? supplier.gstNumber,
            ifscCode: cleanString(body.supplierIfscCode)?.toUpperCase() ?? supplier.ifscCode,
            bankName: cleanString(body.supplierBankName) ?? supplier.bankName,
            accountNo: cleanString(body.supplierAccountNo) ?? supplier.accountNo,
          },
        })
      }

      const updatedBill = await tx.specialPurchaseBill.update({
        where: { id: specialPurchaseBillId },
        data: {
          companyId: body.companyId,
          supplierInvoiceNo: body.supplierInvoiceNo,
          billDate: billDateValue,
          supplierId: supplier.id,
          subTotalAmount: tax.taxableAmount,
          gstAmount: tax.gstAmount,
          totalAmount: grossAmount,
          paidAmount,
          balanceAmount,
          status: normalizedStatus,
        },
      })

      const existingItem = await tx.specialPurchaseItem.findFirst({
        where: { specialPurchaseBillId },
      })

      if (existingItem) {
        await tx.specialPurchaseItem.update({
          where: { id: existingItem.id },
          data: {
            productId: body.productId,
            noOfBags: body.noOfBags ? parseInt(String(body.noOfBags), 10) : null,
            weight,
            rate,
            taxableAmount: tax.taxableAmount,
            gstRateSnapshot: tax.gstRate,
            gstAmount: tax.gstAmount,
            netAmount: tax.taxableAmount,
            otherAmount,
            grossAmount,
          },
        })
      } else {
        await tx.specialPurchaseItem.create({
          data: {
            specialPurchaseBillId,
            productId: body.productId,
            noOfBags: body.noOfBags ? parseInt(String(body.noOfBags), 10) : null,
            weight,
            rate,
            taxableAmount: tax.taxableAmount,
            gstRateSnapshot: tax.gstRate,
            gstAmount: tax.gstAmount,
            netAmount: tax.taxableAmount,
            otherAmount,
            grossAmount,
          },
        })
      }

      const existingLedger = await tx.stockLedger.findFirst({
        where: {
          refTable: 'special_purchase_bills',
          refId: specialPurchaseBillId,
        },
        select: {
          id: true
        }
      })

      if (existingLedger) {
        await tx.stockLedger.update({
          where: { id: existingLedger.id },
          data: {
            entryDate: billDateValue,
            productId: body.productId,
            qtyIn: weight,
          },
        })
      } else {
        await tx.stockLedger.create({
          data: {
            companyId: body.companyId,
            entryDate: billDateValue,
            productId: body.productId,
            type: 'purchase',
            qtyIn: weight,
            refTable: 'special_purchase_bills',
            refId: specialPurchaseBillId,
          },
        })
      }

      if (paymentDelta > 0) {
        await tx.payment.create({
          data: {
            companyId: body.companyId,
            billType: 'purchase',
            billId: specialPurchaseBillId,
            billDate: billDateValue,
            payDate: billDateValue,
            amount: paymentDelta,
            mode: 'cash',
            cashAmount: paymentDelta,
            cashPaymentDate: billDateValue,
            onlinePayAmount: null,
            onlinePaymentDate: null,
            status: 'paid',
            note: buildPurchasePaymentSyncNote('special'),
            farmerId: null,
            partyId: null
          }
        })
      }

      return updatedBill
    })

    return NextResponse.json({ success: true, specialPurchaseBill })
  } catch (error) {
    console.error('Error updating special purchase bill:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    const status =
      errorMessage.includes('cannot exceed') ||
      errorMessage.includes('cannot be less than') ||
      errorMessage.includes('recorded payment history') ||
      errorMessage.includes('cancelled')
        ? 400
        : errorMessage.includes('not found')
          ? 404
          : 500
    return NextResponse.json({ error: errorMessage }, { status })
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
    return NextResponse.json({ error: 'Not authorised to delete this entry.' }, { status: 403 })
  } catch (error) {
    console.error('Error deleting special purchase bill:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
