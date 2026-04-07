import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { isPrismaSchemaMismatchError } from '@/lib/prisma-schema-guard'
import {
  getTraderSubscriptionEntitlement,
  type SubscriptionLifecycleState,
  type TraderSubscriptionEntitlement
} from '@/lib/subscription-core'

type DbClient = typeof prisma | Prisma.TransactionClient
const TRADER_RETENTION_SCHEMA_IDENTIFIERS = ['traderdatalifecycle', 'traderdatabackup'] as const
let traderRetentionSchemaAvailability: boolean | null = null

export const TRADER_DATA_LIFECYCLE_STATES = [
  'active',
  'expired',
  'cancelled',
  'backup_ready',
  'deletion_pending',
  'deleted'
] as const

export const TRADER_BACKUP_STATUSES = ['pending', 'processing', 'ready', 'failed', 'purged'] as const
export const TRADER_BACKUP_FORMATS = ['json'] as const

export type TraderDataLifecycleState = (typeof TRADER_DATA_LIFECYCLE_STATES)[number]
export type TraderBackupStatus = (typeof TRADER_BACKUP_STATUSES)[number]
export type TraderBackupFormat = (typeof TRADER_BACKUP_FORMATS)[number]

export type TraderBackupSummary = {
  id: string
  traderId: string
  requestedByUserId: string | null
  requestedByRole: string | null
  requestSource: string
  status: TraderBackupStatus
  format: TraderBackupFormat
  fileName: string | null
  fileSizeBytes: number | null
  checksum: string | null
  exportedAt: string | null
  lastDownloadedAt: string | null
  downloadCount: number
  failedAt: string | null
  errorMessage: string | null
  notes: string | null
  counts: Record<string, number> | null
  createdAt: string
  updatedAt: string
}

export type TraderDataLifecycleSummary = {
  traderId: string
  state: TraderDataLifecycleState
  configuredState: TraderDataLifecycleState | null
  subscriptionLifecycleState: SubscriptionLifecycleState | null
  readOnlyMode: boolean
  allowReadOperations: boolean
  allowWriteOperations: boolean
  allowBackupRequest: boolean
  allowBackupDownload: boolean
  allowClosureRequest: boolean
  message: string | null
  readOnlySince: string | null
  latestBackup: TraderBackupSummary | null
  latestReadyBackup: TraderBackupSummary | null
  closureRequestedAt: string | null
  closureRequestedByUserId: string | null
  closureRequestSource: string | null
  closureNotes: string | null
  retentionDays: number | null
  scheduledDeletionAt: string | null
  deletionPendingAt: string | null
  deletionMarkedByUserId: string | null
  deletionApprovedAt: string | null
  deletionApprovedByUserId: string | null
  deletionExecutedAt: string | null
  deletionExecutedByUserId: string | null
  notes: string | null
}

function normalizeToken(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
}

function normalizeDate(value: Date | null | undefined) {
  return value instanceof Date ? value.toISOString() : null
}

function normalizePositiveInteger(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const normalized = Math.trunc(value)
  return normalized >= 0 ? normalized : null
}

function isTraderRetentionSchemaMismatchError(error: unknown) {
  return isPrismaSchemaMismatchError(error, TRADER_RETENTION_SCHEMA_IDENTIFIERS)
}

function markTraderRetentionSchemaAvailability(isAvailable: boolean) {
  traderRetentionSchemaAvailability = isAvailable
}

function parseCountsJson(value: string | null | undefined) {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    const result: Record<string, number> = {}

    for (const [key, rawValue] of Object.entries(parsed)) {
      if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) continue
      result[key] = Math.max(0, Math.trunc(rawValue))
    }

    return result
  } catch {
    return null
  }
}

export function normalizeTraderDataLifecycleState(value: unknown): TraderDataLifecycleState {
  const normalized = normalizeToken(value)
  if (normalized === 'expired') return 'expired'
  if (normalized === 'cancelled') return 'cancelled'
  if (normalized === 'backup_ready') return 'backup_ready'
  if (normalized === 'deletion_pending') return 'deletion_pending'
  if (normalized === 'deleted') return 'deleted'
  return 'active'
}

export function normalizeTraderBackupStatus(value: unknown): TraderBackupStatus {
  const normalized = normalizeToken(value)
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  if (normalized === 'purged') return 'purged'
  return 'pending'
}

export function normalizeTraderBackupFormat(value: unknown): TraderBackupFormat {
  return normalizeToken(value) === 'json' ? 'json' : 'json'
}

