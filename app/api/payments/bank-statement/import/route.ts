import { NextRequest, NextResponse } from 'next/server'

import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import type {
  StatementPreviewRow,
  StatementSummary,
  StatementTargetSelection,
  StatementTargetType
} from '@/lib/bank-statement-types'
import { ensureCompanyAccess, requireRoles } from '@/lib/api-security'
import {
  buildCashBankPaymentReference,
  CASH_BANK_PAYMENT_TYPE,
  CASH_BANK_RECEIPT_TYPE,
  getPaymentTypeLabel,
  isIncomingCashflowPaymentType,
  isOutgoingCashflowPaymentType,
  isSelfTransferPaymentType
} from '@/lib/payment-entry-types'
import { prisma } from '@/lib/prisma'
import {
  inferStatementPaymentMode,
  parseBankStatementFile,
  type ParsedStatementEntry
} from '@/lib/server-bank-statement'

export const runtime = 'nodejs'

type RouteAction = 'preview' | 'import'

type ExistingPaymentRecord = {
  id: string
  billType: string
  billId: string
  amount: number
  payDate: Date
  mode: string
  txnRef: string | null
  note: string | null
  bankNameSnapshot: string | null
  bankBranchSnapshot: string | null
  beneficiaryBankAccount: string | null
  ifscCode: string | null
  party: {
    name: string
  } | null
  farmer: {
    name: string
  } | null
}

type BankRecord = {
  id: string
  name: string
  branch: string | null
  accountNumber: string | null
  ifscCode: string | null
}

type TargetCandidate = {
  targetType: StatementTargetType
  targetId: string
  targetLabel: string
  matcherLabel: string
  description: string
  keywords: string[]
}

function normalizeText(value: unknown): string {
  return String(value || '').trim()
}

function normalizeForCompare(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/\s+/g, ' ')
}

function normalizeCompact(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function tokenize(value: unknown): string[] {
  return Array.from(
    new Set(
      normalizeForCompare(value)
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
    )
  )
}

function normalizeDateKey(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

function getDateDistanceInDays(left: string, right: Date | string): number {
  const leftDate = new Date(`${left}T00:00:00.000Z`)
  const rightKey = normalizeDateKey(right)
  const rightDate = new Date(`${rightKey}T00:00:00.000Z`)
  if (!Number.isFinite(leftDate.getTime()) || !Number.isFinite(rightDate.getTime())) return Number.POSITIVE_INFINITY
  return Math.abs(leftDate.getTime() - rightDate.getTime()) / 86_400_000
}

function isCashMode(value: unknown): boolean {
  const normalized = normalizeForCompare(value)
  return normalized === 'cash' || normalized === 'c' || normalized.includes('cash')
}

function buildTargetKey(targetType: StatementTargetType, targetId: string): string {
  return `${targetType}:${targetId}`
}

function createTargetSelection(candidate: TargetCandidate, reason?: string | null, confidence?: 'high' | 'medium' | 'low' | null): StatementTargetSelection {
  return {
    targetType: candidate.targetType,
    targetId: candidate.targetId,
    targetLabel: candidate.targetLabel,
    reason: reason || undefined,
    confidence: confidence || undefined
  }
}

function parseAction(value: unknown): RouteAction {
  return normalizeForCompare(value) === 'import' ? 'import' : 'preview'
}

function parseManualTargetMap(raw: FormDataEntryValue | null): Record<string, string> {
  if (typeof raw !== 'string' || !raw.trim()) return {}

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        const normalizedKey = normalizeText(key)
        const normalizedValue = typeof value === 'string' ? value.trim() : ''
        if (!normalizedKey || !normalizedValue) return []
        return [[normalizedKey, normalizedValue]]
      })
    )
  } catch {
    return {}
  }
}

function resolveSelectedTarget(
  encodedValue: string | undefined,
  candidateMap: Map<string, TargetCandidate>
): StatementTargetSelection | null {
  const normalized = normalizeText(encodedValue)
  if (!normalized || normalized === '__none__') return null

  const separatorIndex = normalized.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex >= normalized.length - 1) return null

  const targetType = normalized.slice(0, separatorIndex) as StatementTargetType
  const targetId = normalized.slice(separatorIndex + 1)
  const candidate = candidateMap.get(buildTargetKey(targetType, targetId))
  if (!candidate) return null

  return createTargetSelection(candidate)
}

