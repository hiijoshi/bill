import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import {
  filterCompanyIdsByRoutePermission,
  getAccessibleCompanies,
  normalizeId,
  requireRoles
} from '@/lib/api-security'
import { createBankEntryProvider, SUPPORTED_BANK_SYNC_PROVIDERS } from '@/lib/bank-integration'
import { normalizeNonNegative, roundCurrency } from '@/lib/billing-calculations'
import {
  getPartyOpeningBalanceReference,
  getSignedPartyOpeningBalance,
  isPartyOpeningBalanceReference,
  normalizePartyOpeningBalanceType
} from '@/lib/party-opening-balance'
import { getOrSetServerCache, makeServerCacheKey } from '@/lib/server-cache'

type CompanyOption = {
  id: string
  name: string
  address?: string | null
  phone?: string | null
}

type DailySummaryAccumulator = {
  date: string
  totalSales: number
  totalPurchase: number
  totalStockAdjustmentQty: number
  totalPurchasePayment: number
  totalSalesReceipt: number
  transactionCount: number
  companyIds: Set<string>
}

type PartyLedgerEntryType = 'opening' | 'sale' | 'receipt'

type OutstandingAccumulator = {
  partyId: string
  companyId: string
  companyName: string
  partyName: string
  phone1: string
  address: string
  saleAmount: number
  receivedAmount: number
  balanceAmount: number
  invoiceCount: number
  lastBillDate: string
}

type OperationsReportView = 'outstanding' | 'ledger' | 'daily-transaction' | 'daily-consolidated' | 'bank-ledger'

function normalizeReportView(value: string | null): OperationsReportView {
  if (
    value === 'outstanding' ||
    value === 'ledger' ||
    value === 'daily-transaction' ||
    value === 'daily-consolidated' ||
    value === 'bank-ledger'
  ) {
    return value
  }
  return 'outstanding'
}

const OPERATIONS_REPORT_CACHE_TTL_MS = 20_000

function parseDateAtBoundary(value: string | null, endOfDay = false): Date | null {
  if (!value) return null
  const [year, month, day] = value.split('-').map((part) => Number(part))
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
}

function dateKey(value: Date | string | null | undefined): string {
  if (!value) return ''
  const parsed = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(parsed.getTime())) return ''
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getOrCreateDailyRow(map: Map<string, DailySummaryAccumulator>, key: string): DailySummaryAccumulator {
  const existing = map.get(key)
  if (existing) return existing

  const nextRow: DailySummaryAccumulator = {
    date: key,
    totalSales: 0,
    totalPurchase: 0,
    totalStockAdjustmentQty: 0,
    totalPurchasePayment: 0,
    totalSalesReceipt: 0,
    transactionCount: 0,
    companyIds: new Set<string>()
  }

  map.set(key, nextRow)
  return nextRow
}

function addDailyMetric(
  map: Map<string, DailySummaryAccumulator>,
  key: string,
  companyId: string,
  updater: (row: DailySummaryAccumulator) => void
) {
  const row = getOrCreateDailyRow(map, key)
  row.companyIds.add(companyId)
  row.transactionCount += 1
  updater(row)
}

function formatProductNames(names: string[]): string {
  const uniqueNames = Array.from(new Set(names.map((name) => String(name || '').trim()).filter(Boolean)))
  if (uniqueNames.length === 0) return '-'
  return uniqueNames.join(', ')
}

function normalizeOutstandingStatus(balanceAmount: number, receivedAmount: number): 'paid' | 'partial' | 'unpaid' {
  if (balanceAmount <= 0) return 'paid'
  if (receivedAmount > 0) return 'partial'
  return 'unpaid'
}

function isBankLikePayment(payment: {
  mode?: string | null
  bankNameSnapshot?: string | null
  ifscCode?: string | null
  beneficiaryBankAccount?: string | null
  txnRef?: string | null
}): boolean {
  const mode = String(payment.mode || '').trim().toLowerCase()
  if (mode === 'cash' || mode === 'c') {
    return Boolean(payment.bankNameSnapshot || payment.ifscCode || payment.beneficiaryBankAccount || payment.txnRef)
  }

  return Boolean(
    mode || payment.bankNameSnapshot || payment.ifscCode || payment.beneficiaryBankAccount || payment.txnRef
  )
}

