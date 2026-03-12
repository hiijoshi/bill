import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'

const writeSchema = z.object({
  name: z.string().trim().min(1),
  hsnCode: z.string().optional().nullable(),
  gstRate: z.union([z.number(), z.string()]).optional().nullable(),
  unit: z.string().trim().min(1),
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

    return NextResponse.json([])
  } catch (error) {
    console.error('Error fetching sales items:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, writeSchema)
    if (!parsed.ok) return parsed.response

    const companyId = new URL(request.url).searchParams.get('companyId')
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    return NextResponse.json({
      id: Date.now().toString(),
      name: parsed.data.name,
      hsnCode: parsed.data.hsnCode,
      gstRate: parsed.data.gstRate,
      unit: parsed.data.unit,
      sellingPrice: parsed.data.sellingPrice,
      description: parsed.data.description,
      isActive: parsed.data.isActive !== false,
      createdAt: new Date(),
      updatedAt: new Date()
    })
  } catch (error) {
    console.error('Error creating sales item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, writeSchema)
    if (!parsed.ok) return parsed.response

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const companyId = searchParams.get('companyId')

    if (!id) {
      return NextResponse.json({ error: 'Sales item ID required' }, { status: 400 })
    }
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    return NextResponse.json({
      id,
      name: parsed.data.name,
      hsnCode: parsed.data.hsnCode,
      gstRate: parsed.data.gstRate,
      unit: parsed.data.unit,
      sellingPrice: parsed.data.sellingPrice,
      description: parsed.data.description,
      isActive: parsed.data.isActive !== false,
      updatedAt: new Date()
    })
  } catch (error) {
    console.error('Error updating sales item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const companyId = searchParams.get('companyId')

    if (!id) {
      return NextResponse.json({ error: 'Sales item ID required' }, { status: 400 })
    }
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    return NextResponse.json({ success: true, message: 'Sales item deleted successfully' })
  } catch (error) {
    console.error('Error deleting sales item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
