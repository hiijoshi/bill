import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { filterCompanyIdsByRoutePermission, getScopedCompanyIds, requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'

const idParamsSchema = z.object({ id: z.string().trim().min(1, 'Payment ID is required') })
const statusSchema = z
  .object({
    status: z.enum(['pending', 'paid'])
  })
  .strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = idParamsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid payment ID' }, { status: 400 })
    }

    const parsedBody = statusSchema.safeParse(await request.json().catch(() => null))
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsedBody.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const payment = await prisma.payment.findFirst({
      where: {
        id: parsedParams.data.id,
        deletedAt: null
      }
    })

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    const scopedCompanyIds = await getScopedCompanyIds(authResult.auth, payment.companyId)
    const permissionScopedIds = await filterCompanyIdsByRoutePermission(
      authResult.auth,
      scopedCompanyIds,
      request.nextUrl.pathname,
      request.method
    )
    if (!permissionScopedIds.includes(payment.companyId)) {
      return NextResponse.json({ error: 'Payment access denied' }, { status: 403 })
    }

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: parsedBody.data.status
      }
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: 'STATUS_CHANGE',
      resourceType: 'PAYMENT',
      resourceId: updated.id,
      scope: {
        traderId: authResult.auth.traderId,
        companyId: updated.companyId
      },
      before: payment,
      after: updated,
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json({ success: true, payment: updated })
  } catch {
    return NextResponse.json({ error: 'Failed to update payment status' }, { status: 500 })
  }
}
