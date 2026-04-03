export type PaymentModeOption = {
  id: string
  name: string
  code: string
  isActive: boolean
}

type DefaultPaymentModeDefinition = {
  name: string
  code: string
  description: string
  isActive: boolean
  matchCodes?: readonly string[]
  matchNames?: readonly string[]
}

type PaymentModeRow = {
  id: string
  code: string
  name: string
  description?: string | null
  isActive: boolean
}

type PaymentModeDbClient = {
  paymentMode: {
    findMany(args: {
      where: { companyId: string }
      select: {
        id: true
        code: true
        name: true
        description: true
        isActive: true
      }
    }): Promise<PaymentModeRow[]>
    create(args: {
      data: {
        companyId: string
        name: string
        code: string
        description: string
        isActive: boolean
      }
    }): Promise<unknown>
    update(args: {
      where: { id: string }
      data: {
        name?: string
        code?: string
        description?: string
        isActive?: boolean
      }
    }): Promise<unknown>
  }
}

const CASH_KEYWORDS = ['cash', 'nakad', 'naqad']
const BANK_KEYWORDS = ['bank', 'cheque', 'check', 'dd', 'neft', 'rtgs', 'imps', 'wire', 'transfer']

function normalizeModeText(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeModeCode(value: unknown): string {
  return String(value || '').trim().toUpperCase()
}

function hasAnyKeyword(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value === keyword || value.includes(keyword))
}

export function isCashPaymentMode(modeCode: unknown, modeName?: unknown): boolean {
  const code = normalizeModeText(modeCode)
  const name = normalizeModeText(modeName)
  return code === 'c' || hasAnyKeyword(code, CASH_KEYWORDS) || hasAnyKeyword(name, CASH_KEYWORDS)
}

export function isBankPaymentMode(modeCode: unknown, modeName?: unknown): boolean {
  if (isCashPaymentMode(modeCode, modeName)) return false
  const code = normalizeModeText(modeCode)
  const name = normalizeModeText(modeName)
  return hasAnyKeyword(code, BANK_KEYWORDS) || hasAnyKeyword(name, BANK_KEYWORDS)
}

const DEFAULT_PAYMENT_MODE_DEFINITIONS: readonly DefaultPaymentModeDefinition[] = [
  {
    name: 'Cash',
    code: 'CASH',
    description: 'Universal cash payment mode',
    isActive: true,
    matchCodes: ['C'],
    matchNames: ['cash', 'nakad', 'naqad']
  },
  {
    name: 'Cheque',
    code: 'CHEQUE',
    description: 'Universal cheque payment mode',
    isActive: true,
    matchCodes: ['CHQ', 'CQ', 'CHECK'],
    matchNames: ['cheque', 'check', 'chq']
  },
  {
    name: 'NEFT',
    code: 'NEFT',
    description: 'Universal NEFT payment mode',
    isActive: true,
    matchNames: ['neft']
  },
  {
    name: 'RTGS',
    code: 'RTGS',
    description: 'Universal RTGS payment mode',
    isActive: true,
    matchNames: ['rtgs']
  },
  {
    name: 'UPI',
    code: 'UPI',
    description: 'Universal UPI payment mode',
    isActive: true,
    matchCodes: ['O', 'ONLINE'],
    matchNames: ['upi', 'online', 'gpay', 'phonepe', 'paytm', 'google pay', 'bharatpe', 'qr']
  }
] as const

export const DEFAULT_PAYMENT_MODES: PaymentModeOption[] = DEFAULT_PAYMENT_MODE_DEFINITIONS.map((mode) => ({
  id: mode.code.toLowerCase(),
  name: mode.name,
  code: mode.code,
  isActive: mode.isActive
}))

function hasExactModeAlias(value: string, aliases: readonly string[] | undefined, normalizer: (value: unknown) => string): boolean {
  if (!aliases || aliases.length === 0) return false
  return aliases.some((alias) => normalizer(alias) === value)
}

function findMatchingPaymentModeRow(
  rows: PaymentModeRow[],
  definition: DefaultPaymentModeDefinition,
  usedIds: Set<string>
): PaymentModeRow | undefined {
  const availableRows = rows.filter((row) => !usedIds.has(row.id))
  const normalizedDefinitionCode = normalizeModeCode(definition.code)
  const normalizedDefinitionName = normalizeModeText(definition.name)

  return (
    availableRows.find((row) => normalizeModeCode(row.code) === normalizedDefinitionCode) ||
    availableRows.find((row) => normalizeModeText(row.name) === normalizedDefinitionName) ||
    availableRows.find((row) => hasExactModeAlias(normalizeModeCode(row.code), definition.matchCodes, normalizeModeCode)) ||
    availableRows.find((row) => hasExactModeAlias(normalizeModeText(row.name), definition.matchNames, normalizeModeText))
  )
}

export async function ensureDefaultPaymentModes(db: PaymentModeDbClient, companyId: string): Promise<void> {
  const normalizedCompanyId = String(companyId || '').trim()
  if (!normalizedCompanyId) return

  const existingRows = await db.paymentMode.findMany({
    where: { companyId: normalizedCompanyId },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      isActive: true
    }
  })

  const usedRowIds = new Set<string>()

  for (const definition of DEFAULT_PAYMENT_MODE_DEFINITIONS) {
    const existing = findMatchingPaymentModeRow(existingRows, definition, usedRowIds)

    if (!existing) {
      await db.paymentMode.create({
        data: {
          companyId: normalizedCompanyId,
          name: definition.name,
          code: definition.code,
          description: definition.description,
          isActive: definition.isActive
        }
      })
      continue
    }

    usedRowIds.add(existing.id)

    const nextDescription =
      typeof existing.description === 'string' && existing.description.trim().length > 0
        ? existing.description
        : definition.description

    if (
      existing.name !== definition.name ||
      existing.code !== definition.code ||
      existing.isActive !== definition.isActive ||
      existing.description !== nextDescription
    ) {
      await db.paymentMode.update({
        where: { id: existing.id },
        data: {
          name: definition.name,
          code: definition.code,
          description: nextDescription,
          isActive: definition.isActive
        }
      })
    }
  }
}
