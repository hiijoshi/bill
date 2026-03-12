import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export interface StockUpdateResult {
  success: boolean
  message?: string
  stockLedgerEntries?: any[]
}

export async function updateStockOnPurchase(
  companyId: string,
  purchaseBillId: string,
  items: Array<{
    productId: string
    qty: number
    rate: number
    amount: number
  }>
): Promise<StockUpdateResult> {
  try {
    const stockLedgerEntries = []

    for (const item of items) {
      // Create stock ledger entry for purchase
      const stockEntry = await prisma.stockLedger.create({
        data: {
          companyId,
          productId: item.productId,
          entryDate: new Date(),
          type: 'purchase',
          qtyIn: item.qty,
          qtyOut: 0,
          refTable: 'purchase_bills',
          refId: purchaseBillId,
        }
      })
      stockLedgerEntries.push(stockEntry)
    }

    return {
      success: true,
      message: `Stock updated for ${items.length} purchase items`,
      stockLedgerEntries
    }
  } catch (error) {
    console.error('Error updating stock on purchase:', error)
    return {
      success: false,
      message: 'Failed to update stock on purchase'
    }
  }
}

export async function updateStockOnSales(
  companyId: string,
  salesBillId: string,
  items: Array<{
    productId: string
    weight: number
    rate: number
    amount: number
  }>
): Promise<StockUpdateResult> {
  try {
    const stockLedgerEntries = []

    for (const item of items) {
      // Check current stock availability
      const currentStock = await getCurrentStock(companyId, item.productId)
      
      if (currentStock < item.weight) {
        return {
          success: false,
          message: `Insufficient stock for product. Available: ${currentStock}, Required: ${item.weight}`
        }
      }

      // Create stock ledger entry for sales
      const stockEntry = await prisma.stockLedger.create({
        data: {
          companyId,
          productId: item.productId,
          entryDate: new Date(),
          type: 'sales',
          qtyIn: 0,
          qtyOut: item.weight,
          refTable: 'sales_bills',
          refId: salesBillId,
        }
      })
      stockLedgerEntries.push(stockEntry)
    }

    return {
      success: true,
      message: `Stock updated for ${items.length} sales items`,
      stockLedgerEntries
    }
  } catch (error) {
    console.error('Error updating stock on sales:', error)
    return {
      success: false,
      message: 'Failed to update stock on sales'
    }
  }
}

export async function getCurrentStock(companyId: string, productId: string): Promise<number> {
  try {
    const stockSummary = await prisma.stockLedger.groupBy({
      by: ['productId'],
      where: {
        companyId,
        productId
      },
      _sum: {
        qtyIn: true,
        qtyOut: true
      }
    })

    if (stockSummary.length === 0) {
      return 0
    }

    const summary = stockSummary[0]
    const totalIn = summary._sum.qtyIn || 0
    const totalOut = summary._sum.qtyOut || 0
    
    return totalIn - totalOut
  } catch (error) {
    console.error('Error getting current stock:', error)
    return 0
  }
}

export async function getAllProductStock(companyId: string): Promise<Array<{
  productId: string
  productName: string
  currentStock: number
  lastUpdated: Date
}>> {
  try {
    const stockSummary = await prisma.stockLedger.groupBy({
      by: ['productId'],
      where: {
        companyId
      },
      _sum: {
        qtyIn: true,
        qtyOut: true
      },
      _max: {
        entryDate: true
      }
    })

    const productIds = stockSummary.map(item => item.productId)
    
    // Get product details
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        companyId
      },
      select: {
        id: true,
        name: true
      }
    })

    const productMap = new Map(products.map(p => [p.id, p.name]))

    return stockSummary.map(summary => ({
      productId: summary.productId,
      productName: productMap.get(summary.productId) || 'Unknown Product',
      currentStock: (summary._sum.qtyIn || 0) - (summary._sum.qtyOut || 0),
      lastUpdated: summary._max.entryDate || new Date()
    }))
  } catch (error) {
    console.error('Error getting all product stock:', error)
    return []
  }
}

export async function getLowStockProducts(
  companyId: string,
  threshold: number = 10
): Promise<Array<{
  productId: string
  productName: string
  currentStock: number
  lastUpdated: Date
}>> {
  try {
    const allStock = await getAllProductStock(companyId)
    return allStock.filter(item => item.currentStock <= threshold)
  } catch (error) {
    console.error('Error getting low stock products:', error)
    return []
  }
}

export async function createStockAdjustment(
  companyId: string,
  productId: string,
  adjustmentType: 'increase' | 'decrease',
  quantity: number,
  reason: string
): Promise<StockUpdateResult> {
  try {
    if (quantity <= 0) {
      return {
        success: false,
        message: 'Quantity must be greater than 0'
      }
    }

    const stockEntry = await prisma.stockLedger.create({
      data: {
        companyId,
        productId,
        entryDate: new Date(),
        type: 'adjustment',
        qtyIn: adjustmentType === 'increase' ? quantity : 0,
        qtyOut: adjustmentType === 'decrease' ? quantity : 0,
        refTable: 'stock_adjustments',
        refId: `manual_${Date.now()}`,
      }
    })

    return {
      success: true,
      message: `Stock ${adjustmentType}d by ${quantity} units. Reason: ${reason}`,
      stockLedgerEntries: [stockEntry]
    }
  } catch (error) {
    console.error('Error creating stock adjustment:', error)
    return {
      success: false,
      message: 'Failed to create stock adjustment'
    }
  }
}

export async function validateStockBeforeSale(
  companyId: string,
  items: Array<{ productId: string; weight: number }>
): Promise<{
  isValid: boolean
  message?: string
  stockDetails?: Array<{ productId: string; available: number; required: number }>
}> {
  try {
    const stockDetails = []
    
    for (const item of items) {
      const currentStock = await getCurrentStock(companyId, item.productId)
      stockDetails.push({
        productId: item.productId,
        available: currentStock,
        required: item.weight
      })
      
      if (currentStock < item.weight) {
        return {
          isValid: false,
          message: `Insufficient stock for product ${item.productId}. Available: ${currentStock}, Required: ${item.weight}`,
          stockDetails
        }
      }
    }

    return {
      isValid: true,
      message: 'All products have sufficient stock',
      stockDetails
    }
  } catch (error) {
    console.error('Error validating stock before sale:', error)
    return {
      isValid: false,
      message: 'Failed to validate stock availability'
    }
  }
}
