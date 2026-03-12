import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'

const postSchema = z.object({
  companyId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  salesItemName: z.string().trim().min(1),
  hsnCode: z.string().optional().nullable(),
  gstRate: z.union([z.number(), z.string()]).optional().nullable(),
  sellingPrice: z.union([z.number(), z.string()]).optional().nullable(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

const putSchema = z.object({
  productId: z.string().trim().min(1).optional(),
  salesItemName: z.string().trim().min(1).optional(),
  hsnCode: z.string().optional().nullable(),
  gstRate: z.union([z.number(), z.string()]).optional().nullable(),
  sellingPrice: z.union([z.number(), z.string()]).optional().nullable(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const salesItemMasters = await prisma.salesItemMaster.findMany({
      where: { companyId },
      include: {
        product: {
          include: { unit: true }
        }
      },
      orderBy: { salesItemName: 'asc' }
    })

    return NextResponse.json(salesItemMasters)
  } catch (error) {
    console.error('Error fetching sales item masters:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, postSchema)
    if (!parsed.ok) return parsed.response

    const denied = await ensureCompanyAccess(request, parsed.data.companyId)
    if (denied) return denied

    const product = await prisma.product.findFirst({
      where: { id: parsed.data.productId, companyId: parsed.data.companyId },
      include: { unit: true }
    })

    if (!product) {
      return NextResponse.json({ error: 'Product not found in this company' }, { status: 404 })
    }

    const existing = await prisma.salesItemMaster.findFirst({
      where: {
        companyId: parsed.data.companyId,
        productId: parsed.data.productId
      }
    })

    if (existing) {
      return NextResponse.json({ error: 'Sales item already exists for this product' }, { status: 400 })
    }

    const created = await prisma.salesItemMaster.create({
      data: {
        companyId: parsed.data.companyId,
        productId: parsed.data.productId,
        salesItemName: parsed.data.salesItemName.trim(),
        hsnCode: parsed.data.hsnCode || null,
        gstRate: parsed.data.gstRate !== undefined && parsed.data.gstRate !== null ? parseFloat(String(parsed.data.gstRate)) : null,
        sellingPrice: parsed.data.sellingPrice !== undefined && parsed.data.sellingPrice !== null ? parseFloat(String(parsed.data.sellingPrice)) : null,
        description: parsed.data.description || null,
        isActive: parsed.data.isActive !== false
      },
      include: {
        product: {
          include: { unit: true }
        }
      }
    })

    return NextResponse.json(created)
  } catch (error) {
    console.error('Error creating sales item master:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, putSchema)
    if (!parsed.ok) return parsed.response

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const companyId = searchParams.get('companyId')

    if (!id || !companyId) {
      return NextResponse.json({ error: 'Sales Item Master ID and Company ID are required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const existing = await prisma.salesItemMaster.findFirst({
      where: { id, companyId }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Sales Item Master not found' }, { status: 404 })
    }

    const nextProductId = parsed.data.productId ?? existing.productId
    if (nextProductId !== existing.productId) {
      const product = await prisma.product.findFirst({
        where: { id: nextProductId, companyId }
      })
      if (!product) {
        return NextResponse.json({ error: 'Product not found in this company' }, { status: 404 })
      }

      const duplicate = await prisma.salesItemMaster.findFirst({
        where: {
          companyId,
          productId: nextProductId,
          id: { not: id }
        }
      })
      if (duplicate) {
        return NextResponse.json({ error: 'Sales item already exists for this product' }, { status: 400 })
      }
    }

    const updated = await prisma.salesItemMaster.update({
      where: { id },
      data: {
        productId: parsed.data.productId ?? existing.productId,
        salesItemName: parsed.data.salesItemName !== undefined ? parsed.data.salesItemName.trim() : existing.salesItemName,
        hsnCode: parsed.data.hsnCode !== undefined ? parsed.data.hsnCode : existing.hsnCode,
        gstRate: parsed.data.gstRate !== undefined
          ? (parsed.data.gstRate === null ? null : parseFloat(String(parsed.data.gstRate)))
          : existing.gstRate,
        sellingPrice: parsed.data.sellingPrice !== undefined
          ? (parsed.data.sellingPrice === null ? null : parseFloat(String(parsed.data.sellingPrice)))
          : existing.sellingPrice,
        description: parsed.data.description !== undefined ? parsed.data.description : existing.description,
        isActive: parsed.data.isActive ?? existing.isActive
      },
      include: {
        product: {
          include: { unit: true }
        }
      }
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error updating sales item master:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const companyId = searchParams.get('companyId')

    if (!id || !companyId) {
      return NextResponse.json({ error: 'Sales Item Master ID and Company ID are required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const existing = await prisma.salesItemMaster.findFirst({
      where: { id, companyId }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Sales Item Master not found' }, { status: 404 })
    }

    await prisma.salesItemMaster.delete({
      where: { id }
    })

    return NextResponse.json({ success: true, message: 'Sales Item Master deleted successfully' })
  } catch (error) {
    console.error('Error deleting sales item master:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
