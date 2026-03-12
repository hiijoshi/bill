import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { MarkaRecord, withMasterStore } from '@/lib/master-data-store'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'

function normalizeCompanyId(raw: string | null): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value || value === 'null' || value === 'undefined') return null
  return value
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v.length > 0 ? v : null
}

const postSchema = z.object({
  markaNumber: z.string().trim().min(1).optional(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  seed: z.boolean().optional()
}).strict()

const putSchema = z.object({
  markaNumber: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

const DUMMY_MARKAS: Array<Omit<MarkaRecord, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>> = [
  { markaNumber: 'MK-101', description: 'Soyabean first quality', isActive: true },
  { markaNumber: 'MK-102', description: 'Wheat standard quality', isActive: true },
  { markaNumber: 'MK-103', description: 'Chana premium', isActive: true }
]

export async function GET(request: NextRequest) {
  try {
    const companyId = normalizeCompanyId(new URL(request.url).searchParams.get('companyId'))
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const markas = await withMasterStore((store) =>
      store.markas
        .filter((row) => row.companyId === companyId)
        .sort((a, b) => a.markaNumber.localeCompare(b.markaNumber))
    )

    return NextResponse.json(markas)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, postSchema)
    if (!parsed.ok) return parsed.response

    const companyId = normalizeCompanyId(new URL(request.url).searchParams.get('companyId'))
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (parsed.data.seed === true) {
      const count = await withMasterStore((store) => {
        const now = new Date().toISOString()
        const rows = DUMMY_MARKAS.map((m) => ({
          ...m,
          id: randomUUID(),
          companyId,
          markaNumber: m.markaNumber.toUpperCase(),
          createdAt: now,
          updatedAt: now
        }))
        store.markas.push(...rows)
        return rows.length
      })
      return NextResponse.json({ success: true, message: `${count} dummy markas added successfully`, count })
    }

    const markaNumber = clean(parsed.data.markaNumber)?.toUpperCase() || null
    if (!markaNumber) {
      return NextResponse.json({ error: 'Marka number is required' }, { status: 400 })
    }

    const created = await withMasterStore((store) => {
      const exists = store.markas.find((row) => row.companyId === companyId && row.markaNumber === markaNumber)
      if (exists) return null
      const now = new Date().toISOString()
      const row: MarkaRecord = {
        id: randomUUID(),
        companyId,
        markaNumber,
        description: clean(parsed.data.description),
        isActive: parsed.data.isActive !== false,
        createdAt: now,
        updatedAt: now
      }
      store.markas.push(row)
      return row
    })

    if (!created) {
      return NextResponse.json({ error: 'Marka number already exists' }, { status: 400 })
    }

    return NextResponse.json({ success: true, message: 'Marka data stored successfully', marka: created })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, putSchema)
    if (!parsed.ok) return parsed.response

    const { searchParams } = new URL(request.url)
    const companyId = normalizeCompanyId(searchParams.get('companyId'))
    const id = clean(searchParams.get('id'))
    if (!companyId || !id) {
      return NextResponse.json({ error: 'Marka ID and Company ID required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const markaNumber = parsed.data.markaNumber.toUpperCase()

    const updated = await withMasterStore((store) => {
      const index = store.markas.findIndex((row) => row.id === id && row.companyId === companyId)
      if (index === -1) return null
      const duplicate = store.markas.find(
        (row) => row.companyId === companyId && row.markaNumber === markaNumber && row.id !== id
      )
      if (duplicate) return undefined
      store.markas[index] = {
        ...store.markas[index],
        markaNumber,
        description: clean(parsed.data.description),
        isActive: parsed.data.isActive !== false,
        updatedAt: new Date().toISOString()
      }
      return store.markas[index]
    })

    if (updated === undefined) {
      return NextResponse.json({ error: 'Marka number already exists' }, { status: 400 })
    }
    if (!updated) {
      return NextResponse.json({ error: 'Marka not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Marka updated successfully', marka: updated })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = normalizeCompanyId(searchParams.get('companyId'))
    const id = clean(searchParams.get('id'))
    const all = searchParams.get('all') === 'true'
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (all) {
      const count = await withMasterStore((store) => {
        const before = store.markas.length
        store.markas = store.markas.filter((row) => row.companyId !== companyId)
        return before - store.markas.length
      })
      return NextResponse.json({ success: true, message: `${count} markas deleted successfully`, count })
    }

    if (!id) {
      return NextResponse.json({ error: 'Marka ID required' }, { status: 400 })
    }

    const deleted = await withMasterStore((store) => {
      const index = store.markas.findIndex((row) => row.id === id && row.companyId === companyId)
      if (index === -1) return false
      store.markas.splice(index, 1)
      return true
    })

    if (!deleted) {
      return NextResponse.json({ error: 'Marka not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Marka deleted successfully' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
