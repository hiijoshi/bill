import { createClient, RedisClientType } from 'redis'

type CacheEntry<T> = {
  data: T
  expiresAt: number
}

const serverCache = new Map<string, CacheEntry<unknown>>()
const pendingLoads = new Map<string, Promise<unknown>>()

let redisClient: RedisClientType | null = null

async function getRedisClient(): Promise<RedisClientType | null> {
  if (redisClient) return redisClient

  if (!process.env.REDIS_URL) {
    console.log('REDIS_URL not set, using in-memory cache')
    return null
  }

  try {
    redisClient = createClient({ url: process.env.REDIS_URL })
    await redisClient.connect()
    console.log('Connected to Redis for caching')
    return redisClient
  } catch (error) {
    console.error('Failed to connect to Redis:', error)
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
    console.error('Redis cache get error:', error)
    return null
  }
}

async function setRedisCache<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  const client = await getRedisClient()
  if (!client) return

  try {
    await client.setEx(key, Math.ceil((entry.expiresAt - Date.now()) / 1000), JSON.stringify(entry))
  } catch (error) {
    console.error('Redis cache set error:', error)
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
        await client.del(keys)
      }
    } catch (error) {
      console.error('Redis cache clear error:', error)
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
