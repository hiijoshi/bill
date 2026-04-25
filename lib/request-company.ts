import { NextRequest } from 'next/server'
import { sanitizeCompanyId } from '@/lib/company-id'

export function normalizeRequestCompanyId(raw: string | null): string | null {
  const value = sanitizeCompanyId(raw)
  return value || null
}

export function readCompanyIdFromRequest(request: NextRequest): string | null {
  const req = request as NextRequest & {
    user?: {
      companyId?: string | null
      company_id?: string | null
      defaultCompanyId?: string | null
      default_company_id?: string | null
    }
    auth?: {
      companyId?: string | null
      company_id?: string | null
      defaultCompanyId?: string | null
      default_company_id?: string | null
    }
  }

  const candidates = [
    req.user?.companyId,
    req.user?.company_id,
    req.user?.defaultCompanyId,
    req.user?.default_company_id,
    req.auth?.companyId,
    req.auth?.company_id,
    req.auth?.defaultCompanyId,
    req.auth?.default_company_id,
    request.headers.get('x-auth-company-id'),
    request.headers.get('x-company-id')
  ]

  for (const raw of candidates) {
    if (typeof raw !== 'string') continue
    const value = normalizeRequestCompanyId(raw)
    if (value) return value
  }

  return null
}

export function resolveCompanyIdFromRequest(request: NextRequest): string | null {
  return (
    normalizeRequestCompanyId(new URL(request.url).searchParams.get('companyId')) ||
    readCompanyIdFromRequest(request)
  )
}
