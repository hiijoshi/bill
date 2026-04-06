import { prisma } from '@/lib/prisma'
import { loadPaymentsListData } from '@/lib/server-payment-workspace'

export type ReportDashboardType = 'main' | 'purchase' | 'sales'

export async function loadReportDashboardData(
  companyId: string,
  reportType: ReportDashboardType,
  options?: {
    loadPurchase?: boolean
    loadSales?: boolean
    loadPayments?: boolean
    loadBanks?: boolean
  }
) {
  const purchaseEnabled = (options?.loadPurchase ?? true) && reportType !== 'sales'
  const salesEnabled = (options?.loadSales ?? true) && reportType !== 'purchase'
  const paymentsEnabled = options?.loadPayments ?? true
  const banksEnabled = options?.loadBanks ?? true

  const [purchaseBills, specialPurchaseBills, salesBills, paymentsResult, banks] = await Promise.all([
    purchaseEnabled
      ? prisma.purchaseBill.findMany({
          where: {
            companyId,
            status: { not: 'cancelled' }
          },
          select: {
            id: true,
            companyId: true,
            billNo: true,
            billDate: true,
            totalAmount: true,
            paidAmount: true,
            balanceAmount: true,
            status: true,
            farmerNameSnapshot: true,
            farmerAddressSnapshot: true,
            farmerContactSnapshot: true,
            krashakAnubandhSnapshot: true,
            farmer: {
              select: {
                name: true,
                address: true,
                phone1: true,
                krashakAnubandhNumber: true,
                ifscCode: true,
                accountNo: true,
                bankName: true
              }
            },
            purchaseItems: {
              select: {
                qty: true,
                bags: true,
                rate: true,
                hammali: true
              }
            }
          },
          orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
        })
      : Promise.resolve([]),
    purchaseEnabled
      ? prisma.specialPurchaseBill.findMany({
          where: {
            companyId,
            status: { not: 'cancelled' }
          },
          select: {
            id: true,
            companyId: true,
            supplierInvoiceNo: true,
            billDate: true,
            totalAmount: true,
            paidAmount: true,
            balanceAmount: true,
            status: true,
            supplier: {
              select: {
                name: true,
                address: true,
                phone1: true,
                gstNumber: true,
                ifscCode: true,
                bankName: true,
                accountNo: true
              }
            },
            specialPurchaseItems: {
              select: {
                noOfBags: true,
                weight: true,
                rate: true,
                otherAmount: true
              }
            }
          },
          orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
        })
      : Promise.resolve([]),
    salesEnabled
      ? prisma.salesBill.findMany({
          where: {
            companyId,
            status: { not: 'cancelled' }
          },
          select: {
            id: true,
            companyId: true,
            billNo: true,
            billDate: true,
            totalAmount: true,
            receivedAmount: true,
            balanceAmount: true,
            status: true,
            party: {
              select: {
                name: true,
                address: true,
                phone1: true
              }
            },
            salesItems: {
              select: {
                weight: true,
                bags: true,
                rate: true
              }
            }
          },
          orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
        })
      : Promise.resolve([]),
    paymentsEnabled
      ? loadPaymentsListData({
          companyIds: [companyId],
          view: 'report'
        })
      : Promise.resolve({ rows: [], total: 0 }),
    banksEnabled
      ? prisma.bank.findMany({
          where: {
            companyId
          },
          select: {
            name: true,
            ifscCode: true
          },
          orderBy: {
            name: 'asc'
          }
        })
      : Promise.resolve([])
  ])

  return {
    purchaseBills,
    specialPurchaseBills,
    salesBills,
    payments: paymentsResult.rows,
    banks
  }
}
