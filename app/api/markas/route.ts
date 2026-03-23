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
  markaNumber: z.string().trim().min(1).optional(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

const putSchema = z.object({
  markaNumber: z.string().trim().min(1),
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
        .from('Marka')
        .select('*')
        .eq('companyId', companyId)
        .order('markaNumber', { ascending: true })

      if (error) {
        return supabaseContext.applyCookies(supabaseErrorResponse(error))
      }

      return supabaseContext.applyCookies(NextResponse.json(data ?? []))
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const markas = await prisma.marka.findMany({
      where: { companyId },
      orderBy: { markaNumber: 'asc' }
    })

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

    const supabaseContext = await getSupabaseClaimsFromRequest(request)
    if (supabaseContext && hasSupabaseAppContext(supabaseContext.claims)) {
      const markaNumber = clean(parsed.data.markaNumber)?.toUpperCase() || null
      if (!markaNumber) {
        return NextResponse.json({ error: 'Marka number is required' }, { status: 400 })
      }

      const { data, error } = await supabaseContext.supabase
        .from('Marka')
        .insert({
          companyId,
          markaNumber,
          description: clean(parsed.data.description),
          isActive: parsed.data.isActive !== false
        })
        .select('*')
        .single()

      if (error) {
        return supabaseContext.applyCookies(supabaseErrorResponse(error))
      }

      return supabaseContext.applyCookies(NextResponse.json({ success: true, message: 'Marka data stored successfully', marka: data }))
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const markaNumber = clean(parsed.data.markaNumber)?.toUpperCase() || null
    if (!markaNumber) {
      return NextResponse.json({ error: 'Marka number is required' }, { status: 400 })
    }

    const duplicate = await prisma.marka.findFirst({
      where: {
        companyId,
        markaNumber
      }
    })

    if (duplicate) {
      return NextResponse.json({ error: 'Marka number already exists' }, { status: 400 })
    }

    const created = await prisma.marka.create({
      data: {
        companyId,
        markaNumber,
        description: clean(parsed.data.description),
        isActive: parsed.data.isActive !== false
      }
    })

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

    const supabaseContext = await getSupabaseClaimsFromRequest(request)
    if (supabaseContext && hasSupabaseAppContext(supabaseContext.claims)) {
      const markaNumber = parsed.data.markaNumber.toUpperCase()
      const { data, error } = await supabaseContext.supabase
        .from('Marka')
        .update({
          markaNumber,
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

      return supabaseContext.applyCookies(NextResponse.json({ success: true, message: 'Marka updated successfully', marka: data }))
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const existing = await prisma.marka.findFirst({
      where: { id, companyId }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Marka not found' }, { status: 404 })
    }

    const markaNumber = parsed.data.markaNumber.toUpperCase()
    const duplicate = await prisma.marka.findFirst({
      where: {
        companyId,
        markaNumber,
        id: { not: id }
      }
    })

    if (duplicate) {
      return NextResponse.json({ error: 'Marka number already exists' }, { status: 400 })
    }

    const updated = await prisma.marka.update({
      where: { id },
      data: {
        markaNumber,
        description: clean(parsed.data.description),
        isActive: parsed.data.isActive !== false
      }
    })

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

    const supabaseContext = await getSupabaseClaimsFromRequest(request)
    if (supabaseContext && hasSupabaseAppContext(supabaseContext.claims)) {
      if (all) {
        const { error, count } = await supabaseContext.supabase
          .from('Marka')
          .delete({ count: 'exact' })
          .eq('companyId', companyId)

        if (error) {
          return supabaseContext.applyCookies(supabaseErrorResponse(error))
        }

        return supabaseContext.applyCookies(
          NextResponse.json({ success: true, message: `${count || 0} markas deleted successfully`, count: count || 0 })
        )
      }

      if (!id) {
        return NextResponse.json({ error: 'Marka ID required' }, { status: 400 })
      }

      const { error, count } = await supabaseContext.supabase
        .from('Marka')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('companyId', companyId)

      if (error) {
        return supabaseContext.applyCookies(supabaseErrorResponse(error))
      }

      if (!count) {
        return supabaseContext.applyCookies(NextResponse.json({ error: 'Marka not found' }, { status: 404 }))
      }

      return supabaseContext.applyCookies(NextResponse.json({ success: true, message: 'Marka deleted successfully' }))
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (all) {
      const deleted = await prisma.marka.deleteMany({
        where: { companyId }
      })
      return NextResponse.json({ success: true, message: `${deleted.count} markas deleted successfully`, count: deleted.count })
    }

    if (!id) {
      return NextResponse.json({ error: 'Marka ID required' }, { status: 400 })
    }

    const deleted = await prisma.marka.deleteMany({
      where: { id, companyId }
    })

    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Marka not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Marka deleted successfully' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
