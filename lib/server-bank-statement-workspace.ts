import 'server-only'

import { prisma } from '@/lib/prisma'

export type BankStatementWorkspaceBank = {
  id: string
  name: string
  branch: string | null
  accountNumber: string | null
  ifscCode: string | null
}

export type BankStatementWorkspaceTarget = {
  value: string
  label: string
  description?: string
  keywords?: string[]
}

export type BankStatementWorkspaceActivity = {
  id: string
  createdAt: string
  actorRole: string
  summary: string
  imported: number
  totalRows: number
  bankName: string
  documentKind: string
  fileName: string
}

export type BankStatementWorkspacePayload = {
  banks: BankStatementWorkspaceBank[]
  targets: BankStatementWorkspaceTarget[]
  recentActivity: BankStatementWorkspaceActivity[]
}

function normalizeText(value: unknown): string {
  return String(value || '').trim()
}

function safeParseObject<T extends Record<string, unknown>>(value: string | null): T | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as T | null
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export async function loadBankStatementWorkspace(companyId: string): Promise<BankStatementWorkspacePayload> {
  const [banks, accountingHeads, parties, suppliers, recentAuditRows] = await Promise.all([
    prisma.bank.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        branch: true,
        accountNumber: true,
        ifscCode: true
      },
      orderBy: [{ name: 'asc' }, { branch: 'asc' }]
    }),
    prisma.accountingHead.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        category: true
      },
      orderBy: { name: 'asc' }
    }),
    prisma.party.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        type: true,
        address: true,
        phone1: true,
        bankName: true,
        accountNo: true,
        ifscCode: true
      },
      orderBy: { name: 'asc' }
    }),
    prisma.supplier.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        address: true,
        phone1: true,
        gstNumber: true,
        bankName: true,
        accountNo: true,
        ifscCode: true
      },
      orderBy: { name: 'asc' }
    }),
    prisma.auditLog.findMany({
      where: {
        resourceType: 'PAYMENT_BATCH',
        scope: {
          contains: `"companyId":"${companyId}"`
        },
        notes: {
          contains: 'bank statement'
        }
      },
      select: {
        id: true,
        createdAt: true,
        actorRole: true,
        notes: true,
        after: true
      },
      orderBy: { createdAt: 'desc' },
      take: 8
    })
  ])

  const targets: BankStatementWorkspaceTarget[] = [
    ...accountingHeads.map((row) => ({
      value: `accounting-head:${row.id}`,
      label: `Accounting Head • ${normalizeText(row.name)}`,
      description: normalizeText(row.category) ? `Category: ${normalizeText(row.category)}` : 'Accounting head',
      keywords: [normalizeText(row.name), normalizeText(row.category)].filter(Boolean)
    })),
    ...parties.map((row) => ({
      value: `party:${row.id}`,
      label: `Party • ${normalizeText(row.name)}`,
      description: [normalizeText(row.type), normalizeText(row.address), normalizeText(row.phone1)].filter(Boolean).join(' • ') || 'Party',
      keywords: [
        normalizeText(row.name),
        normalizeText(row.type),
        normalizeText(row.address),
        normalizeText(row.phone1),
        normalizeText(row.bankName),
        normalizeText(row.accountNo),
        normalizeText(row.ifscCode)
      ].filter(Boolean)
    })),
    ...suppliers.map((row) => ({
      value: `supplier:${row.id}`,
      label: `Supplier • ${normalizeText(row.name)}`,
      description: [normalizeText(row.address), normalizeText(row.phone1), normalizeText(row.gstNumber)].filter(Boolean).join(' • ') || 'Supplier',
      keywords: [
        normalizeText(row.name),
        normalizeText(row.address),
        normalizeText(row.phone1),
        normalizeText(row.gstNumber),
        normalizeText(row.bankName),
        normalizeText(row.accountNo),
        normalizeText(row.ifscCode)
      ].filter(Boolean)
    }))
  ].sort((left, right) => left.label.localeCompare(right.label))

  const recentActivity = recentAuditRows.map((row) => {
    const after = safeParseObject<{
      imported?: unknown
      totalRows?: unknown
      bankName?: unknown
      documentKind?: unknown
      fileName?: unknown
    }>(row.after)

    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actorRole: normalizeText(row.actorRole) || 'user',
      summary: normalizeText(row.notes) || 'Bank statement import',
      imported: Number(after?.imported || 0),
      totalRows: Number(after?.totalRows || 0),
      bankName: normalizeText(after?.bankName) || 'Bank',
      documentKind: normalizeText(after?.documentKind) || 'statement',
      fileName: normalizeText(after?.fileName) || 'statement upload'
    }
  })

  return {
    banks: banks.map((bank) => ({
      id: bank.id,
      name: normalizeText(bank.name),
      branch: normalizeText(bank.branch) || null,
      accountNumber: normalizeText(bank.accountNumber) || null,
      ifscCode: normalizeText(bank.ifscCode).toUpperCase() || null
    })),
    targets,
    recentActivity
  }
}
