import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'
import { cleanString, normalizeTenDigitPhone, parseNonNegativeNumber } from '@/lib/field-validation'

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
  const safeBalanceAmount = Math.max(0, safeTotalAmount - safePaidAmount)

  return {
    ...bill,
    totalAmount: safeTotalAmount,
    paidAmount: safePaidAmount,
    balanceAmount: safeBalanceAmount,
    status: deriveStatus(safePaidAmount, safeTotalAmount),
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
    const grossAmount = parseNonNegativeNumber(body.grossAmount)
    const paidAmount = parseNonNegativeNumber(body.paidAmount) ?? 0
    if (weight === null) return NextResponse.json({ error: 'Weight must be a non-negative number' }, { status: 400 })
    if (rate === null) return NextResponse.json({ error: 'Rate must be a non-negative number' }, { status: 400 })
    if (netAmount === null) return NextResponse.json({ error: 'Net amount must be a non-negative number' }, { status: 400 })
    if (grossAmount === null) return NextResponse.json({ error: 'Gross amount must be a non-negative number' }, { status: 400 })
    if (paidAmount > grossAmount) {
      return NextResponse.json({ error: 'Paid amount cannot exceed gross amount' }, { status: 400 })
    }
    const balanceAmount = Math.max(0, grossAmount - paidAmount)
    const normalizedStatus = deriveStatus(paidAmount, grossAmount)

    const cookieStore = await cookies()
    const userId = cookieStore.get('userId')?.value || 'test-user'

    let supplier = await prisma.supplier.findFirst({
      where: {
        companyId: body.companyId,
        name: body.supplierName,
      },
    })

    if (!supplier) {
      supplier = await prisma.supplier.create({
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
      supplier = await prisma.supplier.update({
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

    const specialPurchaseBill = await prisma.specialPurchaseBill.create({
      data: {
        companyId: body.companyId,
        supplierInvoiceNo: body.supplierInvoiceNo,
        billDate: new Date(body.billDate),
        supplierId: supplier.id,
        totalAmount: grossAmount,
        paidAmount,
        balanceAmount,
        status: normalizedStatus,
        createdBy: userId,
      },
    })

    await prisma.specialPurchaseItem.create({
      data: {
        specialPurchaseBillId: specialPurchaseBill.id,
        productId: body.productId,
        noOfBags: body.noOfBags ? parseInt(String(body.noOfBags), 10) : null,
        weight,
        rate,
        netAmount,
        otherAmount,
        grossAmount,
      },
    })

    await prisma.stockLedger.create({
      data: {
        companyId: body.companyId,
        entryDate: new Date(body.billDate),
        productId: body.productId,
        type: 'purchase',
        qtyIn: weight,
        refTable: 'special_purchase_bills',
        refId: specialPurchaseBill.id,
      },
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

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (billId) {
      const specialPurchaseBill = await prisma.specialPurchaseBill.findFirst({
        where: {
          id: billId,
          companyId
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
      billDate?: {
        gte?: Date
        lte?: Date
      }
    } = { companyId }

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
    const grossAmount = parseNonNegativeNumber(body.grossAmount)
    const paidAmount = parseNonNegativeNumber(body.paidAmount) ?? 0
    if (weight === null) return NextResponse.json({ error: 'Weight must be a non-negative number' }, { status: 400 })
    if (rate === null) return NextResponse.json({ error: 'Rate must be a non-negative number' }, { status: 400 })
    if (netAmount === null) return NextResponse.json({ error: 'Net amount must be a non-negative number' }, { status: 400 })
    if (grossAmount === null) return NextResponse.json({ error: 'Gross amount must be a non-negative number' }, { status: 400 })
    if (paidAmount > grossAmount) {
      return NextResponse.json({ error: 'Paid amount cannot exceed gross amount' }, { status: 400 })
    }
    const balanceAmount = Math.max(0, grossAmount - paidAmount)
    const normalizedStatus = deriveStatus(paidAmount, grossAmount)

    let supplier = await prisma.supplier.findFirst({
      where: {
        companyId: body.companyId,
        name: body.supplierName,
      },
    })

    if (!supplier) {
      supplier = await prisma.supplier.create({
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
      supplier = await prisma.supplier.update({
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

    const specialPurchaseBill = await prisma.specialPurchaseBill.update({
      where: { id: body.id },
      data: {
        companyId: body.companyId,
        supplierInvoiceNo: body.supplierInvoiceNo,
        billDate: new Date(body.billDate),
        supplierId: supplier.id,
        totalAmount: grossAmount,
        paidAmount,
        balanceAmount,
        status: normalizedStatus,
      },
    })

    const existingItem = await prisma.specialPurchaseItem.findFirst({
      where: { specialPurchaseBillId: body.id },
    })

    if (existingItem) {
      await prisma.specialPurchaseItem.update({
        where: { id: existingItem.id },
        data: {
          productId: body.productId,
          noOfBags: body.noOfBags ? parseInt(String(body.noOfBags), 10) : null,
          weight,
          rate,
          netAmount,
          otherAmount,
          grossAmount,
        },
      })
    } else {
      await prisma.specialPurchaseItem.create({
        data: {
          specialPurchaseBillId: body.id,
          productId: body.productId,
          noOfBags: body.noOfBags ? parseInt(String(body.noOfBags), 10) : null,
          weight,
          rate,
          netAmount,
          otherAmount,
          grossAmount,
        },
      })
    }

    await prisma.stockLedger.updateMany({
      where: {
        refTable: 'special_purchase_bills',
        refId: body.id,
      },
      data: {
        entryDate: new Date(body.billDate),
        productId: body.productId,
        qtyIn: weight,
      },
    })

    return NextResponse.json({ success: true, specialPurchaseBill })
  } catch (error) {
    console.error('Error updating special purchase bill:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
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

    const specialPurchaseBill = await prisma.specialPurchaseBill.findFirst({
      where: {
        id: billId,
        companyId,
      },
    })

    if (!specialPurchaseBill) {
      return NextResponse.json({ error: 'Special purchase bill not found' }, { status: 404 })
    }

    await prisma.specialPurchaseItem.deleteMany({
      where: { specialPurchaseBillId: billId },
    })

    await prisma.stockLedger.deleteMany({
      where: {
        refTable: 'special_purchase_bills',
        refId: billId,
      },
    })

    await prisma.specialPurchaseBill.delete({
      where: { id: billId },
    })

    return NextResponse.json({ success: true, message: 'Special purchase bill deleted successfully' })
  } catch (error) {
    console.error('Error deleting special purchase bill:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
