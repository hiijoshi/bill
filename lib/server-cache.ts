type CacheEntry<T> = {
  data: T
  expiresAt: number
}

const serverCache = new Map<string, CacheEntry<unknown>>()
const pendingLoads = new Map<string, Promise<unknown>>()

export function makeServerCacheKey(prefix: string, parts: unknown[]): string {
  return `${prefix}:${JSON.stringify(parts)}`
}

export async function getOrSetServerCache<T>(
  key: string,
  maxAgeMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now()
  const cached = serverCache.get(key)
  if (cached && cached.expiresAt > now) {
    return cached.data as T
  }

  const pending = pendingLoads.get(key)
  if (pending) {
    return pending as Promise<T>
  }

  const nextLoad = loader()
    .then((data) => {
      serverCache.set(key, {
        data,
        expiresAt: Date.now() + maxAgeMs
      })
      pendingLoads.delete(key)
      return data
    })
    .catch((error) => {
      pendingLoads.delete(key)
      throw error
    })

  pendingLoads.set(key, nextLoad)
  return nextLoad
}

export function clearServerCacheByPrefix(prefix: string): void {
  for (const key of serverCache.keys()) {
    if (key.startsWith(prefix)) {
      serverCache.delete(key)
    }
  }
  for (const key of pendingLoads.keys()) {
    if (key.startsWith(prefix)) {
      pendingLoads.delete(key)
    }
  }
}
