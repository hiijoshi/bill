import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess, requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { getCsvValue, parseCsvObjects } from '@/lib/master-csv'
import {
  CASH_BANK_PAYMENT_TYPE,
  CASH_BANK_RECEIPT_TYPE,
  getPaymentTypeLabel,
  isIncomingCashflowPaymentType,
  isOutgoingCashflowPaymentType,
  isSelfTransferPaymentType
} from '@/lib/payment-entry-types'

type StatementDirection = 'in' | 'out'
type StatementStatus = 'settled' | 'unsettled' | 'invalid' | 'imported'

type ParsedStatementEntry = {
  rowNo: number
  postedAt: string
  amount: number
  direction: StatementDirection
  description: string
  reference: string | null
  externalId: string
}

type StatementPreviewRow = ParsedStatementEntry & {
  status: StatementStatus
  matchedPaymentId?: string
  matchedTypeLabel?: string
  reason?: string
}

function normalizeText(value: unknown): string {
  return String(value || '').trim()
}

function normalizeForCompare(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/\s+/g, ' ')
}

function parseAmountValue(raw: string): number | null {
  const normalized = normalizeText(raw)
    .replace(/[,\s₹]/g, '')
    .replace(/cr$/i, '')
    .replace(/dr$/i, '')

  if (!normalized) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return Math.abs(parsed)
}

