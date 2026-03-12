import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PaymentModeRecord, withMasterStore } from '@/lib/master-data-store'
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
  name: z.string().trim().min(1).optional(),
  code: z.string().trim().min(1).optional(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  seed: z.boolean().optional()
}).strict()

const putSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

const DUMMY_PAYMENT_MODES: Array<Omit<PaymentModeRecord, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>> = [
  { name: 'Cash', code: 'CASH', description: 'Cash payment', isActive: true },
  { name: 'UPI', code: 'UPI', description: 'UPI transfer', isActive: true },
  { name: 'Bank Transfer', code: 'NEFT', description: 'Bank transfer mode', isActive: true },
  { name: 'Cheque', code: 'CHEQUE', description: 'Cheque payment', isActive: true }
]

export async function GET(request: NextRequest) {
  try {
    const companyId = normalizeCompanyId(new URL(request.url).searchParams.get('companyId'))
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const rows = await withMasterStore((store) =>
      store.paymentModes
        .filter((row) => row.companyId === companyId)
        .sort((a, b) => a.name.localeCompare(b.name))
    )
    return NextResponse.json(rows)
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
        const rows = DUMMY_PAYMENT_MODES.map((item) => ({
          ...item,
          id: randomUUID(),
          companyId,
          createdAt: now,
          updatedAt: now
        }))
        store.paymentModes.push(...rows)
        return rows.length
      })
      return NextResponse.json({ success: true, message: `${count} dummy payment modes added successfully`, count })
    }

    const name = clean(parsed.data.name)
    const code = clean(parsed.data.code)?.toUpperCase() || null
    if (!name || !code) {
      return NextResponse.json({ error: 'Payment mode name and code are required' }, { status: 400 })
    }

    const created = await withMasterStore((store) => {
      const exists = store.paymentModes.find((row) => row.companyId === companyId && row.code === code)
      if (exists) return null
      const now = new Date().toISOString()
      const row: PaymentModeRecord = {
        id: randomUUID(),
        companyId,
        name,
        code,
        description: clean(parsed.data.description),
        isActive: parsed.data.isActive !== false,
        createdAt: now,
        updatedAt: now
      }
      store.paymentModes.push(row)
      return row
    })
    if (!created) {
      return NextResponse.json({ error: 'Payment mode code already exists' }, { status: 400 })
    }

    return NextResponse.json({ success: true, message: 'Payment mode data stored successfully', paymentMode: created })
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
      return NextResponse.json({ error: 'Payment mode ID and Company ID required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const code = parsed.data.code.toUpperCase()

    const updated = await withMasterStore((store) => {
      const idx = store.paymentModes.findIndex((row) => row.id === id && row.companyId === companyId)
      if (idx === -1) return null
      const duplicate = store.paymentModes.find(
        (row) => row.companyId === companyId && row.code === code && row.id !== id
      )
      if (duplicate) return undefined
      store.paymentModes[idx] = {
        ...store.paymentModes[idx],
        name: parsed.data.name,
        code,
        description: clean(parsed.data.description),
        isActive: parsed.data.isActive !== false,
        updatedAt: new Date().toISOString()
      }
      return store.paymentModes[idx]
    })

    if (updated === undefined) {
      return NextResponse.json({ error: 'Payment mode code already exists' }, { status: 400 })
    }
    if (!updated) {
      return NextResponse.json({ error: 'Payment mode not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Payment mode updated successfully', paymentMode: updated })
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
        const before = store.paymentModes.length
        store.paymentModes = store.paymentModes.filter((row) => row.companyId !== companyId)
        return before - store.paymentModes.length
      })
      return NextResponse.json({ success: true, message: `${count} payment modes deleted successfully`, count })
    }

    if (!id) {
      return NextResponse.json({ error: 'Payment mode ID required' }, { status: 400 })
    }

    const deleted = await withMasterStore((store) => {
      const idx = store.paymentModes.findIndex((row) => row.id === id && row.companyId === companyId)
      if (idx === -1) return false
      store.paymentModes.splice(idx, 1)
      return true
    })

    if (!deleted) {
      return NextResponse.json({ error: 'Payment mode not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Payment mode deleted successfully' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