export function resolveEffectiveTraderDataLifecycleState(args: {
  configuredState: TraderDataLifecycleState | null
  traderDeleted: boolean
  subscriptionLifecycleState: SubscriptionLifecycleState | null
}): TraderDataLifecycleState {
  if (args.traderDeleted || args.configuredState === 'deleted') {
    return 'deleted'
  }

  if (args.configuredState === 'deletion_pending') {
    return 'deletion_pending'
  }

  if (args.configuredState === 'backup_ready') {
    return 'backup_ready'
  }

  if (args.configuredState === 'cancelled') {
    return 'cancelled'
  }

  if (args.configuredState === 'expired') {
    return 'expired'
  }

  if (args.subscriptionLifecycleState === 'cancelled') {
    return 'cancelled'
  }

  if (args.subscriptionLifecycleState === 'expired' || args.subscriptionLifecycleState === 'suspended') {
    return 'expired'
  }

  return 'active'
}

function isReadOnlyState(state: TraderDataLifecycleState) {
  return state === 'expired' || state === 'cancelled' || state === 'backup_ready' || state === 'deletion_pending'
}

function buildStateMessage(args: {
  state: TraderDataLifecycleState
  subscriptionMessage: string | null
  latestReadyBackup: TraderBackupSummary | null
  closureRequestedAt: string | null
}) {
  if (args.state === 'deleted') {
    return 'Trader data was permanently removed after backup confirmation.'
  }

  if (args.state === 'deletion_pending') {
    return 'Account is marked for final deletion. Business data remains read-only until super admin confirms closure.'
  }

  if (args.state === 'backup_ready') {
    return args.latestReadyBackup
      ? 'Backup is ready for download. Business data remains read-only until renewal or final closure.'
      : 'Backup generation completed. Business data remains read-only until renewal or final closure.'
  }

  if (args.state === 'cancelled') {
    return 'Subscription cancelled. Business data is available in read-only mode. Renew, download backup, or request closure.'
  }

  if (args.state === 'expired') {
    return 'Subscription expired. Business data is available in read-only mode. Renew, download backup, or contact admin.'
  }

  if (args.closureRequestedAt) {
    return 'Closure request submitted. Super admin review is pending.'
  }

  return args.subscriptionMessage
}

