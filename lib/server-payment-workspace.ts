import { prisma } from '@/lib/prisma'
import {
  getPaymentTypeLabel,
  isCashBankPaymentType,
  isCashBankReceiptType,
  isPaymentEntryType,
  isPurchasePaymentType,
  isSelfTransferPaymentType,
  parseCashBankPaymentReference,
  SALES_RECEIPT_TYPE
} from '@/lib/payment-entry-types'
import { isPartyOpeningBalanceReference } from '@/lib/party-opening-balance'

export type PaymentListView = 'default' | 'workspace' | 'report'

type PaginationInput = {
  enabled: boolean
  skip: number
  pageSize: number
  search?: string
}

type PaymentQueryParams = {
  companyIds: string[]
  billType?: string | null
  includeDeleted?: boolean
  pagination?: PaginationInput
  view?: PaymentListView
}

const clampNonNegative = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

function getPaymentSelect(view: PaymentListView) {
  const includeExtendedFields = view === 'workspace' || view === 'report'

  return {
    id: true,
    companyId: true,
    billType: true,
    billId: true,
    billDate: true,
    payDate: true,
    amount: true,
    mode: true,
    status: true,
    txnRef: true,
    note: true,
    bankNameSnapshot: true,
    bankBranchSnapshot: true,
    createdAt: true,
    ...(includeExtendedFields
        ? {
            cashAmount: true,
            cashPaymentDate: true,
            onlinePayAmount: true,
            onlinePaymentDate: true,
            ifscCode: true,
            beneficiaryBankAccount: true,
            asFlag: true
          }
      : {}),
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
  } as const
}

export function normalizePaymentListView(value: string | null | undefined): PaymentListView {
  if (value === 'workspace' || value === 'report') return value
  return 'default'
}

export async function loadPaymentsListData(params: PaymentQueryParams): Promise<{
  rows: Array<Record<string, unknown>>
  total: number
}> {
  const view = params.view || 'default'
  const pagination = params.pagination
  const companyIds = Array.from(new Set(params.companyIds.map((companyId) => companyId.trim()).filter(Boolean)))

  if (companyIds.length === 0) {
    return {
      rows: [],
      total: 0
    }
  }

  const where = {
    companyId: { in: companyIds },
    ...(params.billType && isPaymentEntryType(params.billType) ? { billType: params.billType } : {}),
    ...(params.includeDeleted ? {} : { deletedAt: null }),
    ...(pagination?.search
      ? {
          OR: [
            { txnRef: { contains: pagination.search } },
            { note: { contains: pagination.search } },
            { mode: { contains: pagination.search } },
            { status: { contains: pagination.search } },
            { billType: { contains: pagination.search } },
            { bankNameSnapshot: { contains: pagination.search } },
            { bankBranchSnapshot: { contains: pagination.search } }
          ]
        }
      : {})
  }

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      select: getPaymentSelect(view),
      orderBy: [{ payDate: 'desc' }, { createdAt: 'desc' }],
      ...(pagination?.enabled ? { skip: pagination.skip, take: pagination.pageSize } : {})
    }),
    pagination?.enabled ? prisma.payment.count({ where }) : Promise.resolve(0)
  ])

  const purchaseBillIds = [...new Set(
    payments.filter((payment) => payment.billType === 'purchase').map((payment) => payment.billId).filter(Boolean)
  )]
  const salesBillIds = [...new Set(
    payments.filter((payment) => payment.billType === 'sales').map((payment) => payment.billId).filter(Boolean)
  )]
  const cashBankReferences = payments
    .map((payment) => parseCashBankPaymentReference(payment.billId))
    .filter((reference): reference is NonNullable<ReturnType<typeof parseCashBankPaymentReference>> => Boolean(reference))
  const accountingHeadIds = [...new Set(
    cashBankReferences
      .filter((reference) => reference.referenceType === 'accounting-head')
      .map((reference) => reference.referenceId)
  )]
  const partyReferenceIds = [...new Set(
    cashBankReferences
      .filter((reference) => reference.referenceType === 'party')
      .map((reference) => reference.referenceId)
  )]
  const supplierReferenceIds = [...new Set(
    cashBankReferences
      .filter((reference) => reference.referenceType === 'supplier')
      .map((reference) => reference.referenceId)
  )]

  const [purchaseBills, specialPurchaseBills, salesBills, accountingHeads, parties, suppliers] = await Promise.all([
    purchaseBillIds.length > 0
      ? prisma.purchaseBill.findMany({
          where: {
            companyId: { in: companyIds },
            id: { in: purchaseBillIds }
          },
          select: {
            id: true,
            billNo: true,
            farmer: {
              select: {
                name: true
              }
            }
          }
        })
      : Promise.resolve([]),
    purchaseBillIds.length > 0
      ? prisma.specialPurchaseBill.findMany({
          where: {
            companyId: { in: companyIds },
            id: { in: purchaseBillIds }
          },
          select: {
            id: true,
            supplierInvoiceNo: true,
            supplier: {
              select: {
                name: true
              }
            }
          }
        })
      : Promise.resolve([]),
    salesBillIds.length > 0
      ? prisma.salesBill.findMany({
          where: {
            companyId: { in: companyIds },
            id: { in: salesBillIds }
          },
          select: {
            id: true,
            billNo: true
          }
        })
      : Promise.resolve([]),
    accountingHeadIds.length > 0
      ? prisma.accountingHead.findMany({
          where: {
            companyId: { in: companyIds },
            id: { in: accountingHeadIds }
          },
          select: {
            id: true,
            name: true
          }
        })
      : Promise.resolve([]),
    partyReferenceIds.length > 0
      ? prisma.party.findMany({
          where: {
            companyId: { in: companyIds },
            id: { in: partyReferenceIds }
          },
          select: {
            id: true,
            name: true
          }
        })
      : Promise.resolve([]),
    supplierReferenceIds.length > 0
      ? prisma.supplier.findMany({
          where: {
            companyId: { in: companyIds },
            id: { in: supplierReferenceIds }
          },
          select: {
            id: true,
            name: true
          }
        })
      : Promise.resolve([])
  ])

  const purchaseBillMap = new Map(
    purchaseBills.map((bill) => [
      bill.id,
      {
        billNo: bill.billNo,
        partyName: bill.farmer?.name || ''
      }
    ])
  )
  const specialPurchaseBillMap = new Map(
    specialPurchaseBills.map((bill) => [
      bill.id,
      {
        billNo: bill.supplierInvoiceNo,
        partyName: bill.supplier?.name || ''
      }
    ])
  )
  const salesBillMap = new Map(salesBills.map((bill) => [bill.id, bill.billNo]))
  const cashBankReferenceLabelMap = new Map<string, string>([
    ...accountingHeads.map((head) => [`accounting-head:${head.id}`, head.name || ''] as const),
    ...parties.map((party) => [`party:${party.id}`, party.name || ''] as const),
    ...suppliers.map((supplier) => [`supplier:${supplier.id}`, supplier.name || ''] as const)
  ])

  return {
    rows: payments.map((payment) => {
      const cashBankReference = parseCashBankPaymentReference(payment.billId)
      const cashBankTargetLabel = cashBankReference
        ? cashBankReferenceLabelMap.get(`${cashBankReference.referenceType}:${cashBankReference.referenceId}`) || ''
        : ''

      return {
        ...payment,
        amount: clampNonNegative(payment.amount),
        billTypeLabel: getPaymentTypeLabel(payment.billType),
        billNo:
          payment.billType === SALES_RECEIPT_TYPE && isPartyOpeningBalanceReference(payment.billId)
            ? 'Opening Balance'
            : isPurchasePaymentType(payment.billType)
              ? purchaseBillMap.get(payment.billId)?.billNo || specialPurchaseBillMap.get(payment.billId)?.billNo || ''
              : payment.billType === SALES_RECEIPT_TYPE
                ? salesBillMap.get(payment.billId) || ''
                : getPaymentTypeLabel(payment.billType),
        partyName:
          payment.party?.name ||
          payment.farmer?.name ||
          purchaseBillMap.get(payment.billId)?.partyName ||
          specialPurchaseBillMap.get(payment.billId)?.partyName ||
          cashBankTargetLabel ||
          (isCashBankPaymentType(payment.billType) || isCashBankReceiptType(payment.billType)
            ? String(payment.bankNameSnapshot || '').trim()
            : isSelfTransferPaymentType(payment.billType)
              ? [payment.bankNameSnapshot, payment.bankBranchSnapshot]
                  .map((value) => String(value || '').trim())
                  .filter(Boolean)
                  .join(' -> ')
              : '')
      }
    }),
    total
  }
}

