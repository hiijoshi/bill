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

export function deleteClientCache(key: string): void {
  cacheStore.delete(key)
}

export function deleteClientCacheByPrefix(prefix: string): void {
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) {
      cacheStore.delete(key)
    }
  }
}

export function clearClientCache(): void {
  cacheStore.clear()
}
