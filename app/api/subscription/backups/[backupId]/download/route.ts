import { readFile } from 'node:fs/promises'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRoles } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import {
  getBackupStoragePath,
  touchTraderBackupDownload,
  TraderRetentionError
} from '@/lib/trader-backups'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  backupId: z.string().trim().min(1)
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ backupId: string }> }
) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = paramsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid backup ID' }, { status: 400 })
    }

    const backup = await prisma.traderDataBackup.findUnique({
      where: {
        id: parsedParams.data.backupId
      },
      select: {
        id: true,
        traderId: true,
        status: true,
        fileName: true,
        storagePath: true
      }
    })

    if (!backup || backup.status !== 'ready') {
      return NextResponse.json({ error: 'Backup not found' }, { status: 404 })
    }

    if (authResult.auth.role !== 'super_admin' && authResult.auth.traderId !== backup.traderId) {
      return NextResponse.json({ error: 'Backup access denied' }, { status: 403 })
    }

    const storagePath = getBackupStoragePath(backup.storagePath)
    const fileContent = await readFile(storagePath, 'utf8')
    await touchTraderBackupDownload(backup.id, backup.traderId)

    return new NextResponse(fileContent, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${backup.fileName || `${backup.id}.json`}"`,
        'Cache-Control': 'no-store'
      }
    })
  } catch (error) {
    if (error instanceof TraderRetentionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    console.error('subscription backup download failed:', error)
    return NextResponse.json({ error: 'Failed to download backup' }, { status: 500 })
  }
}
