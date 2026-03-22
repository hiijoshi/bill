import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { normalizeOptionalString, parseBooleanParam, requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { getTraderCapacitySnapshot } from '@/lib/trader-limits'

const createUserSchema = z
  .object({
    traderId: z.string().trim().min(1, 'Trader ID is required'),
    companyId: z.string().trim().min(1, 'Company ID is required'),
    userId: z.string().trim().min(1, 'User ID is required').max(50),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    name: z.string().trim().max(100).optional().nullable(),
    locked: z.boolean().optional(),
    active: z.boolean().optional()
  })
  .strict()

function normalizeCreatePayload(payload: z.infer<typeof createUserSchema>) {
  const activeLocked = payload.active === undefined ? undefined : !payload.active

  return {
    traderId: payload.traderId.trim(),
    companyId: payload.companyId.trim(),
    userId: payload.userId.trim().toLowerCase(),
    password: payload.password,
    name: normalizeOptionalString(payload.name),
    role: 'company_user' as const,
    locked: activeLocked ?? payload.locked ?? false
  }
}

function omitPassword<T extends { password: string }>(user: T): Omit<T, 'password'> {
  const { password, ...rest } = user
  void password
  return rest
}

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const includeDeleted = parseBooleanParam(searchParams.get('includeDeleted'))
    const traderId = searchParams.get('traderId')?.trim()
    const companyId = searchParams.get('companyId')?.trim()

    const users = await prisma.user.findMany({
      where: {
        ...(includeDeleted ? {} : { deletedAt: null }),
        ...(traderId ? { traderId } : {}),
        ...(companyId ? { companyId } : {}),
        NOT: [{ role: 'SUPER_ADMIN' }, { role: 'super_admin' }]
      },
      include: {
        trader: {
          select: {
            id: true,
            name: true,
            locked: true,
            deletedAt: true
          }
        },
        company: {
          select: {
            id: true,
            name: true,
            locked: true,
            deletedAt: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    const usersWithoutPassword = users.map((user) => {
      const userWithoutPassword = omitPassword(user)
      return {
        ...userWithoutPassword,
        active: !user.locked
      }
    })

    return NextResponse.json(usersWithoutPassword)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const body = await request.json().catch(() => null)
    const parsed = createUserSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const normalized = normalizeCreatePayload(parsed.data)

    const trader = await prisma.trader.findFirst({
      where: {
        id: normalized.traderId,
        deletedAt: null
      },
      select: {
        id: true,
        locked: true
      }
    })

    if (!trader) {
      return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
    }

    if (trader.locked) {
      return NextResponse.json({ error: 'Trader is locked' }, { status: 403 })
    }

    const company = await prisma.company.findFirst({
      where: {
        id: normalized.companyId,
        traderId: normalized.traderId,
        deletedAt: null
      },
      select: { id: true, locked: true }
    })

    if (!company) {
      return NextResponse.json({ error: 'Company not found for this trader' }, { status: 404 })
    }

    if (company.locked) {
      return NextResponse.json({ error: 'Company is locked' }, { status: 403 })
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        traderId: normalized.traderId,
        userId: normalized.userId,
        deletedAt: null
      },
      include: {
        trader: {
          select: {
            id: true,
            name: true
          }
        },
        company: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    if (existingUser) {
      const linkedCompany = await prisma.userPermission.findFirst({
        where: {
          userId: existingUser.id,
          companyId: normalized.companyId
        },
        select: { id: true }
      })

      if (existingUser.companyId === normalized.companyId || linkedCompany) {
        return NextResponse.json(
          { error: 'User with this ID is already linked to this company' },
          { status: 409 }
        )
      }

      const userWithoutPassword = omitPassword(existingUser)
      return NextResponse.json(
        {
          ...userWithoutPassword,
          active: !userWithoutPassword.locked,
          linkedExistingUser: true,
          linkedCompanyId: normalized.companyId
        },
        { status: 200 }
      )
    }

    const traderCapacity = await getTraderCapacitySnapshot(prisma, normalized.traderId)
    if (!traderCapacity) {
      return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
    }

    if (
      traderCapacity.maxUsers !== null &&
      traderCapacity.currentUsers >= traderCapacity.maxUsers
    ) {
      return NextResponse.json(
        { error: `Trader user limit reached (${traderCapacity.currentUsers}/${traderCapacity.maxUsers})` },
        { status: 409 }
      )
    }

    const hashedPassword = await bcrypt.hash(normalized.password, 12)

    const user = await prisma.user.create({
      data: {
        traderId: normalized.traderId,
        companyId: normalized.companyId,
        userId: normalized.userId,
        password: hashedPassword,
        name: normalized.name,
        role: normalized.role,
        locked: normalized.locked
      },
      include: {
        trader: {
          select: {
            id: true,
            name: true
          }
        },
        company: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    const userWithoutPassword = omitPassword(user)

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: user.locked ? 'LOCK' : 'CREATE',
      resourceType: 'USER',
      resourceId: user.id,
      scope: {
        traderId: user.traderId,
        companyId: user.companyId
      },
      after: userWithoutPassword,
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json(
      {
        ...userWithoutPassword,
        active: !userWithoutPassword.locked
      },
      { status: 201 }
    )
  } catch {
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}
