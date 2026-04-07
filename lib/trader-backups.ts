import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getTraderSubscriptionEntitlement } from '@/lib/subscription-core'
import {
  ensureTraderDataLifecycleRecord,
  getTraderDataLifecycleSummary,
  normalizeTraderDataLifecycleState,
  type TraderBackupSummary,
  type TraderDataLifecycleState
} from '@/lib/trader-retention'

type DbClient = typeof prisma | Prisma.TransactionClient

const BACKUP_DIRECTORY = path.join(process.cwd(), 'var', 'trader-backups')

export class TraderRetentionError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'TraderRetentionError'
    this.status = status
  }
}

type BackupActor = {
  userId: string
  role: string
  requestSource: string
}

type BackupCounts = Record<string, number>

function sanitizeSegment(value: string) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'trader'
}

function addDays(baseDate: Date, days: number) {
  return new Date(baseDate.getTime() + Math.max(0, Math.trunc(days)) * 86_400_000)
}

async function fileExists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function assertAbsoluteBackupPath(storagePath: string) {
  const normalized = path.resolve(storagePath)
  const root = path.resolve(BACKUP_DIRECTORY)
  if (!normalized.startsWith(`${root}${path.sep}`) && normalized !== root) {
    throw new TraderRetentionError('Backup file path is outside managed backup storage', 500)
  }
  return normalized
}

type TraderExportBundle = {
  payload: Record<string, unknown>
  counts: BackupCounts
  traderName: string
}

