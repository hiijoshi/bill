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
  code: z.string().trim().min(1).optional(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

const putSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  description: z.string().optional().nullable(),
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
        .from('PaymentMode')
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

    const rows = await prisma.paymentMode.findMany({
      where: { companyId },
      orderBy: { name: 'asc' }
    })

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

    const supabaseContext = await getSupabaseClaimsFromRequest(request)
    if (supabaseContext && hasSupabaseAppContext(supabaseContext.claims)) {
      const name = clean(parsed.data.name)
      const code = clean(parsed.data.code)?.toUpperCase() || null
      if (!name || !code) {
        return NextResponse.json({ error: 'Payment mode name and code are required' }, { status: 400 })
      }

      const { data, error } = await supabaseContext.supabase
        .from('PaymentMode')
        .insert({
          companyId,
          name,
          code,
          description: clean(parsed.data.description),
          isActive: parsed.data.isActive !== false
        })
        .select('*')
        .single()

      if (error) {
        return supabaseContext.applyCookies(supabaseErrorResponse(error))
      }

      return supabaseContext.applyCookies(
        NextResponse.json({ success: true, message: 'Payment mode data stored successfully', paymentMode: data })
      )
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const name = clean(parsed.data.name)
    const code = clean(parsed.data.code)?.toUpperCase() || null
    if (!name || !code) {
      return NextResponse.json({ error: 'Payment mode name and code are required' }, { status: 400 })
    }

    const duplicate = await prisma.paymentMode.findFirst({
      where: {
        companyId,
        code
      }
    })

    if (duplicate) {
      return NextResponse.json({ error: 'Payment mode code already exists' }, { status: 400 })
    }

    const created = await prisma.paymentMode.create({
      data: {
        companyId,
        name,
        code,
        description: clean(parsed.data.description),
        isActive: parsed.data.isActive !== false
      }
    })

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

    const supabaseContext = await getSupabaseClaimsFromRequest(request)
    if (supabaseContext && hasSupabaseAppContext(supabaseContext.claims)) {
      const code = parsed.data.code.toUpperCase()
      const { data, error } = await supabaseContext.supabase
        .from('PaymentMode')
        .update({
          name: parsed.data.name,
          code,
          description: clean(parsed.data.description),
          isActive: parsed.data.isActive !== false
        })
        .eq('id', id)
        .eq('companyId', companyId)
        .select('*')
        .single()

      if (error) {
        return supabaseContext.applyCookies(supabaseErrorResponse(error))
      }

      return supabaseContext.applyCookies(
        NextResponse.json({ success: true, message: 'Payment mode updated successfully', paymentMode: data })
      )
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const existing = await prisma.paymentMode.findFirst({
      where: { id, companyId }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Payment mode not found' }, { status: 404 })
    }

    const code = parsed.data.code.toUpperCase()
    const duplicate = await prisma.paymentMode.findFirst({
      where: {
        companyId,
        code,
        id: { not: id }
      }
    })

    if (duplicate) {
      return NextResponse.json({ error: 'Payment mode code already exists' }, { status: 400 })
    }

    const updated = await prisma.paymentMode.update({
      where: { id },
      data: {
        name: parsed.data.name,
        code,
        description: clean(parsed.data.description),
        isActive: parsed.data.isActive !== false
      }
    })

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

    const supabaseContext = await getSupabaseClaimsFromRequest(request)
    if (supabaseContext && hasSupabaseAppContext(supabaseContext.claims)) {
      if (all) {
        const { error, count } = await supabaseContext.supabase
          .from('PaymentMode')
          .delete({ count: 'exact' })
          .eq('companyId', companyId)

        if (error) {
          return supabaseContext.applyCookies(supabaseErrorResponse(error))
        }

        return supabaseContext.applyCookies(
          NextResponse.json({ success: true, message: `${count || 0} payment modes deleted successfully`, count: count || 0 })
        )
      }

      if (!id) {
        return NextResponse.json({ error: 'Payment mode ID required' }, { status: 400 })
      }

      const { error, count } = await supabaseContext.supabase
        .from('PaymentMode')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('companyId', companyId)

      if (error) {
        return supabaseContext.applyCookies(supabaseErrorResponse(error))
      }

      if (!count) {
        return supabaseContext.applyCookies(NextResponse.json({ error: 'Payment mode not found' }, { status: 404 }))
      }

      return supabaseContext.applyCookies(NextResponse.json({ success: true, message: 'Payment mode deleted successfully' }))
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (all) {
      const deleted = await prisma.paymentMode.deleteMany({
        where: { companyId }
      })
      return NextResponse.json({ success: true, message: `${deleted.count} payment modes deleted successfully`, count: deleted.count })
    }

    if (!id) {
      return NextResponse.json({ error: 'Payment mode ID required' }, { status: 400 })
    }

    const deleted = await prisma.paymentMode.deleteMany({
      where: { id, companyId }
    })

    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Payment mode not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Payment mode deleted successfully' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
