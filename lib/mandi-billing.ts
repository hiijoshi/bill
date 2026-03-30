import type { Prisma, PrismaClient } from '@prisma/client'

import { calculateMandiCharges, type MandiChargeDefinition } from '@/lib/mandi-charge-engine'

type MandiBillingClient = Prisma.TransactionClient | PrismaClient

export async function loadMandiChargeDefinitions(client: MandiBillingClient, companyId: string): Promise<MandiChargeDefinition[]> {
  const heads = await client.accountingHead.findMany({
    where: {
      companyId,
      mandiConfig: {
        is: {
          isActive: true,
          isMandiCharge: true
        }
      }
    },
    include: {
      mandiConfig: true
    },
    orderBy: [{ name: 'asc' }]
  })

  return heads.map((head, index) => ({
    accountingHeadId: head.id,
    name: head.name,
    category: head.category,
    mandiTypeId: head.mandiConfig?.mandiTypeId || null,
    isMandiCharge: Boolean(head.mandiConfig?.isMandiCharge),
    calculationBasis: head.mandiConfig?.calculationBasis,
    defaultValue: head.mandiConfig?.defaultValue ?? head.value ?? 0,
    accountGroup: head.mandiConfig?.accountGroup,
    sortOrder: index
  }))
}

export async function calculateBillMandiCharges(args: {
  client: MandiBillingClient
  companyId: string
  mandiTypeId?: string | null
  subTotal: number
  totalWeight: number
  totalBags: number
}) {
  const definitions = await loadMandiChargeDefinitions(args.client, args.companyId)
  return calculateMandiCharges({
    definitions,
    mandiTypeId: args.mandiTypeId,
    subTotal: args.subTotal,
    totalWeight: args.totalWeight,
    totalBags: args.totalBags
  })
}

export async function syncBillChargesAndLedger(args: {
  client: MandiBillingClient
  companyId: string
  billType: 'purchase' | 'sales'
  billId: string
  billDate: Date
  mandiTypeId?: string | null
  charges: Awaited<ReturnType<typeof calculateBillMandiCharges>>['lines']
  partyId?: string | null
  partyName?: string | null
  farmerId?: string | null
  farmerName?: string | null
}) {
  const {
    client,
    companyId,
    billType,
    billId,
    billDate,
    mandiTypeId,
    charges,
    partyId,
    partyName,
    farmerId,
    farmerName
  } = args

  await client.billCharge.deleteMany({
    where: {
      companyId,
      billType,
      billId
    }
  })

  await client.ledgerEntry.deleteMany({
    where: {
      companyId,
      billType,
      billId
    }
  })

  if (charges.length === 0) {
    return
  }

  for (const [index, charge] of charges.entries()) {
    await client.billCharge.create({
      data: {
        companyId,
        billType,
        billId,
        accountingHeadId: charge.accountingHeadId,
        mandiTypeId: mandiTypeId || charge.mandiTypeId || null,
        nameSnapshot: charge.name,
        categorySnapshot: charge.category || null,
        calculationBasis: charge.calculationBasis,
        basisValue: charge.basisValue,
        chargeAmount: charge.chargeAmount,
        sortOrder: Number.isFinite(charge.sortOrder) ? charge.sortOrder : index
      }
    })
  }

  const totalChargeAmount = charges.reduce((sum, charge) => sum + charge.chargeAmount, 0)
  const counterpartyName = partyName || farmerName || null

  if (totalChargeAmount > 0) {
    await client.ledgerEntry.create({
      data: {
        companyId,
        entryDate: billDate,
        billType,
        billId,
        direction: 'debit',
        amount: totalChargeAmount,
        partyId: partyId || null,
        farmerId: farmerId || null,
        accountingHeadId: null,
        accountHeadNameSnapshot: counterpartyName,
        counterpartyNameSnapshot: counterpartyName,
        note: `${billType} bill mandi charges`
      }
    })
  }

  for (const charge of charges) {
    await client.ledgerEntry.create({
      data: {
        companyId,
        entryDate: billDate,
        billType,
        billId,
        direction: 'credit',
        amount: charge.chargeAmount,
        partyId: partyId || null,
        farmerId: farmerId || null,
        accountingHeadId: charge.accountingHeadId,
        accountHeadNameSnapshot: charge.name,
        accountGroupSnapshot: charge.accountGroup || null,
        counterpartyNameSnapshot: counterpartyName,
        note: `${billType} bill mandi charge - ${charge.name}`
      }
    })
  }
}
