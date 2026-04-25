import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from './config'
import { prisma } from './prisma'
import { isPrismaSchemaMismatchError } from './prisma-schema-guard'

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
  userDbId?: string
  user_db_id?: string
  companyIds?: unknown
  company_ids?: unknown
}

export type VerifiedSessionPayload = Omit<AuthUser, 'id'> & {
  userDbId?: string | null
  companyIds?: string[]
  iat?: number
  exp?: number
}

function normalizeCompanyIdsClaim(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
  return Array.from(new Set(ids))
}

function parseDecodedPayload(decoded: string | jwt.JwtPayload): VerifiedSessionPayload | null {
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
    userDbId:
      typeof payload.userDbId === 'string'
        ? payload.userDbId
        : typeof payload.user_db_id === 'string'
          ? payload.user_db_id
          : null,
    companyIds: normalizeCompanyIdsClaim(
      Array.isArray(payload.companyIds) ? payload.companyIds : payload.company_ids
    ),
    iat: typeof payload.iat === 'number' ? payload.iat : undefined,
    exp: typeof payload.exp === 'number' ? payload.exp : undefined
  }
}

function stripPayloadMetadata(payload: VerifiedSessionPayload): Omit<AuthUser, 'id'> {
  return {
    userId: payload.userId,
    traderId: payload.traderId,
    name: payload.name,
    role: payload.role
  }
}

export interface AuthUser {
  id: string
  userId: string
  traderId: string
  name?: string
  role?: string
}

export interface LoginCredentials {
  userId: string
  password: string
  // Kept as traderId for API compatibility; treated as traderName during authentication.
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
  payload: Omit<AuthUser, 'id'> & { userDbId?: string | null; companyIds?: string[] },
  expiresIn: jwt.SignOptions['expiresIn'] = JWT_EXPIRES_IN
): string {
  const normalized: Omit<AuthUser, 'id'> & { userDbId?: string; companyIds?: string[] } = {
    userId: payload.userId,
    traderId: payload.traderId,
    name: payload.name,
    role: normalizeRole(payload.role)
  }
  if (payload.userDbId) {
    normalized.userDbId = payload.userDbId
  }
  if (payload.companyIds && payload.companyIds.length > 0) {
    normalized.companyIds = Array.from(new Set(payload.companyIds.map((entry) => String(entry || '').trim()).filter(Boolean)))
  }
  return jwt.sign(normalized, JWT_SECRET!, { expiresIn } as jwt.SignOptions)
}

export function generateRefreshToken(
  payload: Omit<AuthUser, 'id'> & { userDbId?: string | null; companyIds?: string[] },
  expiresIn: jwt.SignOptions['expiresIn'] = REFRESH_EXPIRES_IN
): string {
  const normalized: Omit<AuthUser, 'id'> & { userDbId?: string; companyIds?: string[] } = {
    userId: payload.userId,
    traderId: payload.traderId,
    name: payload.name,
    role: normalizeRole(payload.role)
  }
  if (payload.userDbId) {
    normalized.userDbId = payload.userDbId
  }
  if (payload.companyIds && payload.companyIds.length > 0) {
    normalized.companyIds = Array.from(new Set(payload.companyIds.map((entry) => String(entry || '').trim()).filter(Boolean)))
  }
  return jwt.sign(normalized, REFRESH_SECRET!, { expiresIn } as jwt.SignOptions)
}

export function verifyRefreshToken(token: string): Omit<AuthUser, 'id'> | null {
  const payload = verifyRefreshTokenWithMetadata(token)
  return payload ? stripPayloadMetadata(payload) : null
}

export function verifyRefreshTokenWithMetadata(token: string): VerifiedSessionPayload | null {
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
  const payload = verifyTokenWithMetadata(token)
  return payload ? stripPayloadMetadata(payload) : null
}

export function verifyTokenWithMetadata(token: string): VerifiedSessionPayload | null {
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
    const { userId, password, traderId: traderNameInputRaw } = credentials
    const normalizedUserId = userId.toLowerCase().trim()
    const traderNameInput = traderNameInputRaw?.trim()
    const candidateSelect = {
      id: true,
      userId: true,
      traderId: true,
      companyId: true,
      password: true,
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
      }
    } as const

    const exactTraderCandidate = traderNameInput
      ? await prisma.user.findFirst({
          where: {
            userId: normalizedUserId,
            trader: {
              is: {
                name: traderNameInput,
                deletedAt: null
              }
            },
            deletedAt: null
          },
          select: candidateSelect
        })
      : null

    // For trader-scoped login, prefer exact trader-name lookup first.
    // If no exact candidate is found we still scan by userId so we can preserve
    // case-insensitive matching for trader names.
    const candidates = exactTraderCandidate
      ? [exactTraderCandidate]
      : await prisma.user.findMany({
          where: {
            userId: normalizedUserId,
            deletedAt: null
          },
          select: candidateSelect
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

    const traderMatchedCandidates = traderNameInput
      ? validCandidates.filter((candidate) => {
          const input = traderNameInput.toLowerCase()
          const traderNameMatch = String(candidate.trader?.name || '').trim().toLowerCase() === input
          return traderNameMatch
        })
      : validCandidates

    if (traderNameInput && traderMatchedCandidates.length === 0) {
      return {
        success: false,
        error: 'Invalid credentials'
      }
    }

    const verificationPool = traderNameInput ? traderMatchedCandidates : validCandidates
    const passwordMatched: typeof candidates = []

    for (const candidate of verificationPool) {
      const isValid = await verifyPassword(password, candidate.password)
      if (isValid) passwordMatched.push(candidate)
    }

    if (passwordMatched.length === 0) {
      return {
        success: false,
        error: 'Invalid credentials'
      }
    }

    if (passwordMatched.length > 1) {
      return {
        success: false,
        error: 'Multiple accounts found. Please enter exact Trader Name.'
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

    const permissionRows = await prisma.userPermission.findMany({
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
    })

    const fallbackCompanyIds = Array.from(
      new Set([
        ...(user.companyId ? [user.companyId] : []),
        ...permissionRows.map((row) => row.companyId)
      ])
    )

    const company = user.companyId
      ? await prisma.company.findFirst({
          where: {
            id: user.companyId,
            deletedAt: null,
            locked: false,
            OR: [{ traderId: user.traderId }, { traderId: null }]
          }
        })
      : null

    const resolvedCompany =
      company ||
      (fallbackCompanyIds.length > 0
        ? await prisma.company.findFirst({
            where: {
              id: { in: fallbackCompanyIds },
              deletedAt: null,
              locked: false,
              OR: [{ traderId: user.traderId }, { traderId: null }]
            },
            orderBy: { name: 'asc' }
          })
        : await prisma.company.findFirst({
            where: {
              deletedAt: null,
              locked: false,
              OR: [{ traderId: user.traderId }, { traderId: null }]
            },
            orderBy: { name: 'asc' }
          }))

    const allowedCompanyIds = Array.from(
      new Set([
        ...fallbackCompanyIds,
        ...(resolvedCompany?.id ? [resolvedCompany.id] : [])
      ])
    )

    // Generate JWT tokens
    const token = generateToken({
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || undefined,
      role: user.role || undefined,
      userDbId: user.id,
      companyIds: allowedCompanyIds
    })
    
    const refreshToken = generateRefreshToken({
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || undefined,
      role: user.role || undefined,
      userDbId: user.id,
      companyIds: allowedCompanyIds
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

    if (isPrismaSchemaMismatchError(error)) {
      return {
        success: false,
        error: 'Database schema mismatch. Run: npm run prisma:migrate:deploy && npx prisma generate'
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
