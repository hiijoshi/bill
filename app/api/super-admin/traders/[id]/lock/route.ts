import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { normalizePrismaApiError } from '@/lib/prisma-errors'

const idParamsSchema = z.object({ id: z.string().trim().min(1, 'Trader ID is required') })
const lockSchema = z.object({ locked: z.boolean() }).strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = idParamsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid trader ID' }, { status: 400 })
    }

    const parsedBody = lockSchema.safeParse(await request.json().catch(() => null))
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
    }

    const traderId = parsedParams.data.id
    const existing = await prisma.trader.findFirst({
      where: {
        id: traderId,
        deletedAt: null
      }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
    }

    if (parsedBody.data.locked && authResult.auth.traderId === traderId) {
      return NextResponse.json({ error: 'Cannot lock current session trader' }, { status: 403 })
    }

    const updated = await prisma.$transaction(async (tx) => {
      const trader = await tx.trader.update({
        where: { id: traderId },
        data: { locked: parsedBody.data.locked }
      })

      await tx.company.updateMany({
        where: {
          traderId,
          deletedAt: null
        },
        data: {
          locked: parsedBody.data.locked
        }
      })

      await tx.user.updateMany({
        where: {
          traderId,
          deletedAt: null
        },
        data: {
          locked: parsedBody.data.locked
        }
      })

      return trader
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: parsedBody.data.locked ? 'LOCK' : 'UNLOCK',
      resourceType: 'TRADER',
      resourceId: traderId,
      scope: { traderId },
      before: existing,
      after: updated,
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json({ success: true, trader: updated })
  } catch (error) {
    const apiError = normalizePrismaApiError(error, 'Failed to update lock state')
    return NextResponse.json({ error: apiError.message }, { status: apiError.status })
  }
}
