import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { normalizeOptionalString, parseBooleanParam, requireRoles, normalizeAppRole } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { getTraderCapacitySnapshot } from '@/lib/trader-limits'

const idParamsSchema = z.object({ id: z.string().trim().min(1, 'User ID is required') })

const updateUserSchema = z
  .object({
    traderId: z.string().trim().min(1).optional(),
    companyId: z.string().trim().min(1).optional().nullable(),
    userId: z.string().trim().min(1).max(50).optional(),
    password: z.string().min(6, 'Password must be at least 6 characters').optional(),
    name: z.string().trim().max(100).optional().nullable(),
    locked: z.boolean().optional(),
    active: z.boolean().optional()
  })
  .strict()
  .refine(
    (value) =>
      value.traderId !== undefined ||
      value.companyId !== undefined ||
      value.userId !== undefined ||
      value.password !== undefined ||
      value.name !== undefined ||
      value.locked !== undefined ||
      value.active !== undefined,
    { message: 'At least one field is required' }
  )

function normalizeCompanyId(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function omitPassword<T extends { password: string }>(user: T): Omit<T, 'password'> {
  const { password, ...rest } = user
  void password
  return rest
}

async function getUserById(id: string, includeDeleted: boolean) {
  const user = await prisma.user.findFirst({
    where: {
      id,
      ...(includeDeleted ? {} : { deletedAt: null })
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
    }
  })

  if (!user) return null

  if (normalizeAppRole(user.role) === 'super_admin') {
    return null
  }

  const withoutPassword = omitPassword(user)
  return {
    ...withoutPassword,
    active: !withoutPassword.locked
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = idParamsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const includeDeleted = parseBooleanParam(new URL(request.url).searchParams.get('includeDeleted'))
    const user = await getUserById(parsedParams.data.id, includeDeleted)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json(user)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = idParamsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    const parsedBody = updateUserSchema.safeParse(body)

    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsedBody.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const userId = parsedParams.data.id
    const existingUser = await prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null
      }
    })

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (normalizeAppRole(existingUser.role) === 'super_admin') {
      return NextResponse.json(
        { error: 'Manage Super Admin account from profile settings only' },
        { status: 403 }
      )
    }

    const isCurrentSessionUser =
      (authResult.auth.userDbId && existingUser.id === authResult.auth.userDbId) ||
      (existingUser.userId === authResult.auth.userId && existingUser.traderId === authResult.auth.traderId)

    const nextTraderId = parsedBody.data.traderId?.trim() || existingUser.traderId
    const nextCompanyId =
      parsedBody.data.companyId === undefined
        ? existingUser.companyId
        : normalizeCompanyId(parsedBody.data.companyId)
    const nextUserId = parsedBody.data.userId?.trim().toLowerCase() || existingUser.userId
    const lockedFromActive = parsedBody.data.active === undefined ? undefined : !parsedBody.data.active
    const nextLocked = parsedBody.data.locked ?? lockedFromActive

    if (nextLocked === true && isCurrentSessionUser) {
      return NextResponse.json({ error: 'Cannot lock current session user' }, { status: 403 })
    }

    if (nextLocked === true && normalizeAppRole(existingUser.role) === 'super_admin') {
      return NextResponse.json({ error: 'Cannot lock super admin users' }, { status: 403 })
    }

    if (normalizeAppRole(existingUser.role) !== 'super_admin' && !nextCompanyId) {
      return NextResponse.json(
        { error: 'Company ID is required for non-super-admin users' },
        { status: 400 }
      )
    }

    if (parsedBody.data.traderId !== undefined && parsedBody.data.traderId.trim() !== existingUser.traderId) {
      const traderCapacity = await getTraderCapacitySnapshot(prisma, nextTraderId)
      if (!traderCapacity) {
        return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
      }

      if (traderCapacity.locked) {
        return NextResponse.json({ error: 'Trader is locked' }, { status: 403 })
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
    }

    if (nextCompanyId) {
      const company = await prisma.company.findFirst({
        where: {
          id: nextCompanyId,
          traderId: nextTraderId,
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
    }

    const duplicateUser = await prisma.user.findFirst({
      where: {
        id: { not: userId },
        traderId: nextTraderId,
        userId: nextUserId,
        deletedAt: null
      },
      select: { id: true }
    })

    if (duplicateUser) {
      return NextResponse.json(
        { error: 'User with this ID already exists for this trader' },
        { status: 409 }
      )
    }

    const updateData: {
      traderId?: string
      companyId?: string | null
      userId?: string
      name?: string | null
      password?: string
      locked?: boolean
    } = {}

    if (parsedBody.data.traderId !== undefined) updateData.traderId = nextTraderId
    if (parsedBody.data.companyId !== undefined) updateData.companyId = nextCompanyId
    if (parsedBody.data.userId !== undefined) updateData.userId = nextUserId
    if (parsedBody.data.name !== undefined) updateData.name = normalizeOptionalString(parsedBody.data.name)
    if (nextLocked !== undefined) updateData.locked = nextLocked
    if (parsedBody.data.password) {
      updateData.password = await bcrypt.hash(parsedBody.data.password, 12)
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
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

    const action =
      nextLocked !== undefined && nextLocked !== existingUser.locked
        ? nextLocked
          ? 'LOCK'
          : 'UNLOCK'
        : 'UPDATE'

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action,
      resourceType: 'USER',
      resourceId: userId,
      scope: {
        traderId: user.traderId,
        companyId: user.companyId
      },
      before: {
        ...existingUser,
        password: undefined
      },
      after: {
        ...userWithoutPassword,
        active: !userWithoutPassword.locked
      },
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json({
      ...userWithoutPassword,
      active: !userWithoutPassword.locked
    })
  } catch {
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = idParamsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const userId = parsedParams.data.id
    const existingUser = await prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null
      }
    })

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (normalizeAppRole(existingUser.role) === 'super_admin') {
      return NextResponse.json({ error: 'Cannot delete super admin users' }, { status: 403 })
    }

    const deletedAt = new Date()
    const deletedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        locked: true,
        deletedAt
      }
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: 'DELETE',
      resourceType: 'USER',
      resourceId: userId,
      scope: {
        traderId: deletedUser.traderId,
        companyId: deletedUser.companyId
      },
      before: {
        ...existingUser,
        password: undefined
      },
      after: {
        ...deletedUser,
        password: undefined
      },
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}
