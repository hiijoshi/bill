import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'
import { getSupabaseClaimsFromRequest, hasSupabaseAppContext } from '@/lib/supabase/auth-bridge'

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
  isActive: z.boolean().optional()
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

function supabaseErrorResponse(error: { message: string; code?: string | null }) {
  const status = error.code === 'PGRST116' ? 404 : 403
  return NextResponse.json({ error: error.message || 'Forbidden' }, { status })
}

export async function GET(request: NextRequest) {
  try {
    const companyId = normalizeCompanyId(new URL(request.url).searchParams.get('companyId'))
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const supabaseContext = await getSupabaseClaimsFromRequest(request)
    if (supabaseContext && hasSupabaseAppContext(supabaseContext.claims)) {
      const { data, error } = await supabaseContext.supabase
        .from('Bank')
        .select('*')
        .eq('companyId', companyId)
        .order('name', { ascending: true })

      if (error) {
        return supabaseContext.applyCookies(supabaseErrorResponse(error))
      }

      return supabaseContext.applyCookies(NextResponse.json(data ?? []))
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const banks = await prisma.bank.findMany({
      where: { companyId },
      orderBy: { name: 'asc' }
    })

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

    const supabaseContext = await getSupabaseClaimsFromRequest(request)
    if (supabaseContext && hasSupabaseAppContext(supabaseContext.claims)) {
      const name = clean(parsed.data.name)
      const ifscCode = clean(parsed.data.ifscCode)?.toUpperCase() || null
      if (!name || !ifscCode) {
        return NextResponse.json({ error: 'Bank name and IFSC code are required' }, { status: 400 })
      }

      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
        return NextResponse.json({ error: 'Invalid IFSC code format' }, { status: 400 })
      }

      const { data, error } = await supabaseContext.supabase
        .from('Bank')
        .insert({
          companyId,
          name,
          branch: clean(parsed.data.branch),
          ifscCode,
          accountNumber: clean(parsed.data.accountNumber),
          address: clean(parsed.data.address),
          phone: clean(parsed.data.phone),
          isActive: parsed.data.isActive !== false
        })
        .select('*')
        .single()

      if (error) {
        return supabaseContext.applyCookies(supabaseErrorResponse(error))
      }

      return supabaseContext.applyCookies(NextResponse.json({ success: true, message: 'Bank data stored successfully', bank: data }))
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const name = clean(parsed.data.name)
    const ifscCode = clean(parsed.data.ifscCode)?.toUpperCase() || null
    if (!name || !ifscCode) {
      return NextResponse.json({ error: 'Bank name and IFSC code are required' }, { status: 400 })
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
      return NextResponse.json({ error: 'Invalid IFSC code format' }, { status: 400 })
    }

    const duplicate = await prisma.bank.findFirst({
      where: {
        companyId,
        ifscCode
      }
    })

    if (duplicate && duplicate.name.toLowerCase() === name.toLowerCase()) {
      return NextResponse.json({ error: 'Bank with this name/IFSC already exists' }, { status: 400 })
    }

    const created = await prisma.bank.create({
      data: {
        companyId,
        name,
        branch: clean(parsed.data.branch),
        ifscCode,
        accountNumber: clean(parsed.data.accountNumber),
        address: clean(parsed.data.address),
        phone: clean(parsed.data.phone),
        isActive: parsed.data.isActive !== false
      }
    })

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

    const supabaseContext = await getSupabaseClaimsFromRequest(request)
    if (supabaseContext && hasSupabaseAppContext(supabaseContext.claims)) {
      const name = parsed.data.name.trim()
      const ifscCode = parsed.data.ifscCode.trim().toUpperCase()
      const { data, error } = await supabaseContext.supabase
        .from('Bank')
        .update({
          name,
          branch: clean(parsed.data.branch),
          ifscCode,
          accountNumber: clean(parsed.data.accountNumber),
          address: clean(parsed.data.address),
          phone: clean(parsed.data.phone),
          isActive: parsed.data.isActive !== false
        })
        .eq('id', id)
        .eq('companyId', companyId)
        .select('*')
        .single()

      if (error) {
        return supabaseContext.applyCookies(supabaseErrorResponse(error))
      }

      return supabaseContext.applyCookies(NextResponse.json({ success: true, message: 'Bank updated successfully', bank: data }))
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const existing = await prisma.bank.findFirst({
      where: { id, companyId }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Bank not found' }, { status: 404 })
    }

    const name = parsed.data.name.trim()
    const ifscCode = parsed.data.ifscCode.trim().toUpperCase()
    const duplicate = await prisma.bank.findFirst({
      where: {
        companyId,
        ifscCode,
        id: { not: id }
      }
    })

    if (duplicate && duplicate.name.toLowerCase() === name.toLowerCase()) {
      return NextResponse.json({ error: 'Bank with this name/IFSC already exists' }, { status: 400 })
    }

    const updated = await prisma.bank.update({
      where: { id },
      data: {
        name,
        branch: clean(parsed.data.branch),
        ifscCode,
        accountNumber: clean(parsed.data.accountNumber),
        address: clean(parsed.data.address),
        phone: clean(parsed.data.phone),
        isActive: parsed.data.isActive !== false
      }
    })

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

    const supabaseContext = await getSupabaseClaimsFromRequest(request)
    if (supabaseContext && hasSupabaseAppContext(supabaseContext.claims)) {
      if (all) {
        const { error, count } = await supabaseContext.supabase
          .from('Bank')
          .delete({ count: 'exact' })
          .eq('companyId', companyId)

        if (error) {
          return supabaseContext.applyCookies(supabaseErrorResponse(error))
        }

        return supabaseContext.applyCookies(
          NextResponse.json({ success: true, message: `${count || 0} banks deleted successfully`, count: count || 0 })
        )
      }

      if (!id) {
        return NextResponse.json({ error: 'Bank ID required' }, { status: 400 })
      }

      const { error, count } = await supabaseContext.supabase
        .from('Bank')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('companyId', companyId)

      if (error) {
        return supabaseContext.applyCookies(supabaseErrorResponse(error))
      }

      if (!count) {
        return supabaseContext.applyCookies(NextResponse.json({ error: 'Bank not found' }, { status: 404 }))
      }

      return supabaseContext.applyCookies(NextResponse.json({ success: true, message: 'Bank deleted successfully' }))
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (all) {
      const deleted = await prisma.bank.deleteMany({
        where: { companyId }
      })
      return NextResponse.json({ success: true, message: `${deleted.count} banks deleted successfully`, count: deleted.count })
    }

    if (!id) {
      return NextResponse.json({ error: 'Bank ID required' }, { status: 400 })
    }

    const deleted = await prisma.bank.deleteMany({
      where: { id, companyId }
    })

    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Bank not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Bank deleted successfully' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