async function collectTraderExportBundle(db: DbClient, traderId: string, exportedAt: string): Promise<TraderExportBundle> {
  const trader = await db.trader.findFirst({
    where: {
      id: traderId
    }
  })

  if (!trader) {
    throw new TraderRetentionError('Trader not found', 404)
  }

  const [lifecycle, backups, companies, users, subscriptions, subscriptionPayments] = await Promise.all([
    db.traderDataLifecycle.findUnique({
      where: {
        traderId
      }
    }),
    db.traderDataBackup.findMany({
      where: {
        traderId
      },
      orderBy: [{ createdAt: 'desc' }]
    }),
    db.company.findMany({
      where: {
        traderId
      },
      orderBy: [{ createdAt: 'asc' }]
    }),
    db.user.findMany({
      where: {
        traderId
      },
      orderBy: [{ createdAt: 'asc' }]
    }),
    db.traderSubscription.findMany({
      where: {
        traderId
      },
      include: {
        features: true
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }]
    }),
    db.subscriptionPayment.findMany({
      where: {
        traderId
      },
      orderBy: [{ createdAt: 'asc' }]
    })
  ])

  const companyIds = companies.map((row) => row.id)
  const userIds = users.map((row) => row.id)
  const subscriptionIds = subscriptions.map((row) => row.id)
  const planIds = Array.from(new Set(subscriptions.map((row) => row.planId).filter((value): value is string => Boolean(value))))

  const [
    userPermissions,
    parties,
    farmers,
    suppliers,
    units,
    products,
    salesItemMasters,
    purchaseBills,
    specialPurchaseBills,
    salesBills,
    stockLedger,
    payments,
    transports,
    banks,
    accountingHeads,
    mandiTypes,
    markas,
    paymentModes,
    billCharges,
    ledgerEntries,
    subscriptionPlans
  ] = await Promise.all([
    userIds.length > 0
      ? db.userPermission.findMany({
          where: {
            userId: {
              in: userIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.party.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.farmer.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.supplier.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.unit.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.product.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.salesItemMaster.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.purchaseBill.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.specialPurchaseBill.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.salesBill.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.stockLedger.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.payment.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.transport.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.bank.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.accountingHead.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.mandiType.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.marka.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.paymentMode.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.billCharge.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? db.ledgerEntry.findMany({
          where: {
            companyId: {
              in: companyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    planIds.length > 0
      ? db.subscriptionPlan.findMany({
          where: {
            id: {
              in: planIds
            }
          },
          include: {
            features: {
              orderBy: [{ sortOrder: 'asc' }, { featureLabel: 'asc' }]
            }
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
        })
      : Promise.resolve([])
  ])

  const partyIds = parties.map((row) => row.id)
  const farmerIds = farmers.map((row) => row.id)
  const accountingHeadIds = accountingHeads.map((row) => row.id)
  const purchaseBillIds = purchaseBills.map((row) => row.id)
  const specialPurchaseBillIds = specialPurchaseBills.map((row) => row.id)
  const salesBillIds = salesBills.map((row) => row.id)

  const [
    partyMandiProfiles,
    farmerMandiProfiles,
    accountingHeadMandiConfigs,
    purchaseItems,
    specialPurchaseItems,
    salesItems,
    transportBills
  ] = await Promise.all([
    partyIds.length > 0
      ? db.partyMandiProfile.findMany({
          where: {
            partyId: {
              in: partyIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    farmerIds.length > 0
      ? db.farmerMandiProfile.findMany({
          where: {
            farmerId: {
              in: farmerIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    accountingHeadIds.length > 0
      ? db.accountingHeadMandiConfig.findMany({
          where: {
            accountingHeadId: {
              in: accountingHeadIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    purchaseBillIds.length > 0
      ? db.purchaseItem.findMany({
          where: {
            purchaseBillId: {
              in: purchaseBillIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    specialPurchaseBillIds.length > 0
      ? db.specialPurchaseItem.findMany({
          where: {
            specialPurchaseBillId: {
              in: specialPurchaseBillIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    salesBillIds.length > 0
      ? db.salesItem.findMany({
          where: {
            salesBillId: {
              in: salesBillIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([]),
    salesBillIds.length > 0
      ? db.transportBill.findMany({
          where: {
            salesBillId: {
              in: salesBillIds
            }
          },
          orderBy: [{ createdAt: 'asc' }]
        })
      : Promise.resolve([])
  ])

  const counts: BackupCounts = {
    companies: companies.length,
    users: users.length,
    userPermissions: userPermissions.length,
    parties: parties.length,
    farmers: farmers.length,
    suppliers: suppliers.length,
    units: units.length,
    products: products.length,
    salesItemMasters: salesItemMasters.length,
    purchaseBills: purchaseBills.length,
    purchaseItems: purchaseItems.length,
    specialPurchaseBills: specialPurchaseBills.length,
    specialPurchaseItems: specialPurchaseItems.length,
    salesBills: salesBills.length,
    salesItems: salesItems.length,
    stockLedger: stockLedger.length,
    payments: payments.length,
    transports: transports.length,
    banks: banks.length,
    accountingHeads: accountingHeads.length,
    mandiTypes: mandiTypes.length,
    partyMandiProfiles: partyMandiProfiles.length,
    farmerMandiProfiles: farmerMandiProfiles.length,
    accountingHeadMandiConfigs: accountingHeadMandiConfigs.length,
    markas: markas.length,
    paymentModes: paymentModes.length,
    billCharges: billCharges.length,
    ledgerEntries: ledgerEntries.length,
    transportBills: transportBills.length,
    subscriptions: subscriptions.length,
    subscriptionPayments: subscriptionPayments.length,
    traderBackups: backups.length,
    subscriptionPlans: subscriptionPlans.length
  }

  return {
    traderName: trader.name,
    counts,
    payload: {
      meta: {
        traderId,
        traderName: trader.name,
        exportedAt,
        source: 'mandi-billing-erp',
        format: 'json',
        counts
      },
      data: {
        trader,
        traderDataLifecycle: lifecycle,
        traderDataBackups: backups,
        companies,
        users,
        userPermissions,
        parties,
        partyMandiProfiles,
        farmers,
        farmerMandiProfiles,
        suppliers,
        units,
        products,
        salesItemMasters,
        purchaseBills,
        purchaseItems,
        specialPurchaseBills,
        specialPurchaseItems,
        salesBills,
        salesItems,
        stockLedger,
        payments,
        transports,
        banks,
        accountingHeads,
        mandiTypes,
        accountingHeadMandiConfigs,
        markas,
        paymentModes,
        billCharges,
        ledgerEntries,
        transportBills,
        traderSubscriptions: subscriptions,
        subscriptionPayments,
        subscriptionPlans
      }
    }
  }
}

function getNextLifecycleStateAfterBackup(currentState: TraderDataLifecycleState) {
  if (currentState === 'deletion_pending' || currentState === 'deleted') {
    return currentState
  }

  if (currentState === 'expired' || currentState === 'cancelled' || currentState === 'backup_ready') {
    return 'backup_ready' as const
  }

  return 'active' as const
}

export async function setTraderLifecycleReadOnlyState(
  db: DbClient,
  params: {
    traderId: string
    actorId: string
    state: 'expired' | 'cancelled'
    notes?: string | null
    retentionDays?: number | null
    now?: Date
  }
) {
  const now = params.now || new Date()
  await ensureTraderDataLifecycleRecord(db, params.traderId)

  return db.traderDataLifecycle.update({
    where: {
      traderId: params.traderId
    },
    data: {
      state: params.state,
      readOnlySince: now,
      retentionDays:
        typeof params.retentionDays === 'number' && Number.isFinite(params.retentionDays)
          ? Math.max(0, Math.trunc(params.retentionDays))
          : undefined,
      scheduledDeletionAt:
        typeof params.retentionDays === 'number' && Number.isFinite(params.retentionDays)
          ? addDays(now, Math.max(0, Math.trunc(params.retentionDays)))
          : undefined,
      deletionPendingAt: null,
      deletionMarkedByUserId: null,
      deletionApprovedAt: null,
      deletionApprovedByUserId: null,
      deletionExecutedAt: null,
      deletionExecutedByUserId: null,
      notes: params.notes === undefined ? undefined : params.notes || null
    }
  })
}

export async function restoreTraderActiveAccess(
  db: DbClient,
  params: {
    traderId: string
    notes?: string | null
  }
) {
  await ensureTraderDataLifecycleRecord(db, params.traderId)

  return db.traderDataLifecycle.update({
    where: {
      traderId: params.traderId
    },
    data: {
      state: 'active',
      readOnlySince: null,
      scheduledDeletionAt: null,
      deletionPendingAt: null,
      deletionMarkedByUserId: null,
      deletionApprovedAt: null,
      deletionApprovedByUserId: null,
      deletionExecutedAt: null,
      deletionExecutedByUserId: null,
      notes: params.notes === undefined ? undefined : params.notes || null
    }
  })
}

export async function requestTraderClosure(
  db: DbClient,
  params: {
    traderId: string
    actorId: string
    requestSource: string
    notes?: string | null
    now?: Date
  }
) {
  const now = params.now || new Date()
  await ensureTraderDataLifecycleRecord(db, params.traderId)

  return db.traderDataLifecycle.update({
    where: {
      traderId: params.traderId
    },
    data: {
      closureRequestedAt: now,
      closureRequestedByUserId: params.actorId,
      closureRequestSource: params.requestSource,
      closureNotes: params.notes || null
    }
  })
}

export async function updateTraderRetentionPolicy(
  db: DbClient,
  params: {
    traderId: string
    retentionDays: number | null
    notes?: string | null
    now?: Date
  }
) {
  const now = params.now || new Date()
  await ensureTraderDataLifecycleRecord(db, params.traderId)

  const retentionDays =
    typeof params.retentionDays === 'number' && Number.isFinite(params.retentionDays)
      ? Math.max(0, Math.trunc(params.retentionDays))
      : null

  return db.traderDataLifecycle.update({
    where: {
      traderId: params.traderId
    },
    data: {
      retentionDays,
      scheduledDeletionAt: retentionDays === null ? null : addDays(now, retentionDays),
      notes: params.notes === undefined ? undefined : params.notes || null
    }
  })
}

export async function createTraderDataBackup(params: {
  traderId: string
  actor: BackupActor
  notes?: string | null
}) {
  const trader = await prisma.trader.findFirst({
    where: {
      id: params.traderId
    },
    select: {
      id: true,
      name: true,
      deletedAt: true
    }
  })

  if (!trader) {
    throw new TraderRetentionError('Trader not found', 404)
  }

  if (trader.deletedAt) {
    throw new TraderRetentionError('Cannot create backup after final deletion', 409)
  }

  const now = new Date()
  const entitlement = await getTraderSubscriptionEntitlement(prisma, trader.id, now)
  const lifecycleSummary = await getTraderDataLifecycleSummary(prisma, trader.id, now, {
    entitlement,
    traderDeletedAt: trader.deletedAt
  })

  if (lifecycleSummary?.state === 'deleted') {
    throw new TraderRetentionError('Cannot create backup after final deletion', 409)
  }

  const backup = await prisma.$transaction(async (tx) => {
    await ensureTraderDataLifecycleRecord(tx, trader.id)

    const existingProcessing = await tx.traderDataBackup.findFirst({
      where: {
        traderId: trader.id,
        status: {
          in: ['pending', 'processing']
        }
      },
      select: {
        id: true
      }
    })

    if (existingProcessing) {
      throw new TraderRetentionError('A backup for this trader is already in progress', 409)
    }

    const created = await tx.traderDataBackup.create({
      data: {
        traderId: trader.id,
        requestedByUserId: params.actor.userId,
        requestedByRole: params.actor.role,
        requestSource: params.actor.requestSource,
        status: 'processing',
        format: 'json',
        notes: params.notes || null
      }
    })

    await tx.traderDataLifecycle.update({
      where: {
        traderId: trader.id
      },
      data: {
        backupRequestedAt: now,
        backupRequestedByUserId: params.actor.userId
      }
    })

    return created
  })

  try {
    const exportedAt = new Date().toISOString()
    const { payload, counts, traderName } = await collectTraderExportBundle(prisma, trader.id, exportedAt)
    const serialized = JSON.stringify(payload, null, 2)
    const checksum = createHash('sha256').update(serialized).digest('hex')
    const stamp = exportedAt.replace(/[:.]/g, '-')
    const safeName = sanitizeSegment(traderName)
    const fileName = `${safeName}-backup-${stamp}.json`
    const traderDir = path.join(BACKUP_DIRECTORY, trader.id)
    const storagePath = path.join(traderDir, `${backup.id}-${fileName}`)

    await mkdir(traderDir, { recursive: true })
    await writeFile(storagePath, serialized, 'utf8')

    const nextState = getNextLifecycleStateAfterBackup(lifecycleSummary?.state || 'active')
    const fileSizeBytes = Buffer.byteLength(serialized, 'utf8')

    await prisma.$transaction(async (tx) => {
      await tx.traderDataBackup.update({
        where: {
          id: backup.id
        },
        data: {
          status: 'ready',
          fileName,
          storagePath,
          fileSizeBytes,
          checksum,
          recordCountsJson: JSON.stringify(counts),
          exportedAt: new Date(exportedAt),
          failedAt: null,
          errorMessage: null
        }
      })

      const lifecycleUpdate: Prisma.TraderDataLifecycleUpdateInput = {
        latestReadyBackupId: backup.id,
        latestReadyBackupAt: new Date(exportedAt)
      }

      if (nextState !== 'active') {
        lifecycleUpdate.state = nextState
        lifecycleUpdate.readOnlySince = lifecycleSummary?.readOnlySince
          ? new Date(lifecycleSummary.readOnlySince)
          : new Date(exportedAt)
      }

      await tx.traderDataLifecycle.update({
        where: {
          traderId: trader.id
        },
        data: lifecycleUpdate
      })
    })
  } catch (error) {
    await prisma.traderDataBackup.update({
      where: {
        id: backup.id
      },
      data: {
        status: 'failed',
        failedAt: new Date(),
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Backup generation failed'
      }
    })

    if (error instanceof TraderRetentionError) {
      throw error
    }

    throw new TraderRetentionError(
      error instanceof Error ? error.message : 'Failed to generate trader backup',
      500
    )
  }

  const createdBackup = await prisma.traderDataBackup.findUnique({
    where: {
      id: backup.id
    }
  })

  if (!createdBackup) {
    throw new TraderRetentionError('Backup record not found after generation', 500)
  }

  return createdBackup
}

export async function markTraderDeletionPending(params: {
  traderId: string
  actorId: string
  backupId: string
  retentionDays?: number | null
  notes?: string | null
}) {
  const trader = await prisma.trader.findFirst({
    where: {
      id: params.traderId
    },
    select: {
      id: true,
      deletedAt: true
    }
  })

  if (!trader) {
    throw new TraderRetentionError('Trader not found', 404)
  }

  if (trader.deletedAt) {
    throw new TraderRetentionError('Trader is already deleted', 409)
  }

  const backup = await prisma.traderDataBackup.findFirst({
    where: {
      id: params.backupId,
      traderId: params.traderId,
      status: 'ready'
    }
  })

  if (!backup) {
    throw new TraderRetentionError('Ready backup not found for this trader', 404)
  }

  if (!backup.storagePath || !(await fileExists(assertAbsoluteBackupPath(backup.storagePath)))) {
    throw new TraderRetentionError('Backup file is not available for final deletion workflow', 409)
  }

  const now = new Date()
  const retentionDays =
    typeof params.retentionDays === 'number' && Number.isFinite(params.retentionDays)
      ? Math.max(0, Math.trunc(params.retentionDays))
      : null

  await prisma.$transaction(async (tx) => {
    await ensureTraderDataLifecycleRecord(tx, params.traderId)
    await tx.traderDataLifecycle.update({
      where: {
        traderId: params.traderId
      },
      data: {
        state: 'deletion_pending',
        readOnlySince: now,
        latestReadyBackupId: backup.id,
        latestReadyBackupAt: backup.exportedAt || backup.createdAt,
        retentionDays,
        scheduledDeletionAt: retentionDays === null ? null : addDays(now, retentionDays),
        deletionPendingAt: now,
        deletionMarkedByUserId: params.actorId,
        notes: params.notes === undefined ? undefined : params.notes || null
      }
    })
  })
}

export async function confirmTraderFinalDeletion(params: {
  traderId: string
  backupId: string
  actorId: string
  notes?: string | null
}) {
  const trader = await prisma.trader.findFirst({
    where: {
      id: params.traderId
    },
    select: {
      id: true,
      name: true,
      deletedAt: true
    }
  })

  if (!trader) {
    throw new TraderRetentionError('Trader not found', 404)
  }

  if (trader.id === 'system') {
    throw new TraderRetentionError('Cannot delete system trader', 403)
  }

  if (trader.deletedAt) {
    throw new TraderRetentionError('Trader data was already deleted', 409)
  }

  const backup = await prisma.traderDataBackup.findFirst({
    where: {
      id: params.backupId,
      traderId: params.traderId,
      status: 'ready'
    }
  })

  if (!backup) {
    throw new TraderRetentionError('Ready backup not found for this trader', 404)
  }

  if (!backup.storagePath || !(await fileExists(assertAbsoluteBackupPath(backup.storagePath)))) {
    throw new TraderRetentionError('Backup file must exist before final deletion', 409)
  }

  const lifecycleSummary = await getTraderDataLifecycleSummary(prisma, params.traderId, new Date(), {
    traderDeletedAt: trader.deletedAt
  })

  if (!lifecycleSummary || lifecycleSummary.state !== 'deletion_pending') {
    throw new TraderRetentionError('Trader must be marked for deletion before final delete', 409)
  }

  const [affectedUsers, affectedCompanyIds] = await Promise.all([
    prisma.user.findMany({
      where: {
        traderId: params.traderId
      },
      select: {
        id: true,
        traderId: true,
        userId: true
      }
    }),
    prisma.company.findMany({
      where: {
        traderId: params.traderId
      },
      select: {
        id: true
      }
    })
  ])

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await ensureTraderDataLifecycleRecord(tx, params.traderId)

    await tx.subscriptionPayment.deleteMany({
      where: {
        traderId: params.traderId
      }
    })

    await tx.traderSubscription.deleteMany({
      where: {
        traderId: params.traderId
      }
    })

    await tx.user.deleteMany({
      where: {
        traderId: params.traderId
      }
    })

    await tx.company.deleteMany({
      where: {
        traderId: params.traderId
      }
    })

    await tx.traderDataLifecycle.update({
      where: {
        traderId: params.traderId
      },
      data: {
        state: 'deleted',
        readOnlySince: lifecycleSummary.readOnlySince ? new Date(lifecycleSummary.readOnlySince) : now,
        latestReadyBackupId: backup.id,
        latestReadyBackupAt: backup.exportedAt || backup.createdAt,
        deletionApprovedAt: now,
        deletionApprovedByUserId: params.actorId,
        deletionExecutedAt: now,
        deletionExecutedByUserId: params.actorId,
        notes: params.notes === undefined ? undefined : params.notes || null
      }
    })

    await tx.trader.update({
      where: {
        id: params.traderId
      },
      data: {
        locked: true,
        deletedAt: now
      }
    })
  })

  return {
    deletedAt: now,
    affectedUsers,
    affectedCompanyIds: affectedCompanyIds.map((company) => company.id)
  }
}

export async function touchTraderBackupDownload(
  backupId: string,
  traderId: string
): Promise<TraderBackupSummary | null> {
  const backup = await prisma.traderDataBackup.findFirst({
    where: {
      id: backupId,
      traderId
    }
  })

  if (!backup) {
    return null
  }

  const updated = await prisma.traderDataBackup.update({
    where: {
      id: backup.id
    },
    data: {
      lastDownloadedAt: new Date(),
      downloadCount: {
        increment: 1
      }
    }
  })

  return {
    id: updated.id,
    traderId: updated.traderId,
    requestedByUserId: updated.requestedByUserId || null,
    requestedByRole: updated.requestedByRole || null,
    requestSource: updated.requestSource,
    status: 'ready',
    format: 'json',
    fileName: updated.fileName || null,
    fileSizeBytes: updated.fileSizeBytes ?? null,
    checksum: updated.checksum || null,
    exportedAt: updated.exportedAt?.toISOString() || null,
    lastDownloadedAt: updated.lastDownloadedAt?.toISOString() || null,
    downloadCount: updated.downloadCount,
    failedAt: updated.failedAt?.toISOString() || null,
    errorMessage: updated.errorMessage || null,
    notes: updated.notes || null,
    counts: null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString()
  }
}

export function getBackupStoragePath(storagePath: string | null | undefined) {
  if (!storagePath) {
    throw new TraderRetentionError('Backup file is not available', 404)
  }

  return assertAbsoluteBackupPath(storagePath)
}
