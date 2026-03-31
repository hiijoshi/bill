import { Prisma, PrismaClient } from '@prisma/client'

type AccountingHeadDbClient = PrismaClient | Prisma.TransactionClient

type DefaultAccountingHeadDefinition = {
  name: string
  category: string
  calculationBasis: 'PERCENT_TOTAL' | 'PER_WEIGHT' | 'PER_BAG'
  defaultValue: number
  accountGroup:
    | 'DIRECT_EXPENSE'
    | 'INDIRECT_EXPENSE'
    | 'DIRECT_INCOME'
    | 'INDIRECT_INCOME'
    | 'DUTIES'
    | 'TAXES'
    | 'ASSETS'
    | 'LIABILITY'
  isMandiCharge: boolean
  isActive: boolean
}

export const DEFAULT_ACCOUNTING_HEADS: readonly DefaultAccountingHeadDefinition[] = [
  { name: 'Bardana (Packing)', category: 'Purchase Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: true, isActive: true },
  { name: 'Cleaning / Sorting', category: 'Purchase Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: true, isActive: true },
  { name: 'Commission Income', category: 'Service', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_INCOME', isMandiCharge: false, isActive: true },
  { name: 'Commission Paid', category: 'Purchase Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: true, isActive: true },
  { name: 'Delivery Charges', category: 'Sales Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Discount', category: 'Adjustment', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Electricity', category: 'Utility Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'INDIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Freight / Transport', category: 'Sales Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Hamali (Labour)', category: 'Purchase Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: true, isActive: true },
  { name: 'Handling Charges', category: 'Sales Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Input CGST', category: 'Tax', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'ASSETS', isMandiCharge: true, isActive: true },
  { name: 'Input IGST', category: 'Tax', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'ASSETS', isMandiCharge: true, isActive: true },
  { name: 'Input SGST', category: 'Tax', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'ASSETS', isMandiCharge: true, isActive: true },
  { name: 'Internet', category: 'Utility Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'INDIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Loading Charges', category: 'Purchase Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: true, isActive: true },
  { name: 'Mandi Tax / Fee', category: 'Statutory Charges', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Office Rent', category: 'Office Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'INDIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Output CGST', category: 'Tax', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'LIABILITY', isMandiCharge: true, isActive: true },
  { name: 'Output IGST', category: 'Tax', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'LIABILITY', isMandiCharge: true, isActive: true },
  { name: 'Output SGST', category: 'Tax', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'LIABILITY', isMandiCharge: true, isActive: true },
  { name: 'Packing Charges (Sale)', category: 'Sales Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Repairs & Maintenance', category: 'Office Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'INDIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Rounding Off', category: 'Adjustment', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Salary', category: 'Office Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'INDIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Sales', category: 'Sales', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_INCOME', isMandiCharge: false, isActive: true },
  { name: 'Software Expense', category: 'Office Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Stationery', category: 'Office Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'INDIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Travel Expense', category: 'Office Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'INDIRECT_EXPENSE', isMandiCharge: false, isActive: true },
  { name: 'Tulai (Weighment)', category: 'Purchase Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: true, isActive: true },
  { name: 'Unloading Charges', category: 'Purchase Expense', calculationBasis: 'PERCENT_TOTAL', defaultValue: 0, accountGroup: 'DIRECT_EXPENSE', isMandiCharge: true, isActive: true }
] as const

function normalizeAccountingHeadName(value: string) {
  return value.trim().toLowerCase()
}

export async function ensureDefaultAccountingHeads(db: AccountingHeadDbClient, companyId: string) {
  const existingHeads = await db.accountingHead.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      mandiConfig: {
        select: {
          id: true
        }
      }
    }
  })

  const existingByName = new Map(
    existingHeads.map((head) => [normalizeAccountingHeadName(head.name), head])
  )

  for (const definition of DEFAULT_ACCOUNTING_HEADS) {
    const key = normalizeAccountingHeadName(definition.name)
    let head = existingByName.get(key) || null

    if (!head) {
      try {
        head = await db.accountingHead.create({
          data: {
            companyId,
            name: definition.name,
            category: definition.category,
            amount: 0,
            value: definition.defaultValue
          },
          select: {
            id: true,
            name: true,
            mandiConfig: {
              select: {
                id: true
              }
            }
          }
        })
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error
        }
        head = await db.accountingHead.findFirst({
          where: {
            companyId,
            name: definition.name
          },
          select: {
            id: true,
            name: true,
            mandiConfig: {
              select: {
                id: true
              }
            }
          }
        })
      }

      if (head) {
        existingByName.set(key, head)
      }
    }

    if (!head) continue
    if (head.mandiConfig?.id) continue

    try {
      await db.accountingHeadMandiConfig.create({
        data: {
          accountingHeadId: head.id,
          mandiTypeId: null,
          isMandiCharge: definition.isMandiCharge,
          calculationBasis: definition.calculationBasis,
          defaultValue: definition.defaultValue,
          accountGroup: definition.accountGroup,
          isActive: definition.isActive
        }
      })
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error
      }
    }
  }
}
