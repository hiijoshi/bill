import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  ensureCompanyAccess,
  filterCompanyIdsByRoutePermission,
  getScopedCompanyIds,
  normalizeOptionalString,
  parseBooleanParam,
  requireRoles
} from '@/lib/api-security'
import { roundCurrency } from '@/lib/billing-calculations'
import {
  getNextJournalVoucherNumber,
  JOURNAL_LEDGER_TYPE_OPTIONS,
  JOURNAL_VOUCHER_BILL_TYPE,
  normalizeJournalLedgerType,
  type JournalLedgerType
} from '@/lib/journal-vouchers'
import { ensureMandiSchema } from '@/lib/mandi-schema'
import { prisma } from '@/lib/prisma'
import {
  assertFinancialYearOpenForDate,
  FinancialYearValidationError,
  getFinancialYearDateFilter
} from '@/lib/financial-years'

const journalVoucherLineSchema = z.object({
  ledgerType: z.enum(JOURNAL_LEDGER_TYPE_OPTIONS.map((option) => option.value) as [JournalLedgerType, ...JournalLedgerType[]]),
  ledgerId: z.string().trim().optional().nullable(),
  debitAmount: z.coerce.number().nonnegative(),
  creditAmount: z.coerce.number().nonnegative(),
  remark: z.string().trim().max(400).optional().nullable()
})

const journalVoucherSchema = z.object({
  companyId: z.string().trim().min(1, 'Company ID is required'),
  voucherNo: z.string().trim().min(1, 'JV number is required'),
  voucherDate: z.string().trim().min(1, 'Voucher date is required'),
  referenceNo: z.string().trim().max(120).optional().nullable(),
  remark: z.string().trim().max(400).optional().nullable(),
  lines: z.array(journalVoucherLineSchema).min(2, 'At least two ledger rows are required')
})

type LedgerOptionRecord = {
  id: string
  name: string
  group?: string | null
}

function normalizeCompanyId(raw: string | null): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value || value === 'null' || value === 'undefined') return null
  return value
}

function parseVoucherDate(value: string): Date | null {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return null
  return parsed
}

function composeLineNote(headerRemark: string | null, lineRemark: string | null): string | null {
  const parts = [headerRemark, lineRemark].map((value) => String(value || '').trim()).filter(Boolean)
  return parts.length > 0 ? parts.join(' | ') : null
}

function normalizeMoney(value: number): number {
  return roundCurrency(Math.max(0, Number(value || 0)))
}

function findDuplicateVoucherNumbers(voucherNumbers: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const voucherNumber of voucherNumbers) {
    const normalized = String(voucherNumber || '').trim().toUpperCase()
    if (!normalized) continue
    if (seen.has(normalized)) {
      duplicates.add(normalized)
      continue
    }
    seen.add(normalized)
  }

  return [...duplicates]
}

