import { createClient, RedisClientType } from 'redis'

type CacheEntry<T> = {
  data: T
  expiresAt: number
}

const serverCache = new Map<string, CacheEntry<unknown>>()
const pendingLoads = new Map<string, Promise<unknown>>()

let redisClient: RedisClientType | null = null
let redisDisabled = false
const REDIS_CONNECT_TIMEOUT_MS = Math.max(
  250,
  Math.min(5_000, Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 1_000))
)

function logCacheWarning(message: string, error?: unknown) {
  if (process.env.NODE_ENV !== 'development') {
    return
  }

  if (error) {
    console.error(message, error)
    return
  }

  console.warn(message)
}

async function getRedisClient(): Promise<RedisClientType | null> {
  if (redisDisabled) {
    return null
  }

  if (redisClient) return redisClient

  if (!process.env.REDIS_URL) {
    return null
  }

  let candidateClient: RedisClientType | null = null
  try {
    candidateClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        reconnectStrategy: false
      }
    })
    candidateClient.on('error', () => {
      // Connection failures are handled during get/set calls. Avoid noisy server logs.
    })
    await candidateClient.connect()
    redisClient = candidateClient
    return redisClient
  } catch (error) {
    redisDisabled = true
    if (candidateClient) {
      try {
        candidateClient.destroy()
      } catch {
        // Ignore teardown failures after a failed connect attempt.
      }
    }
    if (redisClient) {
      try {
        redisClient.destroy()
      } catch {
        // Ignore teardown failures after a failed connect attempt.
      }
      redisClient = null
    }
    logCacheWarning('Failed to connect to Redis for caching. Falling back to in-memory cache.', error)
    return null
  }
}

export function makeServerCacheKey(prefix: string, parts: unknown[]): string {
  return `${prefix}:${JSON.stringify(parts)}`
}

async function getRedisCache<T>(key: string): Promise<T | null> {
  const client = await getRedisClient()
  if (!client) return null

  try {
    const raw = await client.get(key)
    if (!raw) return null
    const entry: CacheEntry<T> = JSON.parse(raw)
    if (entry.expiresAt < Date.now()) {
      await client.del(key)
      return null
    }
    return entry.data
  } catch (error) {
    logCacheWarning('Redis cache get error', error)
    return null
  }
}

async function setRedisCache<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  const client = await getRedisClient()
  if (!client) return

  try {
    await client.setEx(key, Math.ceil((entry.expiresAt - Date.now()) / 1000), JSON.stringify(entry))
  } catch (error) {
    logCacheWarning('Redis cache set error', error)
  }
}

export async function getOrSetServerCache<T>(
  key: string,
  maxAgeMs: number,
  loader: () => Promise<T>
): Promise<T> {
  // Try Redis first
  const redisData = await getRedisCache<T>(key)
  if (redisData !== null) {
    return redisData
  }

  // Fallback to in-memory
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
    .then(async (data) => {
      const entry: CacheEntry<T> = {
        data,
        expiresAt: Date.now() + maxAgeMs
      }

      // Set in Redis
      await setRedisCache(key, entry)

      // Also set in memory as backup
      serverCache.set(key, entry)

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

export async function clearServerCacheByPrefix(prefix: string): Promise<void> {
  // Clear Redis
  const client = await getRedisClient()
  if (client) {
    try {
      const keys = await client.keys(`${prefix}*`)
      if (keys.length > 0) {
        await (client.del as (...values: string[]) => Promise<number>)(...keys)
      }
    } catch (error) {
      logCacheWarning('Redis cache clear error', error)
    }
  }

  // Clear in-memory
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
