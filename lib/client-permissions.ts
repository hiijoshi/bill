import { getClientCache, setClientCache } from './client-fetch-cache'
import { isAbortError } from './http'
import type { PermissionAccessRow } from './app-default-route'
import type { PermissionModule } from './permissions'

export type ClientPermissionsPayload = {
  companyId: string
  permissions: PermissionAccessRow[]
  grantedReadModules?: number
  grantedWriteModules?: number
}

const PERMISSIONS_CACHE_AGE_MS = 30_000
const PERMISSIONS_ERROR_CACHE_AGE_MS = 5_000
const PERMISSIONS_TIMEOUT_MS = 12_000
const permissionsInFlight = new Map<string, Promise<ClientPermissionsPayload>>()
const permissionErrors = new Map<string, { error: Error; updatedAt: number }>()

type PermissionsRequestError = Error & { status?: number }

function createPermissionsRequestError(message: string, status?: number): PermissionsRequestError {
  const error = new Error(message) as PermissionsRequestError
  if (typeof status === 'number') {
    error.status = status
  }
  return error
}

function buildPermissionsCacheKey(companyId: string): string {
  return `permissions:${companyId || 'none'}`
}

function getPermissionsEndpoint(companyId: string): string {
  const searchParams = new URLSearchParams({
    includeMeta: 'true'
  })

  if (companyId) {
    searchParams.set('companyId', companyId)
  }

  return `/api/auth/permissions?${searchParams.toString()}`
}

async function fetchPermissionsFromApi(companyId: string): Promise<ClientPermissionsPayload> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort('PermissionsTimeout'), PERMISSIONS_TIMEOUT_MS)

  try {
    const response = await fetch(getPermissionsEndpoint(companyId), {
      cache: 'no-store',
      signal: controller.signal
    })

    const payload = (await response.json().catch(() => ({}))) as Partial<ClientPermissionsPayload> & {
      error?: string
    }

    if (!response.ok) {
      throw createPermissionsRequestError(payload.error || 'Failed to fetch permissions', response.status)
    }

    return {
      companyId: String(payload.companyId || companyId).trim(),
      permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
      grantedReadModules:
        typeof payload.grantedReadModules === 'number' ? payload.grantedReadModules : undefined,
      grantedWriteModules:
        typeof payload.grantedWriteModules === 'number' ? payload.grantedWriteModules : undefined
    }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function loadClientPermissions(
  companyId: string,
  options: { force?: boolean } = {}
): Promise<ClientPermissionsPayload> {
  const normalizedCompanyId = String(companyId || '').trim()
  if (!normalizedCompanyId) {
    return {
      companyId: '',
      permissions: []
    }
  }

  const cacheKey = buildPermissionsCacheKey(normalizedCompanyId)
  const inFlight = permissionsInFlight.get(cacheKey)
  if (inFlight) {
    return inFlight
  }

  if (!options.force) {
    const cached = getClientCache<ClientPermissionsPayload>(cacheKey, PERMISSIONS_CACHE_AGE_MS)
    if (cached) {
      return cached
    }
  }

  const cachedError = permissionErrors.get(cacheKey)
  if (cachedError && Date.now() - cachedError.updatedAt <= PERMISSIONS_ERROR_CACHE_AGE_MS) {
    throw cachedError.error
  }

  const request = fetchPermissionsFromApi(normalizedCompanyId)
    .then((payload) => {
      permissionErrors.delete(cacheKey)
      setClientCache(cacheKey, payload, { persist: true })
      return payload
    })
    .catch((error) => {
      const normalizedError = isAbortError(error)
        ? createPermissionsRequestError('Permissions request timed out')
        : error instanceof Error
          ? error
          : createPermissionsRequestError('Failed to fetch permissions')

      permissionErrors.set(cacheKey, {
        error: normalizedError,
        updatedAt: Date.now()
      })

      if (isAbortError(error)) {
        throw normalizedError
      }

      throw normalizedError
    })
    .finally(() => {
      if (permissionsInFlight.get(cacheKey) === request) {
        permissionsInFlight.delete(cacheKey)
      }
    })

  permissionsInFlight.set(cacheKey, request)

  return request
}

export function getClientModulePermission(rows: PermissionAccessRow[], module: PermissionModule): {
  canRead: boolean
  canWrite: boolean
} {
  const permission = rows.find((row) => row.module === module)

  return {
    canRead: Boolean(permission?.canRead || permission?.canWrite),
    canWrite: Boolean(permission?.canWrite)
  }
}