async function getLedgerRecordMaps(companyId: string, lines: z.infer<typeof journalVoucherLineSchema>[]) {
  const accountHeadIds = [...new Set(lines
    .filter((line) => normalizeJournalLedgerType(line.ledgerType) === 'ACCOUNT_HEAD')
    .map((line) => String(line.ledgerId || '').trim())
    .filter(Boolean))]
  const partyIds = [...new Set(lines
    .filter((line) => normalizeJournalLedgerType(line.ledgerType) === 'PARTY')
    .map((line) => String(line.ledgerId || '').trim())
    .filter(Boolean))]
  const farmerIds = [...new Set(lines
    .filter((line) => normalizeJournalLedgerType(line.ledgerType) === 'FARMER')
    .map((line) => String(line.ledgerId || '').trim())
    .filter(Boolean))]
  const bankIds = [...new Set(lines
    .filter((line) => normalizeJournalLedgerType(line.ledgerType) === 'BANK')
    .map((line) => String(line.ledgerId || '').trim())
    .filter(Boolean))]

  const [accountHeads, parties, farmers, banks] = await Promise.all([
    accountHeadIds.length > 0
      ? prisma.accountingHead.findMany({
          where: { companyId, id: { in: accountHeadIds } },
          select: {
            id: true,
            name: true,
            mandiConfig: {
              select: {
                accountGroup: true
              }
            }
          }
        })
      : Promise.resolve([]),
    partyIds.length > 0
      ? prisma.party.findMany({
          where: { companyId, id: { in: partyIds } },
          select: { id: true, name: true }
        })
      : Promise.resolve([]),
    farmerIds.length > 0
      ? prisma.farmer.findMany({
          where: { companyId, id: { in: farmerIds } },
          select: { id: true, name: true }
        })
      : Promise.resolve([]),
    bankIds.length > 0
      ? prisma.bank.findMany({
          where: { companyId, id: { in: bankIds } },
          select: { id: true, name: true, branch: true }
        })
      : Promise.resolve([])
  ])

  return {
    accountHeadMap: new Map(accountHeads.map((row) => [row.id, { id: row.id, name: row.name, group: row.mandiConfig?.accountGroup || null }] as const)),
    partyMap: new Map(parties.map((row) => [row.id, { id: row.id, name: row.name }] as const)),
    farmerMap: new Map(farmers.map((row) => [row.id, { id: row.id, name: row.name }] as const)),
    bankMap: new Map(banks.map((row) => [row.id, { id: row.id, name: row.branch ? `${row.name} (${row.branch})` : row.name }] as const))
  }
}

