import { PERMISSION_MODULES, type PermissionModule } from '@/lib/permissions'

export type PermissionAccessRow = {
  module?: string | null
  canRead?: boolean | null
  canWrite?: boolean | null
}

const APP_ROUTE_PRIORITY: Array<{ module: PermissionModule; href: string }> = [
  { module: 'DASHBOARD', href: '/main/dashboard' },
  { module: 'PURCHASE_LIST', href: '/purchase/list' },
  { module: 'PURCHASE_ENTRY', href: '/purchase/entry' },
  { module: 'SALES_LIST', href: '/sales/list' },
  { module: 'SALES_ENTRY', href: '/sales/entry' },
  { module: 'PAYMENTS', href: '/payment/dashboard' },
  { module: 'REPORTS', href: '/reports/main' },
  { module: 'STOCK_DASHBOARD', href: '/stock/dashboard' },
  { module: 'STOCK_ADJUSTMENT', href: '/stock/adjustment' },
  { module: 'MASTER_PRODUCTS', href: '/master/product' },
  { module: 'MASTER_PARTIES', href: '/master/party' },
  { module: 'MASTER_SALES_ITEM', href: '/master/sales-item' },
  { module: 'MASTER_MARKA', href: '/master/marka' },
  { module: 'MASTER_TRANSPORT', href: '/master/transport' },
  { module: 'MASTER_UNITS', href: '/master/unit' },
  { module: 'MASTER_PAYMENT_MODE', href: '/master/payment-mode' },
  { module: 'MASTER_ACCOUNTING_HEAD', href: '/master/accounting-head' },
  { module: 'MASTER_BANK', href: '/master/bank' }
]

const PERMISSION_MODULE_SET = new Set<string>(PERMISSION_MODULES)

function isPermissionModule(value: string): value is PermissionModule {
  return PERMISSION_MODULE_SET.has(value)
}

export function withCompanyId(path: string, companyId?: string | null): string {
  void companyId
  // Active company context is persisted in the session cookie/cache, so we keep
  // internal app URLs clean instead of exposing stale company ids in the address bar.
  return path
}

export function getReadablePermissionModules(rows: PermissionAccessRow[]): PermissionModule[] {
  const modules = new Set<PermissionModule>()

  for (const row of rows) {
    const moduleName = typeof row?.module === 'string' ? row.module.trim() : ''
    if (!moduleName || !isPermissionModule(moduleName)) continue
    if (row.canRead || row.canWrite) {
      modules.add(moduleName)
    }
  }

  return Array.from(modules)
}

export function resolveFirstAccessibleAppRoute(
  rows: PermissionAccessRow[],
  companyId?: string | null
): string {
  const readableModules = new Set(getReadablePermissionModules(rows))

  for (const entry of APP_ROUTE_PRIORITY) {
    if (readableModules.has(entry.module)) {
      return withCompanyId(entry.href, companyId)
    }
  }

  return withCompanyId('/main/profile', companyId)
}
