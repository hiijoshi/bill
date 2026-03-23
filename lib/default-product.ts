const DEFAULT_PURCHASE_PRODUCT_KEY = 'default_purchase_product'
const memoryStore = new Map<string, string>()

function buildKey(companyId: string): string {
  return `${DEFAULT_PURCHASE_PRODUCT_KEY}:${companyId}`
}

export function getDefaultPurchaseProductId(companyId: string): string {
  if (!companyId) return ''
  return memoryStore.get(buildKey(companyId)) || ''
}

export function setDefaultPurchaseProductId(companyId: string, productId: string): void {
  if (!companyId || !productId) return
  memoryStore.set(buildKey(companyId), productId)
}

export function clearDefaultPurchaseProductId(companyId: string): void {
  if (!companyId) return
  memoryStore.delete(buildKey(companyId))
}