function resolveLedgerSelection(args: {
  line: z.infer<typeof journalVoucherLineSchema>
  accountHeadMap: Map<string, LedgerOptionRecord>
  partyMap: Map<string, LedgerOptionRecord>
  farmerMap: Map<string, LedgerOptionRecord>
  bankMap: Map<string, LedgerOptionRecord>
}):
  | {
      ledgerType: JournalLedgerType
      ledgerId: string | null
      ledgerLabel: string
      accountGroup: string
      accountingHeadId: string | null
      partyId: string | null
      farmerId: string | null
    }
  | null {
  const ledgerType = normalizeJournalLedgerType(args.line.ledgerType)
  const ledgerId = String(args.line.ledgerId || '').trim() || null

  if (ledgerType === 'CASH') {
    return {
      ledgerType,
      ledgerId: null,
      ledgerLabel: 'Cash',
      accountGroup: 'CASH',
      accountingHeadId: null,
      partyId: null,
      farmerId: null
    }
  }

  if (!ledgerId) return null

  if (ledgerType === 'ACCOUNT_HEAD') {
    const head = args.accountHeadMap.get(ledgerId)
    if (!head) return null
    return {
      ledgerType,
      ledgerId,
      ledgerLabel: head.name,
      accountGroup: String(head.group || 'ACCOUNT_HEAD'),
      accountingHeadId: ledgerId,
      partyId: null,
      farmerId: null
    }
  }

  if (ledgerType === 'PARTY') {
    const party = args.partyMap.get(ledgerId)
    if (!party) return null
    return {
      ledgerType,
      ledgerId,
      ledgerLabel: party.name,
      accountGroup: 'PARTY',
      accountingHeadId: null,
      partyId: ledgerId,
      farmerId: null
    }
  }

  if (ledgerType === 'FARMER') {
    const farmer = args.farmerMap.get(ledgerId)
    if (!farmer) return null
    return {
      ledgerType,
      ledgerId,
      ledgerLabel: farmer.name,
      accountGroup: 'FARMER',
      accountingHeadId: null,
      partyId: null,
      farmerId: ledgerId
    }
  }

  const bank = args.bankMap.get(ledgerId)
  if (!bank) return null
  return {
    ledgerType,
    ledgerId,
    ledgerLabel: bank.name,
    accountGroup: 'BANK',
    accountingHeadId: null,
    partyId: null,
    farmerId: null
  }
}

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    await ensureMandiSchema(prisma)

    const searchParams = new URL(request.url).searchParams
    const companyId = normalizeCompanyId(searchParams.get('companyId'))
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const scopedCompanyIds = await getScopedCompanyIds(authResult.auth, companyId)
    const permissionScopedIds = await filterCompanyIdsByRoutePermission(
      authResult.auth,
      scopedCompanyIds,
      request.nextUrl.pathname,
      request.method
    )
    if (!permissionScopedIds.includes(companyId)) {
      return NextResponse.json({ error: 'Company access denied' }, { status: 403 })
    }

    const financialYearFilter = await getFinancialYearDateFilter({
      request,
      auth: authResult.auth,
      companyId
    })

    const summaryOnly = parseBooleanParam(searchParams.get('summary'), false)
    const allEntries = await prisma.ledgerEntry.findMany({
      where: {
        companyId,
        billType: JOURNAL_VOUCHER_BILL_TYPE
      },
      select: {
        billId: true,
        entryDate: true,
        createdAt: true,
        counterpartyNameSnapshot: true,
        note: true
      },
      orderBy: [{ createdAt: 'desc' }]
    })

    const voucherNumbers = [...new Set(allEntries.map((entry) => String(entry.billId || '').trim()).filter(Boolean))]
    const nextVoucherNo = getNextJournalVoucherNumber(voucherNumbers)

    if (summaryOnly) {
      return NextResponse.json({ nextVoucherNo })
    }

    const entries = allEntries.filter((entry) => {
      if (financialYearFilter.dateFrom && entry.entryDate < financialYearFilter.dateFrom) return false
      if (financialYearFilter.dateTo && entry.entryDate > financialYearFilter.dateTo) return false
      return true
    })

    const vouchers = voucherNumbers.map((voucherNo) => {
      const matchingEntries = entries.filter((entry) => entry.billId === voucherNo)
      if (matchingEntries.length === 0) {
        return null
      }
      return {
        voucherNo,
        voucherDate: matchingEntries[0]?.entryDate || null,
        referenceNo: normalizeOptionalString(matchingEntries[0]?.counterpartyNameSnapshot),
        entryCount: matchingEntries.length,
        createdAt: matchingEntries[0]?.createdAt || null
      }
    }).filter(Boolean)

    return NextResponse.json({
      nextVoucherNo,
      data: vouchers
    })
  } catch (error) {
    if (error instanceof FinancialYearValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    await ensureMandiSchema(prisma)

    const body = await request.json().catch(() => null)
    const parsed = journalVoucherSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const data = parsed.data
    const denied = await ensureCompanyAccess(request, data.companyId)
    if (denied) return denied

    const scopedCompanyIds = await getScopedCompanyIds(authResult.auth, data.companyId)
    const permissionScopedIds = await filterCompanyIdsByRoutePermission(
      authResult.auth,
      scopedCompanyIds,
      request.nextUrl.pathname,
      request.method
    )
    if (!permissionScopedIds.includes(data.companyId)) {
      return NextResponse.json({ error: 'Company access denied' }, { status: 403 })
    }

    const voucherDate = parseVoucherDate(data.voucherDate)
    if (!voucherDate) {
      return NextResponse.json({ error: 'Invalid voucher date' }, { status: 400 })
    }

    await assertFinancialYearOpenForDate({
      auth: authResult.auth,
      companyId: data.companyId,
      date: voucherDate,
      actionLabel: 'Journal voucher'
    })

    const voucherNo = String(data.voucherNo || '').trim().toUpperCase()
    const referenceNo = normalizeOptionalString(data.referenceNo)
    const headerRemark = normalizeOptionalString(data.remark)

    const duplicateVoucherNumbers = findDuplicateVoucherNumbers([voucherNo])
    if (duplicateVoucherNumbers.length > 0) {
      return NextResponse.json({ error: 'Duplicate JV number found in request' }, { status: 400 })
    }

    const normalizedLines = data.lines.map((line, index) => ({
      index,
      ledgerType: normalizeJournalLedgerType(line.ledgerType),
      ledgerId: String(line.ledgerId || '').trim() || null,
      debitAmount: normalizeMoney(line.debitAmount),
      creditAmount: normalizeMoney(line.creditAmount),
      remark: normalizeOptionalString(line.remark)
    }))

    for (const line of normalizedLines) {
      const hasDebit = line.debitAmount > 0
      const hasCredit = line.creditAmount > 0
      if (!hasDebit && !hasCredit) {
        return NextResponse.json({ error: `Line ${line.index + 1} must have debit or credit amount` }, { status: 400 })
      }
      if (hasDebit && hasCredit) {
        return NextResponse.json({ error: `Line ${line.index + 1} cannot have both debit and credit amount` }, { status: 400 })
      }
    }

    const totalDebit = roundCurrency(normalizedLines.reduce((sum, line) => sum + line.debitAmount, 0))
    const totalCredit = roundCurrency(normalizedLines.reduce((sum, line) => sum + line.creditAmount, 0))
    if (totalDebit <= 0 || totalCredit <= 0) {
      return NextResponse.json({ error: 'Journal voucher must contain both debit and credit totals' }, { status: 400 })
    }
    if (Math.abs(totalDebit - totalCredit) > 0.009) {
      return NextResponse.json({ error: 'Total debit and total credit must match' }, { status: 400 })
    }

    const existingVoucher = await prisma.ledgerEntry.findFirst({
      where: {
        companyId: data.companyId,
        billType: JOURNAL_VOUCHER_BILL_TYPE,
        billId: voucherNo
      },
      select: { id: true }
    })
    if (existingVoucher) {
      return NextResponse.json({ error: 'JV number already exists' }, { status: 400 })
    }

    const { accountHeadMap, partyMap, farmerMap, bankMap } = await getLedgerRecordMaps(data.companyId, data.lines)

    const resolvedLines = normalizedLines.map((line) =>
      resolveLedgerSelection({
        line,
        accountHeadMap,
        partyMap,
        farmerMap,
        bankMap
      })
    )

    if (resolvedLines.some((line) => !line)) {
      return NextResponse.json({ error: 'One or more selected ledger accounts are invalid for this company' }, { status: 400 })
    }

    const createdEntries = await prisma.$transaction(async (tx) => {
      const created = []

      for (let index = 0; index < normalizedLines.length; index += 1) {
        const line = normalizedLines[index]
        const resolvedLine = resolvedLines[index]
        if (!resolvedLine) continue

        const direction = line.debitAmount > 0 ? 'debit' : 'credit'
        const amount = line.debitAmount > 0 ? line.debitAmount : line.creditAmount

        const entry = await tx.ledgerEntry.create({
          data: {
            companyId: data.companyId,
            entryDate: voucherDate,
            billType: JOURNAL_VOUCHER_BILL_TYPE,
            billId: voucherNo,
            direction,
            amount,
            partyId: resolvedLine.partyId,
            farmerId: resolvedLine.farmerId,
            accountingHeadId: resolvedLine.accountingHeadId,
            accountHeadNameSnapshot: resolvedLine.ledgerLabel,
            accountGroupSnapshot: resolvedLine.accountGroup,
            counterpartyNameSnapshot: referenceNo,
            note: composeLineNote(headerRemark, line.remark)
          }
        })

        created.push(entry)
      }

      return created
    })

    return NextResponse.json(
      {
        success: true,
        message: 'Journal voucher saved successfully',
        voucherNo,
        nextVoucherNo: getNextJournalVoucherNumber([voucherNo]),
        totalDebit,
        totalCredit,
        entriesCreated: createdEntries.length
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof FinancialYearValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