function parseStatementDate(raw: string): string | null {
  const normalized = normalizeText(raw)
  if (!normalized) return null

  if (/^\d{4}-\d{2}-\d{2}/.test(normalized)) {
    return normalized.slice(0, 10)
  }

  const slashParts = normalized.split(/[\/.-]/).map((part) => part.trim()).filter(Boolean)
  if (slashParts.length === 3 && slashParts.every((part) => /^\d+$/.test(part))) {
    let day = 0
    let month = 0
    let year = 0

    if (slashParts[0].length === 4) {
      year = Number(slashParts[0])
      month = Number(slashParts[1])
      day = Number(slashParts[2])
    } else {
      day = Number(slashParts[0])
      month = Number(slashParts[1])
      year = Number(slashParts[2])
      if (year < 100) {
        year += 2000
      }
    }

    const candidate = new Date(Date.UTC(year, month - 1, day))
    if (
      Number.isFinite(candidate.getTime()) &&
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === day
    ) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  const parsed = new Date(normalized)
  if (!Number.isFinite(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function buildExternalId(bankId: string, entry: Omit<ParsedStatementEntry, 'externalId'>): string {
  const hash = createHash('sha1')
    .update(
      [
        bankId,
        entry.postedAt,
        entry.amount.toFixed(2),
        entry.direction,
        normalizeForCompare(entry.reference),
        normalizeForCompare(entry.description)
      ].join('|')
    )
    .digest('hex')
    .slice(0, 24)

  return `bankstmt:${bankId}:${hash}`
}

function parseStatementRow(
  row: Record<string, string>,
  rowNo: number,
  bankId: string
): ParsedStatementEntry | { rowNo: number; reason: string } {
  const postedAt =
    parseStatementDate(
      getCsvValue(row, ['Date', 'Txn Date', 'Transaction Date', 'Posted Date', 'Value Date', 'Entry Date'])
    )

  if (!postedAt) {
    return { rowNo, reason: 'Invalid or missing transaction date' }
  }

  const debitAmount = parseAmountValue(
    getCsvValue(row, ['Debit', 'Withdrawal', 'Debit Amount', 'Dr Amount', 'Dr', 'Withdrawals'])
  )
  const creditAmount = parseAmountValue(
    getCsvValue(row, ['Credit', 'Deposit', 'Credit Amount', 'Cr Amount', 'Cr', 'Deposits'])
  )

  let amount: number | null = null
  let direction: StatementDirection | null = null

  if ((debitAmount || 0) > 0) {
    amount = debitAmount
    direction = 'out'
  } else if ((creditAmount || 0) > 0) {
    amount = creditAmount
    direction = 'in'
  } else {
    const signedAmount = Number(
      normalizeText(getCsvValue(row, ['Amount', 'Txn Amount', 'Transaction Amount'])).replace(/[,\s₹]/g, '')
    )
    const directionRaw = normalizeForCompare(getCsvValue(row, ['Direction', 'Type', 'Txn Type']))

    if (Number.isFinite(signedAmount) && signedAmount !== 0) {
      amount = Math.abs(signedAmount)
      if (directionRaw.includes('debit') || directionRaw.includes('withdraw') || directionRaw === 'dr' || signedAmount < 0) {
        direction = 'out'
      } else if (directionRaw.includes('credit') || directionRaw.includes('deposit') || directionRaw === 'cr' || signedAmount > 0) {
        direction = 'in'
      }
    }
  }

  if (!amount || !direction) {
    return { rowNo, reason: 'Could not determine debit / credit amount' }
  }

  const description = normalizeText(
    getCsvValue(row, ['Description', 'Narration', 'Particulars', 'Details', 'Remarks', 'Remark'])
  )
  const reference = normalizeText(
    getCsvValue(row, ['Reference', 'Txn Ref', 'Transaction Ref', 'UTR', 'Ref No', 'Cheque No', 'Chq No'])
  ) || null

  const entryBase = {
    rowNo,
    postedAt,
    amount,
    direction,
    description,
    reference
  }

  return {
    ...entryBase,
    externalId: buildExternalId(bankId, entryBase)
  }
}

function matchesStatementEntry(
  entry: ParsedStatementEntry,
  payment: {
    id: string
    billType: string
    amount: number
    payDate: Date
    mode: string
    txnRef: string | null
    bankNameSnapshot: string | null
    bankBranchSnapshot: string | null
  },
  bankName: string
): boolean {
  const paymentDate = payment.payDate.toISOString().slice(0, 10)
  if (paymentDate !== entry.postedAt) return false
  if (Math.abs(Number(payment.amount || 0) - entry.amount) > 0.009) return false
  if (normalizeForCompare(payment.mode) === 'cash') return false

  const normalizedReference = normalizeForCompare(entry.reference)
  const normalizedPaymentReference = normalizeForCompare(payment.txnRef)
  if (normalizedReference && normalizedPaymentReference) {
    return normalizedReference === normalizedPaymentReference
  }

  const normalizedBankName = normalizeForCompare(bankName)
  const paymentBankCandidates = [
    normalizeForCompare(payment.bankNameSnapshot),
    normalizeForCompare(payment.bankBranchSnapshot)
  ].filter(Boolean)

  if (isSelfTransferPaymentType(payment.billType)) {
    return paymentBankCandidates.includes(normalizedBankName)
  }

  if (entry.direction === 'in' && !isIncomingCashflowPaymentType(payment.billType)) {
    return false
  }

  if (entry.direction === 'out' && !isOutgoingCashflowPaymentType(payment.billType)) {
    return false
  }

  if (paymentBankCandidates.length === 0) {
    return false
  }

  return paymentBankCandidates.includes(normalizedBankName)
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const formData = await request.formData()
    const companyId = normalizeText(formData.get('companyId'))
    const bankId = normalizeText(formData.get('bankId'))
    const action = normalizeForCompare(formData.get('action')) || 'preview'
    const file = formData.get('file')

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }
    if (!bankId) {
      return NextResponse.json({ error: 'Bank is required' }, { status: 400 })
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'CSV bank statement file is required' }, { status: 400 })
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
        accountNumber: true
      }
    })

    if (!bank) {
      return NextResponse.json({ error: 'Selected bank not found' }, { status: 404 })
    }

    const rows = parseCsvObjects(await file.text())
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Uploaded CSV is empty' }, { status: 400 })
    }

    const existingPayments = await prisma.payment.findMany({
      where: {
        companyId,
        deletedAt: null
      },
      select: {
        id: true,
        billType: true,
        amount: true,
        payDate: true,
        mode: true,
        txnRef: true,
        bankNameSnapshot: true,
        bankBranchSnapshot: true
      }
    })

    const previewRows: StatementPreviewRow[] = rows.map((row, index) => {
      const rowNo = index + 2
      const parsed = parseStatementRow(row, rowNo, bank.id)
      if ('reason' in parsed) {
        return {
          rowNo,
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

      const matchedPayment = existingPayments.find((payment) => matchesStatementEntry(parsed, payment, bank.name))
      if (matchedPayment) {
        return {
          ...parsed,
          status: 'settled',
          matchedPaymentId: matchedPayment.id,
          matchedTypeLabel: getPaymentTypeLabel(matchedPayment.billType)
        }
      }

      return {
        ...parsed,
        status: 'unsettled'
      }
    })

    let imported = 0

    if (action === 'import') {
      const entriesToImport = previewRows.filter((entry) => entry.status === 'unsettled')
      if (entriesToImport.length > 0) {
        await prisma.$transaction(async (tx) => {
          for (const entry of entriesToImport) {
            const billType = entry.direction === 'out' ? CASH_BANK_PAYMENT_TYPE : CASH_BANK_RECEIPT_TYPE
            const payDate = new Date(`${entry.postedAt}T00:00:00`)
            const mode = entry.reference ? 'online' : 'bank'

            await tx.payment.create({
              data: {
                companyId,
                billType,
                billId: entry.externalId,
                billDate: payDate,
                payDate,
                amount: entry.amount,
                mode,
                cashAmount: null,
                cashPaymentDate: null,
                onlinePayAmount: entry.amount,
                onlinePaymentDate: payDate,
                bankNameSnapshot: bank.name,
                bankBranchSnapshot: bank.branch || null,
                beneficiaryBankAccount: bank.accountNumber || null,
                txnRef: entry.reference,
                note: entry.description || 'Imported from bank statement',
                status: 'paid'
              }
            })
          }
        })

        imported = entriesToImport.length
      }

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
          imported,
          totalRows: previewRows.length
        },
        requestMeta: getAuditRequestMeta(request),
        notes: 'Bank statement import'
      })
    }

    const summary = {
      total: previewRows.length,
      settled: previewRows.filter((row) => row.status === 'settled').length,
      unsettled: previewRows.filter((row) => row.status === 'unsettled').length,
      imported,
      errors: previewRows.filter((row) => row.status === 'invalid').length
    }

    const responseRows =
      action === 'import'
        ? previewRows.map((row) => (row.status === 'unsettled' ? { ...row, status: 'imported' as const } : row))
        : previewRows

    return NextResponse.json({
      success: true,
      bank,
      summary,
      entries: responseRows
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