function toBackupSummary(
  row:
    | {
        id: string
        traderId: string
        requestedByUserId: string | null
        requestedByRole: string | null
        requestSource: string
        status: string
        format: string
        fileName: string | null
        fileSizeBytes: number | null
        checksum: string | null
        recordCountsJson: string | null
        exportedAt: Date | null
        lastDownloadedAt: Date | null
        downloadCount: number
        failedAt: Date | null
        errorMessage: string | null
        notes: string | null
        createdAt: Date
        updatedAt: Date
      }
    | null
): TraderBackupSummary | null {
  if (!row) return null

  return {
    id: row.id,
    traderId: row.traderId,
    requestedByUserId: row.requestedByUserId,
    requestedByRole: row.requestedByRole,
    requestSource: String(row.requestSource || '').trim() || 'super_admin',
    status: normalizeTraderBackupStatus(row.status),
    format: normalizeTraderBackupFormat(row.format),
    fileName: row.fileName || null,
    fileSizeBytes: normalizePositiveInteger(row.fileSizeBytes),
    checksum: row.checksum || null,
    exportedAt: normalizeDate(row.exportedAt),
    lastDownloadedAt: normalizeDate(row.lastDownloadedAt),
    downloadCount: normalizePositiveInteger(row.downloadCount) ?? 0,
    failedAt: normalizeDate(row.failedAt),
    errorMessage: row.errorMessage || null,
    notes: row.notes || null,
    counts: parseCountsJson(row.recordCountsJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export async function getTraderBackupHistory(db: DbClient, traderId: string) {
  if (traderRetentionSchemaAvailability === false) {
    return []
  }

  try {
    const rows = await db.traderDataBackup.findMany({
      where: {
        traderId
      },
      orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }]
    })

    markTraderRetentionSchemaAvailability(true)
    return rows.map((row) => toBackupSummary(row)).filter((row): row is TraderBackupSummary => Boolean(row))
  } catch (error) {
    if (isTraderRetentionSchemaMismatchError(error)) {
      markTraderRetentionSchemaAvailability(false)
      return []
    }

    throw error
  }
}

export async function ensureTraderDataLifecycleRecord(db: DbClient, traderId: string) {
  return db.traderDataLifecycle.upsert({
    where: {
      traderId
    },
    create: {
      traderId,
      state: 'active'
    },
    update: {}
  })
}

export async function getTraderDataLifecycleSummary(
  db: DbClient,
  traderId: string,
  now = new Date(),
  input?: {
    entitlement?: TraderSubscriptionEntitlement | null
    traderDeletedAt?: Date | null
  }
): Promise<TraderDataLifecycleSummary | null> {
  if (traderRetentionSchemaAvailability === false) {
    return null
  }

  let lifecycle:
    | Awaited<ReturnType<DbClient['traderDataLifecycle']['findUnique']>>
    | null = null
  let latestBackupRow:
    | Awaited<ReturnType<DbClient['traderDataBackup']['findFirst']>>
    | null = null
  let latestReadyBackupRow:
    | Awaited<ReturnType<DbClient['traderDataBackup']['findFirst']>>
    | null = null
  let traderRow:
    | {
        deletedAt: Date | null
      }
    | null = null

  try {
    ;[lifecycle, latestBackupRow, latestReadyBackupRow, traderRow] = await Promise.all([
      db.traderDataLifecycle.findUnique({
        where: {
          traderId
        }
      }),
      db.traderDataBackup.findFirst({
        where: {
          traderId
        },
        orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }]
      }),
      db.traderDataBackup.findFirst({
        where: {
          traderId,
          status: 'ready'
        },
        orderBy: [{ exportedAt: 'desc' }, { createdAt: 'desc' }]
      }),
      input?.traderDeletedAt !== undefined
        ? Promise.resolve({ deletedAt: input.traderDeletedAt })
        : db.trader.findFirst({
            where: {
              id: traderId
            },
            select: {
              deletedAt: true
            }
          })
    ])
    markTraderRetentionSchemaAvailability(true)
  } catch (error) {
    if (isTraderRetentionSchemaMismatchError(error)) {
      markTraderRetentionSchemaAvailability(false)
      return null
    }

    throw error
  }

  const entitlement =
    input && Object.prototype.hasOwnProperty.call(input, 'entitlement')
      ? input.entitlement ?? null
      : await getTraderSubscriptionEntitlement(db, traderId, now)

  if (!entitlement && !lifecycle && !traderRow) {
    return null
  }

  const configuredState = lifecycle ? normalizeTraderDataLifecycleState(lifecycle.state) : null
  const latestBackup = toBackupSummary(latestBackupRow)
  const latestReadyBackup = toBackupSummary(latestReadyBackupRow)
  const effectiveState = resolveEffectiveTraderDataLifecycleState({
    configuredState,
    traderDeleted: Boolean(traderRow?.deletedAt),
    subscriptionLifecycleState: entitlement?.lifecycleState || null
  })
  const readOnlyMode = isReadOnlyState(effectiveState)
  const closureRequestedAt = normalizeDate(lifecycle?.closureRequestedAt)

  return {
    traderId,
    state: effectiveState,
    configuredState,
    subscriptionLifecycleState: entitlement?.lifecycleState || null,
    readOnlyMode,
    allowReadOperations: effectiveState !== 'deleted',
    allowWriteOperations: !readOnlyMode && effectiveState !== 'deleted',
    allowBackupRequest: effectiveState !== 'deleted',
    allowBackupDownload: Boolean(latestReadyBackup),
    allowClosureRequest: effectiveState !== 'deleted' && effectiveState !== 'deletion_pending',
    message: buildStateMessage({
      state: effectiveState,
      subscriptionMessage: entitlement?.message || null,
      latestReadyBackup,
      closureRequestedAt
    }),
    readOnlySince: normalizeDate(lifecycle?.readOnlySince),
    latestBackup,
    latestReadyBackup,
    closureRequestedAt,
    closureRequestedByUserId: lifecycle?.closureRequestedByUserId || null,
    closureRequestSource: lifecycle?.closureRequestSource || null,
    closureNotes: lifecycle?.closureNotes || null,
    retentionDays: normalizePositiveInteger(lifecycle?.retentionDays),
    scheduledDeletionAt: normalizeDate(lifecycle?.scheduledDeletionAt),
    deletionPendingAt: normalizeDate(lifecycle?.deletionPendingAt),
    deletionMarkedByUserId: lifecycle?.deletionMarkedByUserId || null,
    deletionApprovedAt: normalizeDate(lifecycle?.deletionApprovedAt),
    deletionApprovedByUserId: lifecycle?.deletionApprovedByUserId || null,
    deletionExecutedAt: normalizeDate(lifecycle?.deletionExecutedAt),
    deletionExecutedByUserId: lifecycle?.deletionExecutedByUserId || null,
    notes: lifecycle?.notes || null
  }
}

export function getTraderDataAccessMessage(summary: TraderDataLifecycleSummary, fallback?: string | null) {
  return summary.message || fallback || 'Trader data access is restricted.'
}
