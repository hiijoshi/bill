import { NextRequest, NextResponse } from 'next/server'
import { parseBooleanParam, requireRoles } from '@/lib/api-security'
import { loadSuperAdminOverviewData, type SuperAdminOverviewSection } from '@/lib/server-super-admin-overview'

const SUPER_ADMIN_OVERVIEW_SECTIONS = new Set<SuperAdminOverviewSection>([
  'stats',
  'traders',
  'companies',
  'users',
  'permissionPreview'
])

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const sections = String(searchParams.get('sections') || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is SuperAdminOverviewSection => SUPER_ADMIN_OVERVIEW_SECTIONS.has(value as SuperAdminOverviewSection))

    const payload = await loadSuperAdminOverviewData({
      traderId: searchParams.get('traderId'),
      companyId: searchParams.get('companyId'),
      userId: searchParams.get('userId'),
      includeDeleted: parseBooleanParam(searchParams.get('includeDeleted')),
      sections
    })

    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load super admin overview'
      },
      { status: 500 }
    )
  }
}