function formatPaymentMode(mode: string | null | undefined): string {
  const normalized = String(mode || '').trim()
  if (!normalized) return '-'
  return normalized
}

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const { searchParams } = new URL(request.url)
    const requestedCompanyIds = Array.from(
      new Set(
        searchParams
          .getAll('companyIds')
          .flatMap((value) => String(value || '').split(','))
          .map((value) => normalizeId(value))
          .filter(Boolean)
      )
    )
    const requestedCompanyId = normalizeId(searchParams.get('companyId'))
    const requestedPartyId = normalizeId(searchParams.get('partyId'))
    const requestedView = normalizeReportView(searchParams.get('view'))
    const dateFrom = parseDateAtBoundary(searchParams.get('dateFrom'))
    const dateTo = parseDateAtBoundary(searchParams.get('dateTo'), true)

    if ((searchParams.get('dateFrom') && !dateFrom) || (searchParams.get('dateTo') && !dateTo)) {
      return NextResponse.json({ error: 'Invalid date range provided' }, { status: 400 })
    }

    if (dateFrom && dateTo && dateFrom > dateTo) {
      return NextResponse.json({ error: 'Date from cannot be after date to' }, { status: 400 })
    }

    const accessibleCompanies = await getAccessibleCompanies(authResult.auth)
    const permittedCompanyIds = await filterCompanyIdsByRoutePermission(
      authResult.auth,
      accessibleCompanies.map((company) => company.id),
      request.nextUrl.pathname,
      request.method
    )

    const companyDetails = await prisma.company.findMany({
      where: {
        id: { in: permittedCompanyIds },
        deletedAt: null
      },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true
      }
    })

    const companyDetailMap = new Map(companyDetails.map((company) => [company.id, company]))

    const permittedCompanies: CompanyOption[] = accessibleCompanies
      .filter((company) => permittedCompanyIds.includes(company.id))
      .map((company) => {
        const detail = companyDetailMap.get(company.id)
        return {
          id: company.id,
          name: company.name,
          address: detail?.address || null,
          phone: detail?.phone || null
        }
      })

    if (permittedCompanies.length === 0) {
      return NextResponse.json({ error: 'No report access found for this user' }, { status: 403 })
    }

    const aggregateEligibleCompanyIds =
      authResult.auth.role === 'super_admin' || authResult.auth.role === 'trader_admin'
        ? permittedCompanyIds
        : authResult.auth.userDbId
          ? (
              await prisma.userPermission.findMany({
                where: {
                  userId: authResult.auth.userDbId,
                  companyId: { in: permittedCompanyIds },
                  module: 'REPORTS',
                  canWrite: true
                },
                select: {
                  companyId: true
                }
              })
            ).map((row) => row.companyId)
          : []

    const explicitRequestedCompanyIds =
      requestedCompanyIds.length > 0 ? requestedCompanyIds : requestedCompanyId ? [requestedCompanyId] : []

    const targetCompanyIds =
      explicitRequestedCompanyIds.length > 0
        ? explicitRequestedCompanyIds.filter((companyId) => permittedCompanyIds.includes(companyId))
        : [permittedCompanies[0].id]

    if (targetCompanyIds.length === 0) {
      return NextResponse.json({ error: 'Requested company is outside your report access scope' }, { status: 403 })
    }

    if (
      targetCompanyIds.length > 1 &&
      !targetCompanyIds.every((companyId) => aggregateEligibleCompanyIds.includes(companyId))
    ) {
      return NextResponse.json(
        { error: 'Multi-company reports require All Companies report access for every selected company' },
        { status: 403 }
      )
    }

    const cacheKey = makeServerCacheKey('operations-report', [
      requestedView,
      targetCompanyIds,
      requestedView === 'ledger' ? requestedPartyId || '' : '',
      dateFrom?.toISOString() || '',
      dateTo?.toISOString() || '',
      permittedCompanies.map((company) => company.id),
      aggregateEligibleCompanyIds
    ])

    const payload = await getOrSetServerCache(cacheKey, OPERATIONS_REPORT_CACHE_TTL_MS, async () => {
      const companyNameMap = new Map(permittedCompanies.map((company) => [company.id, company.name]))
      const selectedCompanyDetail =
        targetCompanyIds.length === 1
          ? permittedCompanies.find((company) => company.id === targetCompanyIds[0]) || null
          : null
      const selectedCompanyName =
        targetCompanyIds.length === 1
          ? companyNameMap.get(targetCompanyIds[0]) || ''
          : `${targetCompanyIds.length} companies`

      const salesWhere = {
      companyId: { in: targetCompanyIds },
      ...(dateFrom || dateTo
        ? {
            billDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {})
            }
          }
        : {})
    }

      const purchaseWhere = {
      companyId: { in: targetCompanyIds },
      ...(dateFrom || dateTo
        ? {
            billDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {})
            }
          }
        : {})
    }

      const paymentWhere = {
      companyId: { in: targetCompanyIds },
      deletedAt: null,
      ...(dateFrom || dateTo
        ? {
            payDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {})
            }
          }
        : {})
    }

      const stockAdjustmentWhere = {
      companyId: { in: targetCompanyIds },
      type: 'adjustment',
      ...(dateFrom || dateTo
        ? {
            entryDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {})
            }
          }
        : {})
    }

      const salesOutstandingWhere = {
      companyId: { in: targetCompanyIds },
      ...(dateTo
        ? {
            billDate: {
              lte: dateTo
            }
          }
        : {})
    }

      const purchaseOutstandingWhere = {
      companyId: { in: targetCompanyIds },
      ...(dateTo
        ? {
            billDate: {
              lte: dateTo
            }
          }
        : {})
    }

      const paymentOutstandingWhere = {
      companyId: { in: targetCompanyIds },
      deletedAt: null,
      ...(dateTo
        ? {
            payDate: {
              lte: dateTo
            }
          }
        : {})
    }

      const needsLedgerView = requestedView === 'ledger'
      const needsDailyView = requestedView === 'daily-transaction' || requestedView === 'daily-consolidated'
      const needsBankLedgerView = requestedView === 'bank-ledger'
      const needsDetailedPayments = needsDailyView || needsBankLedgerView
      const needsPartyBalances = requestedView === 'outstanding' || needsLedgerView

      const [
      salesTotalAggregate,
      purchaseTotalAggregate,
      specialPurchaseTotalAggregate,
      paymentTotalsByType,
      stockAdjustmentAggregate,
      salesBills,
      purchaseBills,
      specialPurchaseBills,
      payments,
      stockAdjustments,
      parties,
      bankSyncProviders,
      salesBillsAsOf,
      purchaseBillsAsOf,
      specialPurchaseBillsAsOf,
      paymentsAsOf
      ] = await Promise.all([
      prisma.salesBill.aggregate({
        where: salesWhere,
        _sum: {
          totalAmount: true
        }
      }),
      prisma.purchaseBill.aggregate({
        where: purchaseWhere,
        _sum: {
          totalAmount: true
        }
      }),
      prisma.specialPurchaseBill.aggregate({
        where: purchaseWhere,
        _sum: {
          totalAmount: true
        }
      }),
      prisma.payment.groupBy({
        by: ['billType'],
        where: paymentWhere,
        _sum: {
          amount: true
        }
      }),
      prisma.stockLedger.aggregate({
        where: stockAdjustmentWhere,
        _sum: {
          qtyIn: true,
          qtyOut: true
        }
      }),
      needsDailyView
        ? prisma.salesBill.findMany({
        where: salesWhere,
        select: {
          id: true,
          companyId: true,
          billNo: true,
          billDate: true,
          totalAmount: true,
          receivedAmount: true,
          balanceAmount: true,
          partyId: true,
          party: {
            select: {
              id: true,
              name: true,
              address: true,
              phone1: true
            }
          },
          salesItems: {
            select: {
              weight: true,
              product: {
                select: {
                  name: true
                }
              }
            }
          }
        },
        orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
      })
        : Promise.resolve([]),
      needsDailyView
        ? prisma.purchaseBill.findMany({
        where: purchaseWhere,
        select: {
          id: true,
          companyId: true,
          billNo: true,
          billDate: true,
          totalAmount: true,
          paidAmount: true,
          balanceAmount: true,
          farmerId: true,
          farmerNameSnapshot: true,
          farmerAddressSnapshot: true,
          farmerContactSnapshot: true,
          farmer: {
            select: {
              id: true,
              name: true,
              address: true,
              phone1: true
            }
          },
          purchaseItems: {
            select: {
              qty: true,
              productNameSnapshot: true,
              product: {
                select: {
                  name: true
                }
              }
            }
          }
        },
        orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
      })
        : Promise.resolve([]),
      needsDailyView
        ? prisma.specialPurchaseBill.findMany({
        where: purchaseWhere,
        select: {
          id: true,
          companyId: true,
          supplierInvoiceNo: true,
          billDate: true,
          totalAmount: true,
          paidAmount: true,
          balanceAmount: true,
          supplier: {
            select: {
              id: true,
              name: true,
              address: true,
              phone1: true
            }
          },
          specialPurchaseItems: {
            select: {
              weight: true,
              product: {
                select: {
                  name: true
                }
              }
            }
          }
        },
        orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
      })
        : Promise.resolve([]),
      needsDetailedPayments
        ? prisma.payment.findMany({
        where: paymentWhere,
        select: {
          id: true,
          companyId: true,
          billType: true,
          billId: true,
          payDate: true,
          amount: true,
          mode: true,
          cashAmount: true,
          onlinePayAmount: true,
          ifscCode: true,
          beneficiaryBankAccount: true,
          bankNameSnapshot: true,
          bankBranchSnapshot: true,
          txnRef: true,
          note: true,
          partyId: true,
          farmerId: true,
          party: {
            select: {
              id: true,
              name: true,
              address: true,
              phone1: true
            }
          },
          farmer: {
            select: {
              id: true,
              name: true,
              address: true,
              phone1: true
            }
          }
        },
        orderBy: [{ payDate: 'desc' }, { createdAt: 'desc' }]
      })
        : Promise.resolve([]),
      needsDailyView
        ? prisma.stockLedger.findMany({
        where: stockAdjustmentWhere,
        select: {
          id: true,
          companyId: true,
          entryDate: true,
          qtyIn: true,
          qtyOut: true,
          refTable: true,
          refId: true,
          product: {
            select: {
              name: true
            }
          }
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }]
      })
        : Promise.resolve([]),
      needsPartyBalances
        ? prisma.party.findMany({
        where: {
          companyId: { in: targetCompanyIds },
          OR: [
            {
              openingBalance: {
                gt: 0
              }
            },
            {
              salesBills: {
                some: dateTo ? { billDate: { lte: dateTo } } : {}
              }
            },
            {
              payments: {
                some: {
                  billType: 'sales',
                  deletedAt: null,
                  ...(dateTo ? { payDate: { lte: dateTo } } : {})
                }
              }
            }
          ]
        },
        select: {
          id: true,
          companyId: true,
          name: true,
          address: true,
          phone1: true,
          openingBalance: true,
          openingBalanceType: true,
          openingBalanceDate: true
        },
        orderBy: [{ name: 'asc' }]
      })
        : Promise.resolve([]),
      needsBankLedgerView
        ? Promise.all(
            SUPPORTED_BANK_SYNC_PROVIDERS.map((provider) =>
              createBankEntryProvider(provider).getStatus({ companyId: targetCompanyIds[0] || '' })
            )
          )
        : Promise.resolve([]),
      prisma.salesBill.findMany({
        where: salesOutstandingWhere,
        select: {
          id: true,
          companyId: true,
          billDate: true,
          totalAmount: true,
          partyId: true,
          party: {
            select: {
              id: true,
              name: true,
              address: true,
              phone1: true
            }
          }
        },
        orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
      }),
      prisma.purchaseBill.findMany({
        where: purchaseOutstandingWhere,
        select: {
          id: true,
          companyId: true,
          totalAmount: true
        }
      }),
      prisma.specialPurchaseBill.findMany({
        where: purchaseOutstandingWhere,
        select: {
          id: true,
          companyId: true,
          totalAmount: true
        }
      }),
      prisma.payment.findMany({
        where: paymentOutstandingWhere,
        select: {
          id: true,
          companyId: true,
          billType: true,
          billId: true,
          amount: true,
          partyId: true,
          farmerId: true
        }
      })
    ])

      const purchasePaymentBillIds = Array.from(
        new Set(
          payments
            .filter((payment) => payment.billType === 'purchase' && payment.billId)
            .map((payment) => payment.billId)
        )
      )
      const salesPaymentBillIds = Array.from(
        new Set(
          payments
            .filter((payment) => payment.billType === 'sales' && payment.billId)
            .map((payment) => payment.billId)
        )
      )

      const [paymentPurchaseBills, paymentSpecialPurchaseBills, paymentSalesBills] = await Promise.all([
      purchasePaymentBillIds.length > 0
        ? prisma.purchaseBill.findMany({
            where: { id: { in: purchasePaymentBillIds }, companyId: { in: targetCompanyIds } },
            select: { id: true, billNo: true }
          })
        : Promise.resolve([]),
      purchasePaymentBillIds.length > 0
        ? prisma.specialPurchaseBill.findMany({
            where: { id: { in: purchasePaymentBillIds }, companyId: { in: targetCompanyIds } },
            select: { id: true, supplierInvoiceNo: true }
          })
        : Promise.resolve([]),
      salesPaymentBillIds.length > 0
        ? prisma.salesBill.findMany({
            where: { id: { in: salesPaymentBillIds }, companyId: { in: targetCompanyIds } },
            select: { id: true, billNo: true }
          })
        : Promise.resolve([])
    ])

      const purchaseBillNoMap = new Map(paymentPurchaseBills.map((bill) => [bill.id, bill.billNo]))
      const specialPurchaseBillNoMap = new Map(paymentSpecialPurchaseBills.map((bill) => [bill.id, bill.supplierInvoiceNo]))
      const salesBillNoMap = new Map(paymentSalesBills.map((bill) => [bill.id, bill.billNo]))

      const salesReceiptByBillId = new Map<string, number>()
      const purchasePaidByBillId = new Map<string, number>()

      for (const payment of paymentsAsOf) {
        const targetMap = payment.billType === 'sales' ? salesReceiptByBillId : purchasePaidByBillId
        targetMap.set(
          payment.billId,
          roundCurrency((targetMap.get(payment.billId) || 0) + normalizeNonNegative(payment.amount))
        )
      }

      const openingPaymentRows =
        needsPartyBalances && parties.length > 0
          ? await prisma.payment.findMany({
              where: {
                companyId: { in: targetCompanyIds },
                billType: 'sales',
                deletedAt: null,
                partyId: { in: parties.map((party) => party.id) },
                billId: { startsWith: getPartyOpeningBalanceReference('') },
                ...(dateTo ? { payDate: { lte: dateTo } } : {})
              },
              select: {
                partyId: true,
                amount: true
              }
            })
          : []

      const openingReceiptsByPartyId = new Map<string, number>()
      for (const payment of openingPaymentRows) {
        const partyId = String(payment.partyId || '').trim()
        if (!partyId) continue
        openingReceiptsByPartyId.set(
          partyId,
          roundCurrency((openingReceiptsByPartyId.get(partyId) || 0) + normalizeNonNegative(payment.amount))
        )
      }

      const openingOutstandingByPartyId = new Map<string, number>()
      for (const party of parties) {
        const openingSigned = getSignedPartyOpeningBalance(party.openingBalance, party.openingBalanceType)
        const openingReceipts = roundCurrency(openingReceiptsByPartyId.get(party.id) || 0)
        const openingOutstanding =
          openingSigned > 0
            ? roundCurrency(Math.max(0, openingSigned - openingReceipts))
            : roundCurrency(openingSigned)
        openingOutstandingByPartyId.set(party.id, openingOutstanding)
      }

      const outstandingMap = new Map<string, OutstandingAccumulator>()

      for (const bill of salesBillsAsOf) {
      const receivedAmount = roundCurrency(salesReceiptByBillId.get(bill.id) || 0)
      const balanceAmount = roundCurrency(Math.max(0, normalizeNonNegative(bill.totalAmount) - receivedAmount))
      if (balanceAmount <= 0) continue

      const groupKey = `${bill.companyId}:${bill.partyId}`
      const existing = outstandingMap.get(groupKey) || {
        partyId: bill.partyId,
        companyId: bill.companyId,
        companyName: companyNameMap.get(bill.companyId) || bill.companyId,
        partyName: String(bill.party?.name || 'Unknown'),
        phone1: String(bill.party?.phone1 || ''),
        address: String(bill.party?.address || ''),
        saleAmount: 0,
        receivedAmount: 0,
        balanceAmount: 0,
        invoiceCount: 0,
        lastBillDate: ''
      }

      existing.saleAmount += normalizeNonNegative(bill.totalAmount)
      existing.receivedAmount += receivedAmount
      existing.balanceAmount += balanceAmount
      existing.invoiceCount += 1
      const billDateKey = dateKey(bill.billDate)
      if (!existing.lastBillDate || billDateKey > existing.lastBillDate) {
        existing.lastBillDate = billDateKey
      }
      outstandingMap.set(groupKey, existing)
      }

      for (const party of parties) {
        const openingSigned = getSignedPartyOpeningBalance(party.openingBalance, party.openingBalanceType)
        const openingOutstanding = roundCurrency(openingOutstandingByPartyId.get(party.id) || 0)
        const openingReceipts = roundCurrency(openingReceiptsByPartyId.get(party.id) || 0)

        if (openingSigned === 0 && openingOutstanding === 0) continue

        const groupKey = `${party.companyId}:${party.id}`
        const existing = outstandingMap.get(groupKey) || {
          partyId: party.id,
          companyId: party.companyId,
          companyName: companyNameMap.get(party.companyId) || party.companyId,
          partyName: String(party.name || 'Unknown'),
          phone1: String(party.phone1 || ''),
          address: String(party.address || ''),
          saleAmount: 0,
          receivedAmount: 0,
          balanceAmount: 0,
          invoiceCount: 0,
          lastBillDate: ''
        }

        if (openingSigned > 0) {
          existing.saleAmount += openingSigned
          existing.receivedAmount += openingReceipts
        }

        existing.balanceAmount += openingOutstanding
        const openingDateKey = dateKey(party.openingBalanceDate)
        if (openingDateKey && (!existing.lastBillDate || openingDateKey > existing.lastBillDate)) {
          existing.lastBillDate = openingDateKey
        }
        outstandingMap.set(groupKey, existing)
      }

      const outstandingRows = Array.from(outstandingMap.values())
      .map((row) => ({
        ...row,
        saleAmount: roundCurrency(row.saleAmount),
        receivedAmount: roundCurrency(row.receivedAmount),
        balanceAmount: roundCurrency(row.balanceAmount),
        status: normalizeOutstandingStatus(row.balanceAmount, row.receivedAmount)
      }))
      .sort((a, b) => b.balanceAmount - a.balanceAmount || a.partyName.localeCompare(b.partyName))

      const outstandingByPartyId = new Map(outstandingRows.map((row) => [row.partyId, row]))

      const partiesWithContext = parties.map((party) => {
        const outstandingRow = outstandingByPartyId.get(party.id)
        return {
          id: party.id,
          companyId: party.companyId,
          companyName: companyNameMap.get(party.companyId) || party.companyId,
          name: String(party.name || ''),
          address: String(party.address || ''),
          phone1: String(party.phone1 || ''),
          openingBalance: roundCurrency(normalizeNonNegative(party.openingBalance)),
          openingBalanceType: normalizePartyOpeningBalanceType(party.openingBalanceType),
          openingBalanceDate: dateKey(party.openingBalanceDate),
          openingOutstandingAmount: roundCurrency(openingOutstandingByPartyId.get(party.id) || 0),
          balanceAmount: roundCurrency(outstandingRow?.balanceAmount || 0)
        }
      }).sort((a, b) => b.balanceAmount - a.balanceAmount || a.name.localeCompare(b.name))

      const selectedPartyId =
      needsLedgerView && requestedPartyId && partiesWithContext.some((party) => party.id === requestedPartyId)
        ? requestedPartyId
        : needsLedgerView
          ? partiesWithContext[0]?.id || ''
          : ''

      const selectedParty = partiesWithContext.find((party) => party.id === selectedPartyId) || null

      const [ledgerSales, ledgerPayments, openingSalesAggregate, openingPaymentsAggregate] = selectedPartyId
      ? await Promise.all([
          prisma.salesBill.findMany({
            where: {
              companyId: { in: targetCompanyIds },
              partyId: selectedPartyId,
              ...(dateFrom || dateTo
                ? {
                    billDate: {
                      ...(dateFrom ? { gte: dateFrom } : {}),
                      ...(dateTo ? { lte: dateTo } : {})
                    }
                  }
                : {})
            },
            select: {
              id: true,
              companyId: true,
              billNo: true,
              billDate: true,
              totalAmount: true,
              salesItems: {
                select: {
                  weight: true,
                  bags: true,
                  rate: true,
                  product: {
                    select: {
                      name: true
                    }
                  }
                }
              }
            },
            orderBy: [{ billDate: 'asc' }, { createdAt: 'asc' }]
          }),
          prisma.payment.findMany({
            where: {
              companyId: { in: targetCompanyIds },
              billType: 'sales',
              partyId: selectedPartyId,
              deletedAt: null,
              ...(dateFrom || dateTo
                ? {
                    payDate: {
                      ...(dateFrom ? { gte: dateFrom } : {}),
                      ...(dateTo ? { lte: dateTo } : {})
                    }
                  }
                : {})
            },
            select: {
              id: true,
              companyId: true,
              billId: true,
              payDate: true,
              amount: true,
              mode: true,
              txnRef: true,
              note: true,
              bankNameSnapshot: true
            },
            orderBy: [{ payDate: 'asc' }, { createdAt: 'asc' }]
          }),
          dateFrom
            ? prisma.salesBill.aggregate({
                where: {
                  companyId: { in: targetCompanyIds },
                  partyId: selectedPartyId,
                  billDate: { lt: dateFrom }
                },
                _sum: {
                  totalAmount: true
                }
              })
            : Promise.resolve(null),
          dateFrom
            ? prisma.payment.aggregate({
                where: {
                  companyId: { in: targetCompanyIds },
                  billType: 'sales',
                  partyId: selectedPartyId,
                  deletedAt: null,
                  payDate: { lt: dateFrom }
                },
                _sum: {
                  amount: true
                }
              })
            : Promise.resolve(null)
        ])
      : [[], [], null, null]

      const openingBalance = roundCurrency(
      (selectedParty
        ? getSignedPartyOpeningBalance(selectedParty.openingBalance, selectedParty.openingBalanceType)
        : 0) +
      normalizeNonNegative(openingSalesAggregate?._sum.totalAmount) -
        normalizeNonNegative(openingPaymentsAggregate?._sum.amount)
      )

      const ledgerPaymentBillIds = Array.from(new Set(ledgerPayments.map((payment) => payment.billId)))
      const ledgerBillMap =
      ledgerPaymentBillIds.length > 0
        ? new Map(
            (
              await prisma.salesBill.findMany({
                where: { id: { in: ledgerPaymentBillIds }, companyId: { in: targetCompanyIds } },
                select: { id: true, billNo: true }
              })
            ).map((bill) => [bill.id, bill.billNo])
          )
        : new Map<string, string>()

      const ledgerBaseRows = [
      ...ledgerSales.map((bill) => ({
        id: `sale-${bill.id}`,
        date: bill.billDate,
        type: 'sale' as PartyLedgerEntryType,
        refNo: String(bill.billNo || ''),
        description:
          bill.salesItems.length > 0
            ? bill.salesItems
                .map((item) => {
                  const detailBits = [String(item.product?.name || 'Item')]
                  if (normalizeNonNegative(item.weight) > 0) {
                    detailBits.push(`${roundCurrency(normalizeNonNegative(item.weight))} Qt.`)
                  }
                  if (Number(item.bags || 0) > 0) {
                    detailBits.push(`${Number(item.bags)} bags`)
                  }
                  if (normalizeNonNegative(item.rate) > 0) {
                    detailBits.push(`Rate ${roundCurrency(normalizeNonNegative(item.rate))}`)
                  }
                  return detailBits.join(' ')
                })
                .join(' | ')
            : 'Sales Bill',
        companyId: bill.companyId,
        companyName: companyNameMap.get(bill.companyId) || bill.companyId,
        paymentMode: '-',
        debit: roundCurrency(normalizeNonNegative(bill.totalAmount)),
        credit: 0,
        note: ''
      })),
      ...ledgerPayments.map((payment) => ({
        id: `payment-${payment.id}`,
        date: payment.payDate,
        type: 'receipt' as PartyLedgerEntryType,
        refNo: String(ledgerBillMap.get(payment.billId) || payment.txnRef || ''),
        description: isPartyOpeningBalanceReference(payment.billId) ? 'Opening Balance Receipt' : 'Payment Receipt',
        companyId: payment.companyId,
        companyName: companyNameMap.get(payment.companyId) || payment.companyId,
        paymentMode: formatPaymentMode(payment.mode),
        debit: 0,
        credit: roundCurrency(normalizeNonNegative(payment.amount)),
        note: String(payment.note || payment.bankNameSnapshot || '').trim()
      }))
    ].sort((a, b) => {
      const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime()
      if (dateDiff !== 0) return dateDiff
      if (a.type === b.type) return a.refNo.localeCompare(b.refNo)
      if (a.type === 'opening') return -1
      if (b.type === 'opening') return 1
      return a.type === 'sale' ? -1 : 1
    })

      let runningBalance = openingBalance
      const ledgerRows = needsLedgerView
      ? [
          ...(dateFrom || openingBalance !== 0
            ? [
                {
                  id: 'opening-balance',
                  date: searchParams.get('dateFrom') || '',
                  type: 'opening' as PartyLedgerEntryType,
                  refNo: '-',
                  description: 'Opening Balance',
                  companyId: selectedParty?.companyId || '',
                  companyName: selectedParty?.companyName || '',
                  paymentMode: '-',
                  debit: 0,
                  credit: 0,
                  note: '',
                  runningBalance
                }
              ]
            : []),
          ...ledgerBaseRows.map((row) => {
            runningBalance = roundCurrency(runningBalance + row.debit - row.credit)
            return {
              ...row,
              date: dateKey(row.date),
              runningBalance
            }
          })
        ]
      : []

      const totalLedgerSales = needsLedgerView
      ? roundCurrency(ledgerBaseRows.reduce((sum, row) => sum + row.debit, 0))
      : 0
      const totalLedgerReceipts = needsLedgerView
      ? roundCurrency(ledgerBaseRows.reduce((sum, row) => sum + row.credit, 0))
      : 0

      const dailySummaryMap = new Map<string, DailySummaryAccumulator>()
      const dailyTransactionRows: Array<{
      id: string
      date: string
      companyId: string
      companyName: string
      category: string
      type: string
      refNo: string
      partyName: string
      productName: string
      amount: number
      quantity: number
      direction: string
      paymentMode: string
      bankName: string
      note: string
    }> = []

      if (needsDailyView) {
      for (const bill of purchaseBills) {
      const key = dateKey(bill.billDate)
      const amount = roundCurrency(normalizeNonNegative(bill.totalAmount))
      const quantity = roundCurrency(
        bill.purchaseItems.reduce((sum, item) => sum + normalizeNonNegative(item.qty), 0)
      )
      const productName = formatProductNames(
        bill.purchaseItems.map((item) => item.productNameSnapshot || item.product?.name || '')
      )

      addDailyMetric(dailySummaryMap, key, bill.companyId, (row) => {
        row.totalPurchase += amount
      })

      dailyTransactionRows.push({
        id: `purchase-${bill.id}`,
        date: key,
        companyId: bill.companyId,
        companyName: companyNameMap.get(bill.companyId) || bill.companyId,
        category: 'purchase',
        type: 'Purchase',
        refNo: String(bill.billNo || ''),
        partyName: String(bill.farmerNameSnapshot || bill.farmer?.name || 'Farmer'),
        productName,
        amount,
        quantity,
        direction: 'OUT',
        paymentMode: '-',
        bankName: '-',
        note: 'Regular purchase'
      })
    }

      for (const bill of specialPurchaseBills) {
      const key = dateKey(bill.billDate)
      const amount = roundCurrency(normalizeNonNegative(bill.totalAmount))
      const quantity = roundCurrency(
        bill.specialPurchaseItems.reduce((sum, item) => sum + normalizeNonNegative(item.weight), 0)
      )
      const productName = formatProductNames(bill.specialPurchaseItems.map((item) => item.product?.name || ''))

      addDailyMetric(dailySummaryMap, key, bill.companyId, (row) => {
        row.totalPurchase += amount
      })

      dailyTransactionRows.push({
        id: `special-purchase-${bill.id}`,
        date: key,
        companyId: bill.companyId,
        companyName: companyNameMap.get(bill.companyId) || bill.companyId,
        category: 'purchase',
        type: 'Supplier Purchase',
        refNo: String(bill.supplierInvoiceNo || ''),
        partyName: String(bill.supplier?.name || 'Supplier'),
        productName,
        amount,
        quantity,
        direction: 'OUT',
        paymentMode: '-',
        bankName: '-',
        note: 'Special purchase'
      })
    }

      for (const bill of salesBills) {
      const key = dateKey(bill.billDate)
      const amount = roundCurrency(normalizeNonNegative(bill.totalAmount))
      const quantity = roundCurrency(
        bill.salesItems.reduce((sum, item) => sum + normalizeNonNegative(item.weight), 0)
      )
      const productName = formatProductNames(bill.salesItems.map((item) => item.product?.name || ''))

      addDailyMetric(dailySummaryMap, key, bill.companyId, (row) => {
        row.totalSales += amount
      })

      dailyTransactionRows.push({
        id: `sale-${bill.id}`,
        date: key,
        companyId: bill.companyId,
        companyName: companyNameMap.get(bill.companyId) || bill.companyId,
        category: 'sales',
        type: 'Sale',
        refNo: String(bill.billNo || ''),
        partyName: String(bill.party?.name || 'Buyer'),
        productName,
        amount,
        quantity,
        direction: 'IN',
        paymentMode: '-',
        bankName: '-',
        note: 'Sales bill'
      })
    }

      for (const payment of payments) {
      const key = dateKey(payment.payDate)
      const amount = roundCurrency(normalizeNonNegative(payment.amount))
      const isSalesReceipt = payment.billType === 'sales'
      const refNo = isSalesReceipt
        ? String(salesBillNoMap.get(payment.billId) || payment.txnRef || '')
        : String(purchaseBillNoMap.get(payment.billId) || specialPurchaseBillNoMap.get(payment.billId) || payment.txnRef || '')
      const bankName = String(payment.bankNameSnapshot || '').trim() || '-'

      addDailyMetric(dailySummaryMap, key, payment.companyId, (row) => {
        if (isSalesReceipt) {
          row.totalSalesReceipt += amount
        } else {
          row.totalPurchasePayment += amount
        }
      })

      dailyTransactionRows.push({
        id: `payment-${payment.id}`,
        date: key,
        companyId: payment.companyId,
        companyName: companyNameMap.get(payment.companyId) || payment.companyId,
        category: isSalesReceipt ? 'payment-in' : 'payment-out',
        type: isSalesReceipt ? 'Sales Receipt' : 'Purchase Payment',
        refNo,
        partyName: String(payment.party?.name || payment.farmer?.name || ''),
        productName: '-',
        amount,
        quantity: 0,
        direction: isSalesReceipt ? 'IN' : 'OUT',
        paymentMode: formatPaymentMode(payment.mode),
        bankName,
        note: String(payment.note || '').trim() || formatPaymentMode(payment.mode)
      })
    }

      for (const entry of stockAdjustments) {
      const key = dateKey(entry.entryDate)
      const quantityIn = roundCurrency(normalizeNonNegative(entry.qtyIn))
      const quantityOut = roundCurrency(normalizeNonNegative(entry.qtyOut))
      const adjustmentQty = roundCurrency(quantityIn + quantityOut)

      addDailyMetric(dailySummaryMap, key, entry.companyId, (row) => {
        row.totalStockAdjustmentQty += adjustmentQty
      })

      dailyTransactionRows.push({
        id: `adjustment-${entry.id}`,
        date: key,
        companyId: entry.companyId,
        companyName: companyNameMap.get(entry.companyId) || entry.companyId,
        category: 'stock-adjustment',
        type: quantityIn > 0 ? 'Stock Adjustment In' : 'Stock Adjustment Out',
        refNo: String(entry.refId || ''),
        partyName: '-',
        productName: String(entry.product?.name || '-'),
        amount: 0,
        quantity: adjustmentQty,
        direction: quantityIn > 0 ? 'IN' : 'OUT',
        paymentMode: '-',
        bankName: '-',
        note: 'Stock adjustment'
      })
    }
      }

      const dailySummaryRows = Array.from(dailySummaryMap.values())
      .map((row) => ({
        date: row.date,
        totalSales: roundCurrency(row.totalSales),
        totalPurchase: roundCurrency(row.totalPurchase),
        totalStockAdjustmentQty: roundCurrency(row.totalStockAdjustmentQty),
        totalPurchasePayment: roundCurrency(row.totalPurchasePayment),
        totalSalesReceipt: roundCurrency(row.totalSalesReceipt),
        netCashflow: roundCurrency(row.totalSalesReceipt - row.totalPurchasePayment),
        transactionCount: row.transactionCount,
        companyCount: row.companyIds.size
      }))
      .sort((a, b) => b.date.localeCompare(a.date))

      const bankLedgerRows = needsBankLedgerView
      ? payments
          .filter((payment) => isBankLikePayment(payment))
          .map((payment) => {
            const isSalesReceipt = payment.billType === 'sales'
            const amount = roundCurrency(normalizeNonNegative(payment.amount))
            const billNo = isSalesReceipt
              ? String(salesBillNoMap.get(payment.billId) || '')
              : String(purchaseBillNoMap.get(payment.billId) || specialPurchaseBillNoMap.get(payment.billId) || '')
            return {
              id: payment.id,
              date: dateKey(payment.payDate),
              companyId: payment.companyId,
              companyName: companyNameMap.get(payment.companyId) || payment.companyId,
              direction: isSalesReceipt ? 'IN' : 'OUT',
              billType: payment.billType === 'sales' ? 'Sales' : 'Purchase',
              billNo,
              refNo: billNo || String(payment.txnRef || ''),
              partyName: String(payment.party?.name || payment.farmer?.name || ''),
              bankName: String(payment.bankNameSnapshot || '').trim() || 'Bank / Online',
              mode: formatPaymentMode(payment.mode),
              amountIn: roundCurrency(isSalesReceipt ? amount : 0),
              amountOut: roundCurrency(!isSalesReceipt ? amount : 0),
              txnRef: String(payment.txnRef || ''),
              ifscCode: String(payment.ifscCode || ''),
              accountNo: String(payment.beneficiaryBankAccount || ''),
              note: String(payment.note || payment.bankBranchSnapshot || '')
            }
          })
          .sort((a, b) => b.date.localeCompare(a.date) || a.partyName.localeCompare(b.partyName))
      : []

      const paymentTotalsMap = new Map(
      paymentTotalsByType.map((row) => [row.billType, normalizeNonNegative(row._sum.amount)])
      )
      const totalSaleAmount = roundCurrency(normalizeNonNegative(salesTotalAggregate._sum.totalAmount))
      const totalPurchaseAmount = roundCurrency(
      normalizeNonNegative(purchaseTotalAggregate._sum.totalAmount) +
        normalizeNonNegative(specialPurchaseTotalAggregate._sum.totalAmount)
      )
      const totalPaidAmount = roundCurrency(paymentTotalsMap.get('purchase') || 0)
      const totalReceivedAmount = roundCurrency(paymentTotalsMap.get('sales') || 0)
      const purchaseBalanceTotal = roundCurrency(
      purchaseBillsAsOf.reduce(
        (sum, bill) => sum + Math.max(0, normalizeNonNegative(bill.totalAmount) - (purchasePaidByBillId.get(bill.id) || 0)),
        0
      ) +
        specialPurchaseBillsAsOf.reduce(
          (sum, bill) => sum + Math.max(0, normalizeNonNegative(bill.totalAmount) - (purchasePaidByBillId.get(bill.id) || 0)),
          0
        )
      )
      const salesBalanceTotal = roundCurrency(
      salesBillsAsOf.reduce(
        (sum, bill) => sum + Math.max(0, normalizeNonNegative(bill.totalAmount) - (salesReceiptByBillId.get(bill.id) || 0)),
        0
      )
      )
      const totalBalance = roundCurrency(purchaseBalanceTotal + salesBalanceTotal)
      const netOutstanding = roundCurrency(salesBalanceTotal - purchaseBalanceTotal)
      const totalStockAdjustmentQty = roundCurrency(
      normalizeNonNegative(stockAdjustmentAggregate._sum.qtyIn) + normalizeNonNegative(stockAdjustmentAggregate._sum.qtyOut)
      )

      return {
      companies: permittedCompanies,
      summary: {
        totalSaleAmount,
        totalPurchaseAmount,
        totalPaidAmount,
        totalReceivedAmount,
        totalBalance,
        netOutstanding,
        salesBalanceTotal,
        purchaseBalanceTotal,
        totalStockAdjustmentQty
      },
      outstanding: requestedView === 'outstanding' ? outstandingRows : [],
      parties: needsLedgerView ? partiesWithContext : [],
      partyLedger: needsLedgerView
        ? {
            selectedPartyId,
            selectedPartyName: selectedParty?.name || '',
            selectedPartyCompanyName: selectedParty?.companyName || '',
            openingBalance,
            totalSales: totalLedgerSales,
            totalReceipts: totalLedgerReceipts,
            closingBalance: ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].runningBalance : openingBalance,
            rows: ledgerRows
          }
        : undefined,
      dailyTransactions: needsDailyView
        ? dailyTransactionRows.sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type))
        : [],
      dailyTransactionSummary: needsDailyView ? dailySummaryRows : [],
      dailyConsolidated: requestedView === 'daily-consolidated' ? dailySummaryRows : [],
      bankLedger: needsBankLedgerView ? bankLedgerRows : [],
      filterOptions: {
        banks: needsBankLedgerView
          ? Array.from(new Set(bankLedgerRows.map((row) => row.bankName).filter(Boolean))).sort((a, b) => a.localeCompare(b))
          : []
      },
      meta: {
        scope: 'company',
        companyIds: targetCompanyIds,
        companyId: targetCompanyIds[0] || '',
        companyName: selectedCompanyName,
        companyAddress: selectedCompanyDetail?.address || '',
        companyPhone: selectedCompanyDetail?.phone || '',
        canAggregateCompanies: aggregateEligibleCompanyIds.length > 1,
        bankSync: {
          activeProvider: 'manual',
          providers: bankSyncProviders
        },
        dateFrom: searchParams.get('dateFrom') || '',
        dateTo: searchParams.get('dateTo') || '',
        generatedAt: new Date().toISOString()
      }
      }
    })

    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
