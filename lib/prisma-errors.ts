import { Prisma } from '@prisma/client'

export type NormalizedApiError = {
  status: number
  message: string
}

function normalizeTarget(meta: unknown): string[] {
  if (!meta || typeof meta !== 'object' || !('target' in meta)) return []
  const target = (meta as { target?: unknown }).target
  if (Array.isArray(target)) {
    return target.filter((value): value is string => typeof value === 'string')
  }
  if (typeof target === 'string') {
    return [target]
  }
  return []
}

export function isUniqueConstraintError(
  error: unknown,
  expectedFields?: string[]
): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code !== 'P2002') return false
  if (!expectedFields || expectedFields.length === 0) return true

  const target = normalizeTarget(error.meta)
  return expectedFields.every((field) => target.includes(field))
}

export function normalizePrismaApiError(
  error: unknown,
  fallbackMessage: string,
  options?: {
    uniqueMessages?: Record<string, string>
  }
): NormalizedApiError {
  if (error instanceof Prisma.PrismaClientValidationError) {
    return {
      status: 400,
      message: 'Invalid data submitted'
    }
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = normalizeTarget(error.meta)
      const uniqueMessages = options?.uniqueMessages || {}
      const directKey = target.join(',')
      const sortedKey = [...target].sort().join(',')
      const message =
        uniqueMessages[directKey] ||
        uniqueMessages[sortedKey] ||
        uniqueMessages[target[0] || ''] ||
        'Record already exists'

      return {
        status: 409,
        message
      }
    }

    if (error.code === 'P2003') {
      return {
        status: 400,
        message: 'Related record was not found'
      }
    }

    if (error.code === 'P2025') {
      return {
        status: 404,
        message: 'Record not found'
      }
    }
  }

  return {
    status: 500,
    message: fallbackMessage
  }
}