function buildTargetCandidates(rows: {
  accountingHeads: Array<{ id: string; name: string; category: string | null }>
  parties: Array<{
    id: string
    name: string
    type: string | null
    address: string | null
    phone1: string | null
    bankName: string | null
    accountNo: string | null
    ifscCode: string | null
  }>
  suppliers: Array<{
    id: string
    name: string
    address: string | null
    phone1: string | null
    gstNumber: string | null
    bankName: string | null
    accountNo: string | null
    ifscCode: string | null
  }>
}): TargetCandidate[] {
  const accountingHeadCandidates = rows.accountingHeads.map((row) => ({
    targetType: 'accounting-head' as const,
    targetId: row.id,
    targetLabel: `Accounting Head • ${row.name}`,
    matcherLabel: row.name,
    description: row.category ? `Category: ${row.category}` : 'Accounting head',
    keywords: [row.name, row.category || '']
  }))

  const partyCandidates = rows.parties.map((row) => ({
    targetType: 'party' as const,
    targetId: row.id,
    targetLabel: `Party • ${row.name}`,
    matcherLabel: row.name,
    description: [row.type, row.address, row.phone1].filter(Boolean).join(' • ') || 'Party',
    keywords: [row.name, row.type || '', row.address || '', row.phone1 || '', row.bankName || '', row.accountNo || '', row.ifscCode || '']
  }))

  const supplierCandidates = rows.suppliers.map((row) => ({
    targetType: 'supplier' as const,
    targetId: row.id,
    targetLabel: `Supplier • ${row.name}`,
    matcherLabel: row.name,
    description: [row.address, row.phone1, row.gstNumber].filter(Boolean).join(' • ') || 'Supplier',
    keywords: [row.name, row.address || '', row.phone1 || '', row.gstNumber || '', row.bankName || '', row.accountNo || '', row.ifscCode || '']
  }))

  return [...accountingHeadCandidates, ...partyCandidates, ...supplierCandidates]
}

function suggestStatementTarget(
  entry: ParsedStatementEntry,
  candidates: TargetCandidate[]
): StatementTargetSelection | null {
  const haystack = normalizeForCompare(`${entry.description} ${entry.reference || ''}`)
  const compactHaystack = normalizeCompact(`${entry.description} ${entry.reference || ''}`)

  if (!haystack) return null

  let bestMatch: { candidate: TargetCandidate; score: number; reason: string } | null = null

  for (const candidate of candidates) {
    const matcherLabel = normalizeForCompare(candidate.matcherLabel)
    const compactLabel = normalizeCompact(candidate.matcherLabel)
    const tokens = Array.from(
      new Set(candidate.keywords.flatMap((keyword) => tokenize(keyword)))
    )

    let score = 0
    const reasons: string[] = []

    if (matcherLabel && haystack.includes(matcherLabel)) {
      score += 7
      reasons.push('name matched narration')
    } else if (compactLabel && compactHaystack.includes(compactLabel)) {
      score += 6
      reasons.push('name matched statement text')
    }

    const tokenHits = tokens.filter((token) => haystack.includes(token))
    if (tokenHits.length > 0) {
      score += Math.min(4, tokenHits.length)
      reasons.push(`keyword match: ${tokenHits.slice(0, 3).join(', ')}`)
    }

    if (candidate.targetType !== 'accounting-head' && tokenHits.length >= 2) {
      score += 1
    }

    if (score < 3) continue

    const reason = reasons.join('; ') || 'matched statement text'
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { candidate, score, reason }
    }
  }

  if (!bestMatch) return null

  const confidence = bestMatch.score >= 7 ? 'high' : bestMatch.score >= 5 ? 'medium' : 'low'
  return createTargetSelection(bestMatch.candidate, `Suggested because ${bestMatch.reason}.`, confidence)
}

function getBankComparisonValues(bank: BankRecord): string[] {
  return [
    normalizeForCompare(bank.name),
    normalizeForCompare(bank.branch),
    normalizeCompact(bank.accountNumber),
    normalizeForCompare(bank.ifscCode)
  ].filter(Boolean)
}

function getPaymentBankComparisonValues(payment: ExistingPaymentRecord): string[] {
  return [
    normalizeForCompare(payment.bankNameSnapshot),
    normalizeForCompare(payment.bankBranchSnapshot),
    normalizeCompact(payment.beneficiaryBankAccount),
    normalizeForCompare(payment.ifscCode)
  ].filter(Boolean)
}

function paymentDirectionMatches(entry: ParsedStatementEntry, payment: ExistingPaymentRecord): boolean {
  if (isSelfTransferPaymentType(payment.billType)) return true
  if (entry.direction === 'in') return isIncomingCashflowPaymentType(payment.billType)
  return isOutgoingCashflowPaymentType(payment.billType)
}

