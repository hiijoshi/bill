const DEFAULT_PURCHASE_PRODUCT_KEY = 'default_purchase_product'

function buildKey(companyId: string): string {
  return `${DEFAULT_PURCHASE_PRODUCT_KEY}:${companyId}`
}

export function getDefaultPurchaseProductId(companyId: string): string {
  if (typeof window === 'undefined' || !companyId) return ''
  return window.localStorage.getItem(buildKey(companyId)) || ''
}

export function setDefaultPurchaseProductId(companyId: string, productId: string): void {
  if (typeof window === 'undefined' || !companyId || !productId) return
  window.localStorage.setItem(buildKey(companyId), productId)
}

export function clearDefaultPurchaseProductId(companyId: string): void {
  if (typeof window === 'undefined' || !companyId) return
  window.localStorage.removeItem(buildKey(companyId))
}
