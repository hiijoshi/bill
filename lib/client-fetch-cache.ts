type CacheEntry<T> = {
  data: T
  updatedAt: number
}

const cacheStore = new Map<string, CacheEntry<unknown>>()

export function getClientCache<T>(key: string, maxAgeMs: number): T | null {
  const entry = cacheStore.get(key)
  if (!entry) return null
  if (Date.now() - entry.updatedAt > maxAgeMs) return null
  return entry.data as T
}

export function setClientCache<T>(key: string, data: T): void {
  cacheStore.set(key, {
    data,
    updatedAt: Date.now()
  })
}
