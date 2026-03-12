import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOCK'
  | 'UNLOCK'
  | 'STATUS_CHANGE'
  | 'SECURITY_EVENT'
  | 'LOGIN'
  | 'LOGOUT'

export type AuditResourceType =
  | 'TRADER'
  | 'COMPANY'
  | 'USER'
  | 'PAYMENT'
  | 'PAYMENT_BATCH'
  | 'SECURITY'
  | 'AUTH'

export type AuditScope = {
  traderId?: string | null
  companyId?: string | null
}

export type AuditActor = {
  id: string
  role: string
}

export type AuditRequestMeta = {
  requestId?: string
  ip?: string
  userAgent?: string
}

const SENSITIVE_KEY_PATTERN = /(password|token|secret|api[_-]?key|card|bank|account|ifsc|hash|txnref)/i

function toJsonString(value: unknown): string | null {
  if (value === undefined) return null
  if (value === null) return null
  return JSON.stringify(value)
}

export function sanitizeAuditPayload(value: unknown): unknown {
  if (value === null || value === undefined) return null

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditPayload(item))
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value !== 'object') {
    return value
  }

  const result: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]'
      continue
    }
    result[key] = sanitizeAuditPayload(raw)
  }
  return result
}

function computeDiff(before: unknown, after: unknown): Record<string, unknown> | null {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') {
    return null
  }

  const beforeObj = before as Record<string, unknown>
  const afterObj = after as Record<string, unknown>
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])
  const diff: Record<string, unknown> = {}

  for (const key of keys) {
    const prev = beforeObj[key]
    const next = afterObj[key]
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      diff[key] = { before: prev ?? null, after: next ?? null }
    }
  }

  return Object.keys(diff).length > 0 ? diff : null
}

export function getAuditRequestMeta(request: NextRequest): AuditRequestMeta {
  return {
    requestId: request.headers.get('x-request-id') || undefined,
    ip:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      undefined,
    userAgent: request.headers.get('user-agent') || undefined
  }
}

export async function writeAuditLog(input: {
  actor: AuditActor
  action: AuditAction
  resourceType: AuditResourceType
  resourceId: string
  scope?: AuditScope
  before?: unknown
  after?: unknown
  requestMeta?: AuditRequestMeta
  notes?: string
}): Promise<void> {
  try {
    const sanitizedBefore = sanitizeAuditPayload(input.before)
    const sanitizedAfter = sanitizeAuditPayload(input.after)
    const diff = computeDiff(sanitizedBefore, sanitizedAfter)

    await prisma.auditLog.create({
      data: {
        actorId: input.actor.id,
        actorRole: input.actor.role,
        actorIp: input.requestMeta?.ip || null,
        actorUserAgent: input.requestMeta?.userAgent || null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        scope: toJsonString(input.scope || null),
        before: toJsonString(sanitizedBefore),
        after: toJsonString(sanitizedAfter),
        diff: toJsonString(diff),
        requestId: input.requestMeta?.requestId || null,
        notes: input.notes || null
      }
    })
  } catch {
    // Never break request flow because of audit write failures.
  }
}

export const auditLogger = {
  async logAuthentication(
    userId: string,
    traderId: string,
    action: 'LOGIN_SUCCESS' | 'LOGIN_FAILURE' | 'LOGOUT' | 'TOKEN_REFRESH',
    ipAddress?: string,
    userAgent?: string,
    errorMessage?: string
  ) {
    await writeAuditLog({
      actor: { id: userId || 'unknown', role: 'unknown' },
      action: action === 'LOGOUT' ? 'LOGOUT' : 'LOGIN',
      resourceType: 'AUTH',
      resourceId: userId || 'unknown',
      scope: { traderId: traderId || null },
      requestMeta: { ip: ipAddress, userAgent },
      after: {
        outcome: action,
        error: errorMessage || null
      }
    })
  },
  async logSecurityEvent(
    userId: string,
    traderId: string,
    event: string,
    ipAddress?: string,
    userAgent?: string,
    metadata?: Record<string, unknown>
  ) {
    await writeAuditLog({
      actor: { id: userId || 'unknown', role: 'unknown' },
      action: 'SECURITY_EVENT',
      resourceType: 'SECURITY',
      resourceId: event,
      scope: { traderId: traderId || null },
      requestMeta: { ip: ipAddress, userAgent },
      after: metadata || { event }
    })
  }
}
