import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from './config'
import { prisma } from './prisma'

// env.JWT_SECRET is already validated in config.ts; REFRESH_SECRET may fall back
// to JWT_SECRET if not provided explicitly.
const JWT_SECRET = env.JWT_SECRET
const REFRESH_SECRET = env.REFRESH_SECRET || env.JWT_SECRET


const JWT_EXPIRES_IN = '12h' // Extended access token to reduce repeated logins
const REFRESH_EXPIRES_IN = '30d' // Long-lived refresh token

type DecodedAuthPayload = jwt.JwtPayload & {
  userId?: string
  traderId?: string
  name?: string
  role?: string
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
    role: normalizeRole(typeof payload.role === 'string' ? payload.role : undefined)
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

export function generateToken(payload: Omit<AuthUser, 'id'>): string {
  const normalized: Omit<AuthUser, 'id'> = {
    ...payload,
    role: normalizeRole(payload.role)
  }
  return jwt.sign(normalized, JWT_SECRET!, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions)
}

export function generateRefreshToken(payload: Omit<AuthUser, 'id'>): string {
  const normalized: Omit<AuthUser, 'id'> = {
    ...payload,
    role: normalizeRole(payload.role)
  }
  return jwt.sign(normalized, REFRESH_SECRET!, { expiresIn: REFRESH_EXPIRES_IN } as jwt.SignOptions)
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

    // Find all matching user IDs first; trader filtering will be applied safely below.
    const candidates = await prisma.user.findMany({
      where: {
        userId: normalizedUserId,
        deletedAt: null
      },
      include: {
        trader: true,
        company: true
      }
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

    const traderMatchedCandidates = traderInput
      ? validCandidates.filter((candidate) => {
          const id = candidate.traderId.toLowerCase()
          const traderName = candidate.trader?.name?.toLowerCase() || ''
          const input = traderInput.toLowerCase()
          return id === input || traderName === input
        })
      : validCandidates

    if (traderInput && traderMatchedCandidates.length === 0) {
      return {
        success: false,
        error: 'Invalid credentials'
      }
    }

    const verificationPool = traderInput ? traderMatchedCandidates : validCandidates
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

    if (user.companyId) {
      if (!user.company || user.company.deletedAt) {
        return {
          success: false,
          error: 'Company account is inactive'
        }
      }

      if (user.company.locked) {
        return {
          success: false,
          error: 'Company account is locked'
        }
      }
    }

    // Get company for this user (assuming first company of the trader)
    const company = user.companyId
      ? await prisma.company.findFirst({
          where: {
            id: user.companyId,
            traderId: user.traderId,
            deletedAt: null
          }
        })
      : await prisma.company.findFirst({
          where: {
            traderId: user.traderId,
            deletedAt: null
          }
        })

    // Generate JWT tokens
    const token = generateToken({
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || undefined,
      role: user.role || undefined
    })
    
    const refreshToken = generateRefreshToken({
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || undefined,
      role: user.role || undefined
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
      company: company ? {
        id: company.id,
        name: company.name
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
