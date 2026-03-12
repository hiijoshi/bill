export const PERMISSION_MODULES = [
  'MASTER_PRODUCTS',
  'MASTER_PARTIES',
  'MASTER_UNITS',
  'MASTER_TRANSPORT',
  'MASTER_BANK',
  'MASTER_MARKA',
  'MASTER_PAYMENT_MODE',
  'MASTER_SALES_ITEM',
  'PURCHASE_ENTRY',
  'PURCHASE_LIST',
  'SALES_ENTRY',
  'SALES_LIST',
  'STOCK_ADJUSTMENT',
  'STOCK_DASHBOARD',
  'PAYMENTS',
  'REPORTS'
] as const

export type PermissionModule = (typeof PERMISSION_MODULES)[number]
export type PermissionAction = 'read' | 'write'

export type RoutePermission = {
  module: PermissionModule
  action: PermissionAction
}

export const PERMISSION_MODULE_LABELS: Record<PermissionModule, string> = {
  MASTER_PRODUCTS: 'Master Products',
  MASTER_PARTIES: 'Master Parties/Farmers/Suppliers',
  MASTER_UNITS: 'Master Units',
  MASTER_TRANSPORT: 'Master Transport',
  MASTER_BANK: 'Master Bank',
  MASTER_MARKA: 'Master Marka',
  MASTER_PAYMENT_MODE: 'Master Payment Mode',
  MASTER_SALES_ITEM: 'Master Sales Item',
  PURCHASE_ENTRY: 'Purchase Entry',
  PURCHASE_LIST: 'Purchase List',
  SALES_ENTRY: 'Sales Entry',
  SALES_LIST: 'Sales List',
  STOCK_ADJUSTMENT: 'Stock Adjustment',
  STOCK_DASHBOARD: 'Stock Dashboard',
  PAYMENTS: 'Payments',
  REPORTS: 'Reports'
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }
  return pathname
}

function getActionFromMethod(method: string): PermissionAction {
  return WRITE_METHODS.has(method.toUpperCase()) ? 'write' : 'read'
}

export function resolveRoutePermission(pathname: string, method: string): RoutePermission | null {
  const path = normalizePath(pathname)
  const action = getActionFromMethod(method)

  if (path.startsWith('/api/products')) {
    return { module: 'MASTER_PRODUCTS', action }
  }

  if (path.startsWith('/api/parties') || path.startsWith('/api/farmers') || path.startsWith('/api/suppliers')) {
    return { module: 'MASTER_PARTIES', action }
  }

  if (path.startsWith('/api/units')) {
    return { module: 'MASTER_UNITS', action }
  }

  if (path.startsWith('/api/transports')) {
    return { module: 'MASTER_TRANSPORT', action }
  }

  if (path.startsWith('/api/banks')) {
    return { module: 'MASTER_BANK', action }
  }

  if (path.startsWith('/api/markas')) {
    return { module: 'MASTER_MARKA', action }
  }

  if (path.startsWith('/api/payment-modes')) {
    return { module: 'MASTER_PAYMENT_MODE', action }
  }

  if (path.startsWith('/api/sales-item-masters') || path.startsWith('/api/sales-items')) {
    return { module: 'MASTER_SALES_ITEM', action }
  }

  if (path.startsWith('/api/purchase-bills') || path.startsWith('/api/special-purchase-bills')) {
    return {
      module: action === 'read' ? 'PURCHASE_LIST' : 'PURCHASE_ENTRY',
      action
    }
  }

  if (path.startsWith('/api/sales-bills') || path.startsWith('/api/sales-invoices')) {
    return {
      module: action === 'read' ? 'SALES_LIST' : 'SALES_ENTRY',
      action
    }
  }

  if (path.startsWith('/api/stock/adjustment')) {
    return { module: 'STOCK_ADJUSTMENT', action }
  }

  if (path.startsWith('/api/stock-ledger')) {
    return { module: 'STOCK_DASHBOARD', action }
  }

  if (path.startsWith('/api/payments')) {
    return { module: 'PAYMENTS', action }
  }

  if (path.startsWith('/api/reports')) {
    return { module: 'REPORTS', action }
  }

  return null
}