function matchExistingPayment(
  entry: ParsedStatementEntry,
  payments: ExistingPaymentRecord[],
  bank: BankRecord
): { payment: ExistingPaymentRecord; reason: string } | null {
  const bankValues = getBankComparisonValues(bank)

  for (const payment of payments) {
    if (Math.abs(Number(payment.amount || 0) - entry.amount) > 0.009) continue

    const noteHaystack = normalizeForCompare(payment.note)
    if (noteHaystack.includes(normalizeForCompare(entry.externalId))) {
      return { payment, reason: 'Already imported from the same bank statement row.' }
    }
  }

  let bestMatch: { payment: ExistingPaymentRecord; reason: string; score: number } | null = null
  const normalizedEntryReference = normalizeCompact(entry.reference)

  for (const payment of payments) {
    if (Math.abs(Number(payment.amount || 0) - entry.amount) > 0.009) continue
    if (isCashMode(payment.mode)) continue
    if (!paymentDirectionMatches(entry, payment)) continue

    const dateDistance = getDateDistanceInDays(entry.postedAt, payment.payDate)
    const normalizedPaymentReference = normalizeCompact(payment.txnRef)
    const paymentBankValues = getPaymentBankComparisonValues(payment)
    const bankMatches =
      paymentBankValues.length > 0 &&
      paymentBankValues.some((value) => bankValues.includes(value))

    if (normalizedEntryReference && normalizedPaymentReference && normalizedEntryReference === normalizedPaymentReference) {
      const score = dateDistance <= 2 ? 10 : 8
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          payment,
          reason: 'Matched by transaction reference and amount.',
          score
        }
      }
      continue
    }

    if (dateDistance <= 1 && bankMatches) {
      const score = isSelfTransferPaymentType(payment.billType) ? 8 : 7
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          payment,
          reason: 'Matched by date, amount, and selected bank.',
          score
        }
      }
      continue
    }

    if (dateDistance === 0 && paymentBankValues.length === 0) {
      const score = 4
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          payment,
          reason: 'Matched by same date and amount.',
          score
        }
      }
    }
  }

  return bestMatch ? { payment: bestMatch.payment, reason: bestMatch.reason } : null
}

function buildImportNote(entry: ParsedStatementEntry, fileName: string): string {
  const parts = [
    `Imported from statement ${normalizeText(fileName) || 'upload'}`,
    entry.externalId,
    normalizeText(entry.reference) ? `Ref ${normalizeText(entry.reference)}` : '',
    normalizeText(entry.description)
  ].filter(Boolean)

  return parts.join(' | ').slice(0, 400)
}

