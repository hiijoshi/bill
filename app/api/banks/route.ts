import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { BankRecord, withMasterStore } from '@/lib/master-data-store'
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
  branch: z.string().optional().nullable(),
  ifscCode: z.string().trim().min(1).optional(),
  accountNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  seed: z.boolean().optional()
}).strict()

const putSchema = z.object({
  name: z.string().trim().min(1),
  branch: z.string().optional().nullable(),
  ifscCode: z.string().trim().min(1),
  accountNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

const DUMMY_BANKS: Array<Omit<BankRecord, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>> = [
  {
    name: 'State Bank of India',
    branch: 'Neemuch Main',
    ifscCode: 'SBIN0001234',
    accountNumber: '123456789012',
    address: 'Main Road, Neemuch',
    phone: '07423223344',
    isActive: true
  },
  {
    name: 'HDFC Bank',
    branch: 'Ujjain Branch',
    ifscCode: 'HDFC0000123',
    accountNumber: '001122334455',
    address: 'Dewas Gate, Ujjain',
    phone: '07342555111',
    isActive: true
  }
]

export async function GET(request: NextRequest) {
  try {
    const companyId = normalizeCompanyId(new URL(request.url).searchParams.get('companyId'))
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const banks = await withMasterStore((store) =>
      store.banks
        .filter((row) => row.companyId === companyId)
        .sort((a, b) => a.name.localeCompare(b.name))
    )

    return NextResponse.json(banks)
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
        const records = DUMMY_BANKS.map((item) => ({
          ...item,
          id: randomUUID(),
          companyId,
          createdAt: now,
          updatedAt: now
        }))
        store.banks.push(...records)
        return records.length
      })
      return NextResponse.json({ success: true, message: `${count} dummy banks added successfully`, count })
    }

    const name = clean(parsed.data.name)
    const ifscCode = clean(parsed.data.ifscCode)?.toUpperCase() || null
    if (!name || !ifscCode) {
      return NextResponse.json({ error: 'Bank name and IFSC code are required' }, { status: 400 })
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
      return NextResponse.json({ error: 'Invalid IFSC code format' }, { status: 400 })
    }

    const created = await withMasterStore((store) => {
      const duplicate = store.banks.find(
        (row) => row.companyId === companyId && row.name.toLowerCase() === name.toLowerCase() && row.ifscCode === ifscCode
      )
      if (duplicate) return null
      const now = new Date().toISOString()
      const record: BankRecord = {
        id: randomUUID(),
        companyId,
        name,
        branch: clean(parsed.data.branch),
        ifscCode,
        accountNumber: clean(parsed.data.accountNumber),
        address: clean(parsed.data.address),
        phone: clean(parsed.data.phone),
        isActive: parsed.data.isActive !== false,
        createdAt: now,
        updatedAt: now
      }
      store.banks.push(record)
      return record
    })

    if (!created) {
      return NextResponse.json({ error: 'Bank with this name/IFSC already exists' }, { status: 400 })
    }

    return NextResponse.json({ success: true, message: 'Bank data stored successfully', bank: created })
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
      return NextResponse.json({ error: 'Bank ID and Company ID required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const updated = await withMasterStore((store) => {
      const index = store.banks.findIndex((row) => row.id === id && row.companyId === companyId)
      if (index === -1) return null
      store.banks[index] = {
        ...store.banks[index],
        name: parsed.data.name,
        branch: clean(parsed.data.branch),
        ifscCode: parsed.data.ifscCode.toUpperCase(),
        accountNumber: clean(parsed.data.accountNumber),
        address: clean(parsed.data.address),
        phone: clean(parsed.data.phone),
        isActive: parsed.data.isActive !== false,
        updatedAt: new Date().toISOString()
      }
      return store.banks[index]
    })

    if (!updated) {
      return NextResponse.json({ error: 'Bank not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Bank updated successfully', bank: updated })
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
        const before = store.banks.length
        store.banks = store.banks.filter((row) => row.companyId !== companyId)
        return before - store.banks.length
      })
      return NextResponse.json({ success: true, message: `${count} banks deleted successfully`, count })
    }

    if (!id) {
      return NextResponse.json({ error: 'Bank ID required' }, { status: 400 })
    }

    const deleted = await withMasterStore((store) => {
      const index = store.banks.findIndex((row) => row.id === id && row.companyId === companyId)
      if (index === -1) return false
      store.banks.splice(index, 1)
      return true
    })

    if (!deleted) {
      return NextResponse.json({ error: 'Bank not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Bank deleted successfully' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
