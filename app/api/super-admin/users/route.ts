import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeOptionalString, parseBooleanParam, requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { getTraderCapacitySnapshot } from '@/lib/trader-limits'
import { PERMISSION_MODULES, type PermissionModule } from '@/lib/permissions'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { syncSupabaseForLegacyUserMutation, syncSupabaseForLegacyUserMutationWithTimeout } from '@/lib/supabase/legacy-user-sync'
import { isUniqueConstraintError, normalizePrismaApiError } from '@/lib/prisma-errors'

const createUserSchema = z
  .object({
    traderId: z.string().trim().min(1, 'Trader ID is required'),
    companyId: z.string().trim().min(1, 'Company ID is required'),
    userId: z.string().trim().min(1, 'User ID is required').max(50),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    name: z.string().trim().max(100).optional().nullable(),
    locked: z.boolean().optional(),
    active: z.boolean().optional(),
    privilegePreset: z.enum(['none', 'read', 'all']).optional()
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
    locked: activeLocked ?? payload.locked ?? false,
    privilegePreset: payload.privilegePreset || 'all'
  }
}

function buildPermissionRowsForPreset(preset: 'none' | 'read' | 'all') {
  return PERMISSION_MODULES.map((module: PermissionModule) => ({
    module,
    canRead: preset !== 'none',
    canWrite: preset === 'all'
  }))
}

async function replacePermissionsForCompany(tx: Prisma.TransactionClient, params: {
  userId: string
  companyId: string
  preset: 'none' | 'read' | 'all'
}) {
  await tx.userPermission.deleteMany({
    where: {
      userId: params.userId,
      companyId: params.companyId
    }
  })

  const rows = buildPermissionRowsForPreset(params.preset)
  if (rows.length === 0) return

  await tx.userPermission.createMany({
    data: rows.map((row) => ({
      userId: params.userId,
      companyId: params.companyId,
      module: row.module,
      canRead: row.canRead,
      canWrite: row.canWrite
    }))
  })
}

function omitPassword<T extends { password: string }>(user: T): Omit<T, 'password'> {
  const { password, ...rest } = user
  void password
  return rest
}

async function findExistingUserForCreate(traderId: string, userId: string) {
  return prisma.user.findFirst({
    where: {
      traderId,
      userId,
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
      },
      permissions: {
        select: {
          companyId: true,
          company: {
            select: {
              id: true,
              name: true
            }
          }
        }
      }
    }
  })
}

async function respondForExistingUserLink(params: {
  request: NextRequest
  authResult: Extract<ReturnType<typeof requireRoles>, { ok: true }>
  normalized: ReturnType<typeof normalizeCreatePayload>
  existingUser: NonNullable<Awaited<ReturnType<typeof findExistingUserForCreate>>>
}) {
  const { request, authResult, normalized, existingUser } = params

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

  const hashedPassword = await bcrypt.hash(normalized.password, 12)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: existingUser.id },
      data: {
        companyId: existingUser.companyId || normalized.companyId,
        password: hashedPassword,
        name: normalized.name ?? existingUser.name,
        locked: normalized.locked
      }
    })

    await replacePermissionsForCompany(tx, {
      userId: existingUser.id,
      companyId: normalized.companyId,
      preset: normalized.privilegePreset
    })
  })

  const refreshedUser = await findExistingUserForCreate(normalized.traderId, normalized.userId)

  if (!refreshedUser) {
    return NextResponse.json({ error: 'Failed to link existing user' }, { status: 500 })
  }

  const userWithoutPassword = omitPassword(refreshedUser)

  await writeAuditLog({
    actor: {
      id: authResult.auth.userDbId || authResult.auth.userId,
      role: authResult.auth.role
    },
    action: 'UPDATE',
    resourceType: 'USER',
    resourceId: refreshedUser.id,
    scope: {
      traderId: refreshedUser.traderId,
      companyId: normalized.companyId
    },
    after: {
      ...userWithoutPassword,
      active: !userWithoutPassword.locked,
      linkedExistingUser: true,
      linkedCompanyId: normalized.companyId
    },
    requestMeta: getAuditRequestMeta(request),
    notes: 'Attached existing user to additional company'
  })

  let cloudSyncWarning: string | null = null
  if (isSupabaseConfigured()) {
    try {
      const syncResult = await syncSupabaseForLegacyUserMutationWithTimeout({
        legacyUserId: refreshedUser.id,
        password: normalized.password
      })
      if (!syncResult.synced && syncResult.reason) {
        cloudSyncWarning = syncResult.reason
      }
    } catch (syncErr) {
      cloudSyncWarning = syncErr instanceof Error ? syncErr.message : 'Cloud sync failed'
      console.warn('Supabase sync warning (non-fatal):', cloudSyncWarning)
    }
  }

  return NextResponse.json(
    {
      ...userWithoutPassword,
      active: !userWithoutPassword.locked,
      linkedExistingUser: true,
      linkedCompanyId: normalized.companyId,
      credentialsUpdated: true,
      ...(cloudSyncWarning ? { cloudSyncWarning } : {})
    },
    { status: 200 }
  )
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
      select: {
        id: true,
        userId: true,
        traderId: true,
        companyId: true,
        name: true,
        role: true,
        locked: true,
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
        },
        permissions: {
          select: {
            companyId: true,
            company: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return NextResponse.json(
      users.map((user) => ({
        ...user,
        active: !user.locked
      }))
    )
  } catch {
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response
  let parsedCreatePayload: z.infer<typeof createUserSchema> | null = null

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

    parsedCreatePayload = parsed.data
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

    const existingUser = await findExistingUserForCreate(normalized.traderId, normalized.userId)

    if (existingUser) {
      return respondForExistingUserLink({
        request,
        authResult,
        normalized,
        existingUser
      })
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

    const createdUserId = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          traderId: normalized.traderId,
          companyId: normalized.companyId,
          userId: normalized.userId,
          password: hashedPassword,
          name: normalized.name,
          role: normalized.role,
          locked: normalized.locked
        }
      })

      await replacePermissionsForCompany(tx, {
        userId: createdUser.id,
        companyId: normalized.companyId,
        preset: normalized.privilegePreset
      })

      return createdUser.id
    })

    const user = await prisma.user.findFirstOrThrow({
      where: { id: createdUserId },
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
        },
        permissions: {
          select: {
            companyId: true,
            company: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    })

    if (isSupabaseConfigured()) {
      const syncResult = await syncSupabaseForLegacyUserMutation({
        legacyUserId: user.id,
        password: normalized.password
      })

      if (!syncResult.synced) {
        await prisma.$transaction(async (tx) => {
          await tx.userPermission.deleteMany({
            where: {
              userId: user.id
            }
          })
          await tx.user.delete({
            where: {
              id: user.id
            }
          })
        })

        throw new Error(syncResult.reason || 'Failed to provision Supabase login for the new user')
      }
    }

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
  } catch (error) {
    if (isUniqueConstraintError(error, ['traderId', 'userId'])) {
      if (parsedCreatePayload) {
        const normalized = normalizeCreatePayload(parsedCreatePayload)
        const existingUser = await findExistingUserForCreate(normalized.traderId, normalized.userId)
        if (existingUser) {
          return respondForExistingUserLink({
            request,
            authResult,
            normalized,
            existingUser
          })
        }
      }
    }

    console.error('POST /api/super-admin/users failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })

    const apiError = normalizePrismaApiError(error, 'Failed to create user', {
      uniqueMessages: {
        'traderId,userId': 'User with this ID already exists for this trader'
      }
    })

    return NextResponse.json(
      { error: apiError.message },
      { status: apiError.status }
    )
  }
}