function summarizeRows(rows: StatementPreviewRow[]): StatementSummary {
  return {
    total: rows.length,
    settled: rows.filter((row) => row.status === 'settled').length,
    unsettled: rows.filter((row) => row.status === 'unsettled').length,
    imported: rows.filter((row) => row.status === 'imported').length,
    errors: rows.filter((row) => row.status === 'invalid').length
  }
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const formData = await request.formData()
    const companyId = normalizeText(formData.get('companyId'))
    const bankId = normalizeText(formData.get('bankId'))
    const action = parseAction(formData.get('action'))
    const manualTargets = parseManualTargetMap(formData.get('manualTargets'))
    const file = formData.get('file')

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    if (!bankId) {
      return NextResponse.json({ error: 'Bank is required' }, { status: 400 })
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Upload a bank statement file first' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const bank = await prisma.bank.findFirst({
      where: {
        id: bankId,
        companyId
      },
      select: {
        id: true,
        name: true,
        branch: true,
        accountNumber: true,
        ifscCode: true
      }
    })

    if (!bank) {
      return NextResponse.json({ error: 'Selected bank not found' }, { status: 404 })
    }

    const parsedStatement = await parseBankStatementFile(file, bank.id)
    const [existingPayments, accountingHeads, parties, suppliers] = await Promise.all([
      prisma.payment.findMany({
        where: {
          companyId,
          deletedAt: null
        },
        select: {
          id: true,
          billType: true,
          billId: true,
          amount: true,
          payDate: true,
          mode: true,
          txnRef: true,
          note: true,
          bankNameSnapshot: true,
          bankBranchSnapshot: true,
          beneficiaryBankAccount: true,
          ifscCode: true,
          party: {
            select: {
              name: true
            }
          },
          farmer: {
            select: {
              name: true
            }
          }
        }
      }),
      prisma.accountingHead.findMany({
        where: {
          companyId
        },
        select: {
          id: true,
          name: true,
          category: true
        },
        orderBy: {
          name: 'asc'
        }
      }),
      prisma.party.findMany({
        where: {
          companyId
        },
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
        orderBy: {
          name: 'asc'
        }
      }),
      prisma.supplier.findMany({
        where: {
          companyId
        },
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
        orderBy: {
          name: 'asc'
        }
      })
    ])

    const targetCandidates = buildTargetCandidates({
      accountingHeads,
      parties,
      suppliers
    })
    const targetCandidateMap = new Map(
      targetCandidates.map((candidate) => [buildTargetKey(candidate.targetType, candidate.targetId), candidate] as const)
    )

    const previewRows: StatementPreviewRow[] = parsedStatement.entries.map((parsed) => {
      if ('reason' in parsed) {
        return {
          rowNo: parsed.rowNo,
          postedAt: '',
          amount: 0,
          direction: 'out',
          description: '',
          reference: null,
          externalId: '',
          status: 'invalid',
          reason: parsed.reason
        }
      }

      const matchedPayment = matchExistingPayment(parsed, existingPayments, bank)
      if (matchedPayment) {
        const cashBankReferenceKey = normalizeText(matchedPayment.payment.billId).startsWith('cash-bank:')
          ? matchedPayment.payment.billId.replace(/^cash-bank:/, '').split(':')
          : null
        const matchedTargetLabel =
          matchedPayment.payment.party?.name ||
          matchedPayment.payment.farmer?.name ||
          (cashBankReferenceKey && cashBankReferenceKey.length >= 2
            ? targetCandidateMap.get(buildTargetKey(cashBankReferenceKey[0] as StatementTargetType, cashBankReferenceKey.slice(1).join(':')))?.targetLabel || ''
            : '') ||
          normalizeText(matchedPayment.payment.bankNameSnapshot) ||
          ''

        return {
          ...parsed,
          status: 'settled',
          matchedPaymentId: matchedPayment.payment.id,
          matchedTypeLabel: getPaymentTypeLabel(matchedPayment.payment.billType),
          matchedTargetLabel: matchedTargetLabel || undefined,
          reason: matchedPayment.reason
        }
      }

      const suggestedTarget = suggestStatementTarget(parsed, targetCandidates)
      const selectedTarget = resolveSelectedTarget(manualTargets[parsed.externalId], targetCandidateMap)

      return {
        ...parsed,
        status: 'unsettled',
        suggestedTarget,
        selectedTarget,
        reason:
          selectedTarget
            ? `Ready to import as ${selectedTarget.targetLabel}.`
            : suggestedTarget?.reason || 'No settlement matched in the system yet.'
      }
    })

    if (action !== 'import') {
      return NextResponse.json({
        success: true,
        bank,
        document: parsedStatement.document,
        summary: summarizeRows(previewRows),
        entries: previewRows
      })
    }

    const rowsToImport = previewRows.filter(
      (row): row is StatementPreviewRow & ParsedStatementEntry & { selectedTarget: StatementTargetSelection } =>
        row.status === 'unsettled' &&
        Boolean(row.selectedTarget) &&
        Boolean(row.externalId) &&
        Boolean(row.postedAt)
    )

    let imported = 0
    const importedIds = new Set<string>()

    if (rowsToImport.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const entry of rowsToImport) {
          const payDate = new Date(`${entry.postedAt}T00:00:00.000Z`)
          const paymentMode = inferStatementPaymentMode(entry)

          await tx.payment.create({
            data: {
              companyId,
              billType: entry.direction === 'out' ? CASH_BANK_PAYMENT_TYPE : CASH_BANK_RECEIPT_TYPE,
              billId: buildCashBankPaymentReference(entry.selectedTarget.targetType, entry.selectedTarget.targetId),
              billDate: payDate,
              payDate,
              amount: entry.amount,
              mode: paymentMode,
              cashAmount: null,
              cashPaymentDate: null,
              onlinePayAmount: entry.amount,
              onlinePaymentDate: payDate,
              ifscCode: bank.ifscCode || null,
              beneficiaryBankAccount: bank.accountNumber || null,
              bankNameSnapshot: bank.name,
              bankBranchSnapshot: bank.branch || null,
              txnRef: entry.reference,
              note: buildImportNote(entry, parsedStatement.document.fileName),
              partyId: entry.selectedTarget.targetType === 'party' ? entry.selectedTarget.targetId : null,
              status: 'paid'
            }
          })

          imported += 1
          importedIds.add(entry.externalId)
        }
      })

      await writeAuditLog({
        actor: {
          id: authResult.auth.userDbId || authResult.auth.userId,
          role: authResult.auth.role
        },
        action: 'CREATE',
        resourceType: 'PAYMENT_BATCH',
        resourceId: `bank-statement:${bank.id}:${Date.now()}`,
        scope: {
          traderId: authResult.auth.traderId,
          companyId
        },
        after: {
          bankId: bank.id,
          bankName: bank.name,
          documentKind: parsedStatement.document.kind,
          imported,
          totalRows: previewRows.length
        },
        requestMeta: getAuditRequestMeta(request),
        notes: 'Verified bank statement import'
      })
    }

    const responseRows = previewRows.map((row) => {
      if (row.status !== 'unsettled') return row
      if (!row.externalId || !importedIds.has(row.externalId)) return row
      return {
        ...row,
        status: 'imported' as const,
        reason: `Imported as ${row.selectedTarget?.targetLabel || 'settlement'}.`
      }
    })

    return NextResponse.json({
      success: true,
      bank,
      document: parsedStatement.document,
      summary: summarizeRows(responseRows),
      entries: responseRows
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
