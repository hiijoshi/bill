import type { RequestAuthContext } from '@/lib/api-security'
import { normalizeAppRole } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { hashPassword, verifyPassword } from '@/lib/auth'
import { normalizeOptionalString } from '@/lib/api-security'
import { getSession } from '@/lib/session'
import type { SessionNamespace } from '@/lib/session-cookies'

export type SelfProfileUser = {
  id: string
  userId: string
  name: string | null
  role: string | null
  traderId: string
  traderName: string | null
  companyId: string | null
  companyName: string | null
  createdAt: string
  updatedAt: string
}

type SelfProfileSource = {
  id: string
  userId: string
  name: string | null
  role: string | null
  traderId: string
  companyId: string | null
  createdAt: Date
  updatedAt: Date
  trader?: { name: string | null } | null
  company?: { name: string | null } | null
}

export async function loadSelfUser(auth: RequestAuthContext) {
  const user = await prisma.user.findFirst({
    where: auth.userDbId
      ? {
          id: auth.userDbId,
          deletedAt: null
        }
      : {
          userId: auth.userId,
          traderId: auth.traderId,
          deletedAt: null
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

  if (!user) {
    return null
  }

  if (user.locked || user.deletedAt || user.trader?.locked || user.trader?.deletedAt) {
    return null
  }

  return user
}

export async function loadSelfProfileFromSession(namespace: SessionNamespace): Promise<SelfProfileUser | null> {
  const session = await getSession(namespace)
  if (!session) {
    return null
  }

  const basicUser = await prisma.user.findFirst({
    where: {
      userId: session.userId,
      traderId: session.traderId,
      deletedAt: null
    },
    select: {
      id: true,
      userId: true,
      traderId: true,
      role: true,
      companyId: true
    }
  })

  if (!basicUser) {
    return null
  }

  const auth: RequestAuthContext = {
    userId: basicUser.userId,
    traderId: basicUser.traderId,
    role: normalizeAppRole(basicUser.role || session.role),
    companyId: basicUser.companyId || null,
    userDbId: basicUser.id
  }

  const fullUser = await loadSelfUser(auth)
  if (!fullUser) {
    return null
  }

  return toSelfProfile(fullUser)
}

export function toSelfProfile(user: SelfProfileSource): SelfProfileUser {
  return {
    id: user.id,
    userId: user.userId,
    name: user.name || null,
    role: user.role || null,
    traderId: user.traderId,
    traderName: user.trader?.name || null,
    companyId: user.companyId || null,
    companyName: user.company?.name || null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  }
}

export async function updateSelfProfile(input: {
  auth: RequestAuthContext
  name?: string | null
  currentPassword?: string
  newPassword?: string
}) {
  const user = await loadSelfUser(input.auth)
  if (!user) {
    return { ok: false as const, status: 401, error: 'Authentication required' }
  }

  const updateData: {
    name?: string | null
    password?: string
  } = {}

  if (input.name !== undefined) {
    updateData.name = normalizeOptionalString(input.name)
  }

  if (input.newPassword !== undefined) {
    const currentPassword = input.currentPassword || ''
    const isCurrentPasswordValid = await verifyPassword(currentPassword, user.password)
    if (!isCurrentPasswordValid) {
      return { ok: false as const, status: 400, error: 'Current password is incorrect' }
    }

    // CWE-208: use constant-time comparison to avoid timing side-channel
    const { timingSafeEqual } = await import('crypto')
    const a = Buffer.from(currentPassword)
    const b = Buffer.from(input.newPassword)
    const sameLength = a.length === b.length
    const paddedA = sameLength ? a : Buffer.alloc(b.length)
    const isSamePassword = sameLength && timingSafeEqual(paddedA, b)
    if (isSamePassword) {
      return { ok: false as const, status: 400, error: 'New password must be different from current password' }
    }

    updateData.password = await hashPassword(input.newPassword)
  }

  if (Object.keys(updateData).length === 0) {
    return { ok: false as const, status: 400, error: 'No changes submitted' }
  }

  const updatedUser = await prisma.user.update({
    where: {
      id: user.id
    },
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

  return {
    ok: true as const,
    before: toSelfProfile(user),
    after: toSelfProfile(updatedUser)
  }
}
