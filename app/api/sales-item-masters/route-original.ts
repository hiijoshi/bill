import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const salesItemMasters = await prisma.salesItemMaster.findMany({
      where: { companyId },
      include: {
        product: {
          include: {
            unit: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(salesItemMasters)
  } catch (error) {
    console.error('Error fetching sales item masters:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { companyId, productId, salesItemName, hsnCode, gstRate, sellingPrice, description, isActive } = body

    if (!companyId || !productId || !salesItemName) {
      return NextResponse.json({ error: 'Company ID, Product ID, and Sales Item Name are required' }, { status: 400 })
    }

    // Check if sales item master already exists for this product
    const existingSalesItemMaster = await prisma.salesItemMaster.findFirst({
      where: {
        companyId,
        productId,
      },
    })

    if (existingSalesItemMaster) {
      return NextResponse.json({ error: 'Sales item master already exists for this product' }, { status: 400 })
    }

    const salesItemMaster = await prisma.salesItemMaster.create({
      data: {
        companyId,
        productId,
        salesItemName: salesItemName.trim(),
        hsnCode: hsnCode || null,
        gstRate: gstRate ? parseFloat(gstRate) : null,
        sellingPrice: sellingPrice ? parseFloat(sellingPrice) : null,
        description: description || null,
        isActive: isActive !== false,
      },
      include: {
        product: {
          include: {
            unit: true
          }
        }
      }
    })

    return NextResponse.json(salesItemMaster)
  } catch (error) {
    console.error('Error creating sales item master:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { productId, salesItemName, hsnCode, gstRate, sellingPrice, description, isActive } = body

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const companyId = searchParams.get('companyId')

    if (!id || !companyId) {
      return NextResponse.json({ error: 'Sales Item Master ID and Company ID are required' }, { status: 400 })
    }

    // Check if sales item master exists and belongs to the company
    const existingSalesItemMaster = await prisma.salesItemMaster.findFirst({
      where: {
        id,
        companyId,
      },
    })

    if (!existingSalesItemMaster) {
      return NextResponse.json({ error: 'Sales Item Master not found' }, { status: 404 })
    }

    // Check if product conflicts with another sales item master
    if (productId && productId !== existingSalesItemMaster.productId) {
      const productConflict = await prisma.salesItemMaster.findFirst({
        where: {
          companyId,
          productId,
          id: { not: id },
        },
      })

      if (productConflict) {
        return NextResponse.json({ error: 'Sales item master already exists for this product' }, { status: 400 })
      }
    }

    const salesItemMaster = await prisma.salesItemMaster.update({
      where: { id },
      data: {
        productId: productId !== undefined ? productId : existingSalesItemMaster.productId,
        salesItemName: salesItemName !== undefined ? salesItemName.trim() : existingSalesItemMaster.salesItemName,
        hsnCode: hsnCode !== undefined ? hsnCode : existingSalesItemMaster.hsnCode,
        gstRate: gstRate !== undefined ? (gstRate ? parseFloat(gstRate) : null) : existingSalesItemMaster.gstRate,
        sellingPrice: sellingPrice !== undefined ? (sellingPrice ? parseFloat(sellingPrice) : null) : existingSalesItemMaster.sellingPrice,
        description: description !== undefined ? description : existingSalesItemMaster.description,
        isActive: isActive !== undefined ? isActive : existingSalesItemMaster.isActive,
      },
      include: {
        product: {
          include: {
            unit: true
          }
        }
      }
    })

    return NextResponse.json(salesItemMaster)
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

    // Check if sales item master exists and belongs to the company
    const existingSalesItemMaster = await prisma.salesItemMaster.findFirst({
      where: {
        id,
        companyId,
      },
    })

    if (!existingSalesItemMaster) {
      return NextResponse.json({ error: 'Sales Item Master not found' }, { status: 404 })
    }

    await prisma.salesItemMaster.delete({
      where: { id },
    })

    return NextResponse.json({ success: true, message: 'Sales Item Master deleted successfully' })
  } catch (error) {
    console.error('Error deleting sales item master:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
