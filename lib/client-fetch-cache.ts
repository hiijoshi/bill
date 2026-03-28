type CacheEntry<T> = {
  data: T
  updatedAt: number
}

type CacheOptions = {
  persist?: boolean
}

const cacheStore = new Map<string, CacheEntry<unknown>>()
const STORAGE_PREFIX = 'mbill-cache:'

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null

  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function toStorageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`
}

function removePersistedEntry(key: string): void {
  const storage = getSessionStorage()
  if (!storage) return

  try {
    storage.removeItem(toStorageKey(key))
  } catch {
    // Ignore storage failures and keep in-memory cache functional.
  }
}

function readPersistedEntry<T>(key: string): CacheEntry<T> | null {
  const storage = getSessionStorage()
  if (!storage) return null

  try {
    const raw = storage.getItem(toStorageKey(key))
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<CacheEntry<T>> | null
    if (!parsed || typeof parsed !== 'object' || typeof parsed.updatedAt !== 'number' || !('data' in parsed)) {
      storage.removeItem(toStorageKey(key))
      return null
    }

    return {
      data: parsed.data as T,
      updatedAt: parsed.updatedAt
    }
  } catch {
    removePersistedEntry(key)
    return null
  }
}

function writePersistedEntry<T>(key: string, entry: CacheEntry<T>): void {
  const storage = getSessionStorage()
  if (!storage) return

  try {
    storage.setItem(toStorageKey(key), JSON.stringify(entry))
  } catch {
    // Ignore quota/private-mode errors and keep the in-memory cache available.
  }
}

export function getClientCache<T>(key: string, maxAgeMs: number): T | null {
  let entry = cacheStore.get(key) as CacheEntry<T> | undefined
  if (!entry) {
    entry = readPersistedEntry<T>(key) || undefined
    if (entry) {
      cacheStore.set(key, entry)
    }
  }
  if (!entry) return null
  if (Date.now() - entry.updatedAt > maxAgeMs) {
    cacheStore.delete(key)
    removePersistedEntry(key)
    return null
  }
  return entry.data as T
}

export function setClientCache<T>(key: string, data: T, options: CacheOptions = {}): void {
  const entry: CacheEntry<T> = {
    data,
    updatedAt: Date.now()
  }

  cacheStore.set(key, entry)

  if (options.persist) {
    writePersistedEntry(key, entry)
  }
}

export function deleteClientCache(key: string): void {
  cacheStore.delete(key)
  removePersistedEntry(key)
}

export function deleteClientCacheByPrefix(prefix: string): void {
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) {
      cacheStore.delete(key)
    }
  }

  const storage = getSessionStorage()
  if (!storage) return

  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const rawKey = storage.key(index)
      if (!rawKey || !rawKey.startsWith(STORAGE_PREFIX)) continue
      const key = rawKey.slice(STORAGE_PREFIX.length)
      if (key.startsWith(prefix)) {
        storage.removeItem(rawKey)
      }
    }
  } catch {
    // Ignore storage failures and keep in-memory cache functional.
  }
}

export function clearClientCache(): void {
  cacheStore.clear()

  const storage = getSessionStorage()
  if (!storage) return

  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const rawKey = storage.key(index)
      if (rawKey?.startsWith(STORAGE_PREFIX)) {
        storage.removeItem(rawKey)
      }
    }
  } catch {
    // Ignore storage failures and keep in-memory cache functional.
  }
}
