import { NextRequest, NextResponse } from 'next/server'
import { ensureCompanyAccess } from '@/lib/api-security'
import { normalizeNonNegative } from '@/lib/billing-calculations'
import { getPartyCreditSnapshot } from '@/lib/party-credit'

export async function GET(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams
    const companyId = searchParams.get('companyId')?.trim() || ''
    const partyId = searchParams.get('partyId')?.trim() || ''
    const pendingSaleAmount = normalizeNonNegative(searchParams.get('pendingSaleAmount'))
    const excludeBillId = searchParams.get('excludeBillId')?.trim() || null
    const referenceDateRaw = searchParams.get('referenceDate')?.trim() || ''

    if (!companyId || !partyId) {
      return NextResponse.json({ error: 'Company ID and party ID are required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const referenceDate = referenceDateRaw ? new Date(referenceDateRaw) : new Date()
    const snapshot = await getPartyCreditSnapshot({
      companyId,
      partyId,
      pendingSaleAmount,
      excludeBillId,
      referenceDate: Number.isFinite(referenceDate.getTime()) ? referenceDate : new Date(),
    })

    if (!snapshot) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    return NextResponse.json(snapshot)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
