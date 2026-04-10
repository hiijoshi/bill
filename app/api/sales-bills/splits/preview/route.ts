import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { previewSalesBillSplit } from '@/lib/sales-split-service'
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

const splitPreviewSchema = z.object({
  companyId: z.string().trim().min(1, 'Company ID is required'),
  parentBillId: z.string().trim().min(1, 'Parent bill ID is required'),
  splitMethod: z.string().trim().min(1, 'Split method is required'),
  reason: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  chargeAllocationMode: z.string().trim().optional().nullable(),
  expectedParentUpdatedAt: z.string().trim().optional().nullable(),
  parts: z.array(splitPartSchema).min(2, 'At least 2 split parts are required'),
})

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, splitPreviewSchema)
    if (!parsed.ok) return parsed.response

    const denied = await ensureCompanyAccess(request, parsed.data.companyId)
    if (denied) return denied

    const result = await previewSalesBillSplit(prisma, {
      ...parsed.data,
      commit: false,
    } as SalesSplitRequestInput)

    return NextResponse.json({
      workspace: result.workspace,
      preview: result.preview,
      valid: result.preview.issues.length === 0,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to preview invoice split' },
      { status: 400 }
    )
  }
}
