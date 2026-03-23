import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Prisma } from '@prisma/client'
import { env } from './config'
import { prisma } from './prisma'

// env.JWT_SECRET is already validated in config.ts; REFRESH_SECRET may fall back
// to JWT_SECRET if not provided explicitly.
const JWT_SECRET = env.JWT_SECRET
const REFRESH_SECRET = env.REFRESH_SECRET || env.JWT_SECRET


const JWT_EXPIRES_IN = '30d' // Long-lived access token to avoid premature logout on normal usage
const REFRESH_EXPIRES_IN = '90d' // Sliding refresh window for reliable long-running sessions

type DecodedAuthPayload = jwt.JwtPayload & {
  userId?: string
  traderId?: string
  name?: string
  role?: string
  dbId?: string   // DB primary key (User.id)
}

function parseDecodedPayload(decoded: string | jwt.JwtPayload): Omit<AuthUser, 'id'> | null {
  if (typeof decoded !== 'object' || decoded === null) {
    return null
  }
  const payload = decoded as DecodedAuthPayload
  if (typeof payload.userId !== 'string' || typeof payload.traderId !== 'string') {
    return null
  }

  return {
    userId: payload.userId,
    traderId: payload.traderId,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    role: normalizeRole(typeof payload.role === 'string' ? payload.role : undefined),
    dbId: typeof payload.dbId === 'string' ? payload.dbId : undefined
  }
}

export interface AuthUser {
  id: string
  userId: string
  traderId: string
  name?: string
  role?: string
  dbId?: string   // DB primary key
}

export interface LoginCredentials {
  userId: string
  password: string
  traderId?: string
}

export interface AuthResponse {
  success: boolean
  user?: AuthUser
  trader?: {
    id: string
    name: string
  }
  company?: {
    id: string
    name: string
  }
  token?: string
  refreshToken?: string
  error?: string
}

const authUserSelect = {
  id: true,
  userId: true,
  traderId: true,
  password: true,
  companyId: true,
  name: true,
  role: true,
  locked: true,
  deletedAt: true,
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
      deletedAt: true,
      traderId: true
    }
  }
} as const

type AuthUserRecord = Prisma.UserGetPayload<{
  select: typeof authUserSelect
}>

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 14)
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return await bcrypt.compare(password, hashedPassword)
}

export function normalizeRole(role?: string | null): string | undefined {
  if (!role) return undefined
  // convert to lowercase underscore style
  return role.toLowerCase().replace(/\s+/g, '_')
}

export function generateToken(
  payload: Omit<AuthUser, 'id'>,
  expiresIn: jwt.SignOptions['expiresIn'] = JWT_EXPIRES_IN
): string {
  const normalized: Omit<AuthUser, 'id'> = {
    ...payload,
    role: normalizeRole(payload.role)
  }
  return jwt.sign(normalized, JWT_SECRET!, { expiresIn } as jwt.SignOptions)
}

export function generateRefreshToken(
  payload: Omit<AuthUser, 'id'>,
  expiresIn: jwt.SignOptions['expiresIn'] = REFRESH_EXPIRES_IN
): string {
  const normalized: Omit<AuthUser, 'id'> = {
    ...payload,
    role: normalizeRole(payload.role)
  }
  return jwt.sign(normalized, REFRESH_SECRET!, { expiresIn } as jwt.SignOptions)
}

export function verifyRefreshToken(token: string): Omit<AuthUser, 'id'> | null {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET!)
    return parseDecodedPayload(decoded)
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Refresh token verification failed:', error instanceof Error ? error.message : 'Unknown error')
    }
    return null
  }
}

export function verifyToken(token: string): Omit<AuthUser, 'id'> | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET!)
    return parseDecodedPayload(decoded)
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Token verification failed:', error instanceof Error ? error.message : 'Unknown error')
    }
    return null
  }
}

