import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import {
  ensureCompanyAccess,
  normalizeId,
  parseJsonWithSchema,
  requireAuthContext,
} from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { mergeSalesBillSplit, loadSalesBillSplitWorkspace, saveSalesBillSplit } from '@/lib/sales-split-service'
import type { SalesSplitRequestInput } from '@/lib/sales-split'

const splitAllocationSchema = z.object({
  parentSalesItemId: z.string().trim().min(1, 'Parent sales item is required'),
  weight: z.coerce.number().nonnegative(),
  bags: z.coerce.number().int().nonnegative().optional().nullable(),
  amount: z.coerce.number().nonnegative().optional().nullable(),
})

const splitPartSchema = z.object({
  billId: z.string().trim().optional().nullable(),
  suffix: z.string().trim().optional().nullable(),
  partLabel: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  transportName: z.string().trim().optional().nullable(),
  lorryNo: z.string().trim().optional().nullable(),
  allocations: z.array(splitAllocationSchema).default([]),
})

const splitSaveSchema = z.object({
  companyId: z.string().trim().min(1, 'Company ID is required'),
  parentBillId: z.string().trim().min(1, 'Parent bill ID is required'),
  splitMethod: z.string().trim().min(1, 'Split method is required'),
  reason: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  chargeAllocationMode: z.string().trim().optional().nullable(),
  expectedParentUpdatedAt: z.string().trim().optional().nullable(),
  commit: z.boolean().optional(),
  parts: z.array(splitPartSchema).min(2, 'At least 2 split parts are required'),
})

export async function GET(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams
    const companyId = normalizeId(searchParams.get('companyId'))
    const billId = normalizeId(searchParams.get('billId') || searchParams.get('parentBillId'))

    if (!companyId || !billId) {
      return NextResponse.json({ error: 'Company ID and bill ID are required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const workspace = await loadSalesBillSplitWorkspace(prisma, companyId, billId)
    if (!workspace) {
      return NextResponse.json({ error: 'Sales invoice not found' }, { status: 404 })
    }

    return NextResponse.json({ workspace })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load invoice split workspace' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authResult = requireAuthContext(request)
  if (!authResult.ok) return authResult.response

  try {
    const parsed = await parseJsonWithSchema(request, splitSaveSchema)
    if (!parsed.ok) return parsed.response

    const denied = await ensureCompanyAccess(request, parsed.data.companyId)
    if (denied) return denied

    const result = await saveSalesBillSplit(prisma, parsed.data as SalesSplitRequestInput)

    await writeAuditLog({
      actor: {
        id: authResult.auth.userId,
        role: authResult.auth.role,
      },
      action: parsed.data.commit ? 'STATUS_CHANGE' : 'UPDATE',
      resourceType: 'SALES_BILL_SPLIT',
      resourceId: parsed.data.parentBillId,
      scope: {
        traderId: authResult.auth.traderId,
        companyId: parsed.data.companyId,
      },
      after: {
        mode: result.mode,
        splitMethod: parsed.data.splitMethod,
        partCount: parsed.data.parts.length,
        createdBillIds: result.createdBillIds,
      },
      notes: parsed.data.commit ? 'Invoice split finalized.' : 'Invoice split draft saved.',
      requestMeta: getAuditRequestMeta(request),
    })

    return NextResponse.json({
      success: true,
      mode: result.mode,
      workspace: result.workspace,
      createdBillIds: result.createdBillIds,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save invoice split' },
      { status: 400 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = requireAuthContext(request)
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const companyId = normalizeId(searchParams.get('companyId'))
    const parentBillId = normalizeId(searchParams.get('parentBillId') || searchParams.get('billId'))

    if (!companyId || !parentBillId) {
      return NextResponse.json({ error: 'Company ID and parent bill ID are required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const result = await mergeSalesBillSplit(prisma, companyId, parentBillId)

    await writeAuditLog({
      actor: {
        id: authResult.auth.userId,
        role: authResult.auth.role,
      },
      action: 'DELETE',
      resourceType: 'SALES_BILL_SPLIT',
      resourceId: parentBillId,
      scope: {
        traderId: authResult.auth.traderId,
        companyId,
      },
      after: {
        mode: result.mode,
      },
      notes: 'Merged split child invoices back into the parent invoice.',
      requestMeta: getAuditRequestMeta(request),
    })

    return NextResponse.json({
      success: true,
      mode: result.mode,
      workspace: result.workspace,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to merge invoice split' },
      { status: 400 }
    )
  }
}