export async function loadPaymentWorkspaceData(
  companyId: string,
  options: {
    includePaymentModes?: boolean
    purchaseAllowed?: boolean
    salesAllowed?: boolean
    paymentsAllowed?: boolean
  } = {}
) {
  const [purchaseBills, salesBills, paymentsResult, paymentModes] = await Promise.all([
    options.purchaseAllowed === false
      ? Promise.resolve([])
      : prisma.purchaseBill.findMany({
          where: {
            companyId,
            status: { not: 'cancelled' }
          },
          select: {
            id: true,
            billNo: true,
            billDate: true,
            totalAmount: true,
            paidAmount: true,
            balanceAmount: true,
            status: true,
            farmer: {
              select: {
                name: true
              }
            }
          },
          orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
        }),
    options.salesAllowed === false
      ? Promise.resolve([])
      : prisma.salesBill.findMany({
          where: {
            companyId,
            status: { not: 'cancelled' }
          },
          select: {
            id: true,
            billNo: true,
            billDate: true,
            totalAmount: true,
            receivedAmount: true,
            balanceAmount: true,
            status: true,
            party: {
              select: {
                name: true
              }
            }
          },
          orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
        }),
    options.paymentsAllowed === false
      ? Promise.resolve({ rows: [], total: 0 })
      : loadPaymentsListData({
          companyIds: [companyId]
        }),
    options.includePaymentModes
      ? prisma.paymentMode.findMany({
          where: {
            companyId
          },
          select: {
            id: true,
            name: true,
            code: true,
            isActive: true
          },
          orderBy: {
            name: 'asc'
          }
        })
      : Promise.resolve([])
  ])

  return {
    purchaseBills,
    salesBills,
    payments: paymentsResult.rows,
    ...(options.includePaymentModes ? { paymentModes } : {})
  }
}