export async function authenticateUser(credentials: LoginCredentials): Promise<AuthResponse> {
  try {
    const { userId, password, traderId } = credentials
    const normalizedUserId = userId.toLowerCase().trim()
    const traderInput = traderId?.trim()
    const candidates: AuthUserRecord[] = traderInput
      ? await prisma.user.findMany({
          where: {
            userId: normalizedUserId,
            deletedAt: null,
            OR: [
              { traderId: traderInput },
              {
                trader: {
                  name: {
                    equals: traderInput,
                    mode: 'insensitive'
                  }
                }
              }
            ]
          },
          select: authUserSelect
        })
      : await prisma.user.findMany({
          where: {
            userId: normalizedUserId,
            deletedAt: null
          },
          select: authUserSelect
        })

    if (candidates.length === 0) {
      return {
        success: false,
        error: 'Invalid credentials'
      }
    }

    const validCandidates = candidates.filter((candidate) => {
      // Guard against data corruption where relation is unexpectedly missing.
      if (!candidate?.trader) return false
      if (candidate.trader.deletedAt) return false
      return true
    })

    if (validCandidates.length === 0) {
      return {
        success: false,
        error: 'Account setup is incomplete. Contact administrator.'
      }
    }

    const traderMatchedCandidates = validCandidates

    if (traderInput && traderMatchedCandidates.length === 0) {
      return {
        success: false,
        error: 'Invalid credentials'
      }
    }

    const verificationPool = traderInput ? traderMatchedCandidates : validCandidates
    const passwordMatched = (
      await Promise.all(
        verificationPool.map(async (candidate) => ({
          candidate,
          isValid: await verifyPassword(password, candidate.password)
        }))
      )
    )
      .filter((entry) => entry.isValid)
      .map((entry) => entry.candidate)

    if (passwordMatched.length === 0) {
      return {
        success: false,
        error: 'Invalid credentials'
      }
    }

    if (passwordMatched.length > 1) {
      return {
        success: false,
        error: 'Multiple accounts found. Please enter correct Trader ID.'
      }
    }

    const user = passwordMatched[0]

    if (user.locked) {
      return {
        success: false,
        error: 'User account is locked'
      }
    }

    if (user.trader?.deletedAt) {
      return {
        success: false,
        error: 'Trader account is inactive'
      }
    }

    if (user.trader?.locked) {
      return {
        success: false,
        error: 'Trader account is locked'
      }
    }

    const [permissionRows, assignedCompany] = await Promise.all([
      prisma.userPermission.findMany({
        where: {
          userId: user.id,
          OR: [{ canRead: true }, { canWrite: true }],
          company: {
            deletedAt: null,
            locked: false,
            OR: [{ traderId: user.traderId }, { traderId: null }]
          }
        },
        select: {
          companyId: true
        }
      }),
      user.companyId
        ? prisma.company.findFirst({
            where: {
              id: user.companyId,
              deletedAt: null,
              locked: false,
              OR: [{ traderId: user.traderId }, { traderId: null }]
            },
            select: {
              id: true,
              name: true
            }
          })
        : Promise.resolve(null)
    ])

    const fallbackCompanyIds = Array.from(
      new Set([
        ...(user.companyId ? [user.companyId] : []),
        ...permissionRows.map((row) => row.companyId)
      ])
    )

    const resolvedCompany =
      assignedCompany ||
      (fallbackCompanyIds.length > 0
        ? await prisma.company.findFirst({
            where: {
              id: { in: fallbackCompanyIds },
              deletedAt: null,
              locked: false,
              OR: [{ traderId: user.traderId }, { traderId: null }]
            },
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true
            }
          })
        : await prisma.company.findFirst({
            where: {
              deletedAt: null,
              locked: false,
              OR: [{ traderId: user.traderId }, { traderId: null }]
            },
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true
            }
          }))

    // Generate JWT tokens — embed DB id so middleware never needs a DB lookup
    const token = generateToken({
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || undefined,
      role: user.role || undefined,
      dbId: user.id
    })
    
    const refreshToken = generateRefreshToken({
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || undefined,
      role: user.role || undefined,
      dbId: user.id
    })

    return {
      success: true,
      user: {
        id: user.id,
        userId: user.userId,
        traderId: user.traderId,
        name: user.name || undefined,
        role: normalizeRole(user.role) || undefined
      },
      trader: {
        id: user.trader.id,
        name: user.trader.name
      },
      company: resolvedCompany ? {
        id: resolvedCompany.id,
        name: resolvedCompany.name
      } : undefined,
      token,
      refreshToken
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Authentication error:', error)
    }
    if (error instanceof Error) {
      const text = error.message.toLowerCase()
      if (
        text.includes('no such column') ||
        text.includes('unknown column') ||
        text.includes('inconsistent query result')
      ) {
        return {
          success: false,
          error: 'Database schema mismatch. Run: npx prisma db push && npx prisma generate'
        }
      }
    }
    return {
      success: false,
      error: 'Internal server error'
    }
  }
}

export async function createUser(userData: {
  userId: string
  password: string
  traderId: string
  companyId?: string
  name?: string
  role?: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        userId: userData.userId.toLowerCase().trim(),
        traderId: userData.traderId,
        deletedAt: null
      }
    })

    if (existingUser) {
      return {
        success: false,
        error: 'User already exists'
      }
    }

    // Hash password
    const hashedPassword = await hashPassword(userData.password)

    // Create user
    await prisma.user.create({
      data: {
        userId: userData.userId.toLowerCase().trim(),
        password: hashedPassword,
        traderId: userData.traderId,
        companyId: userData.companyId || null,
        name: userData.name,
        role: userData.role || 'company_user'
      }
    })

    return { success: true }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('User creation error:', error)
    }
    return {
      success: false,
      error: 'Internal server error'
    }
  }
}
