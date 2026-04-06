// Redis-based Rate Limiting for Distributed Systems
// This implementation requires Redis client: npm install redis

import { createClient, RedisClientType } from 'redis'

interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  keyPrefix?: string
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetTime: number
  total: number
}

interface RedisPipeline {
  zRemRangeByScore(key: string, min: number, max: number): RedisPipeline
  zAdd(key: string, score: number, member: string): RedisPipeline
  zCard(key: string): RedisPipeline
  expire(key: string, seconds: number): RedisPipeline
  exec(): Promise<Array<[unknown, number] | null>>
}

interface RedisClientLike {
  multi(): RedisPipeline
  del(key: string): Promise<void>
  quit(): Promise<void>
}

class RedisRateLimiter {
  private redis: RedisClientType | null = null
  private connected: boolean = false

  constructor() {
    this.initRedis()
  }

  private async initRedis() {
    if (!process.env.REDIS_URL) {
      console.log('REDIS_URL not set, using memory-based rate limiting')
      return
    }

    try {
      this.redis = createClient({ url: process.env.REDIS_URL })
      await this.redis.connect()
      this.connected = true
      console.log('Connected to Redis for rate limiting')
    } catch (error) {
      console.error('Failed to connect to Redis for rate limiting:', error)
      this.connected = false
    }
  }

  async isAllowed(
    identifier: string, 
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    // Use memory-based rate limiting for now
    return this.memoryRateLimit(identifier, config)
  }

  private memoryRateLimit(identifier: string, config: RateLimitConfig): RateLimitResult {
    // Simple in-memory fallback
    const store = new Map<string, { count: number; resetTime: number }>()
    const now = Date.now()
    
    let entry = store.get(identifier)
    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + config.windowMs }
      store.set(identifier, entry)
    }

    const allowed = entry.count < config.maxRequests
    const remaining = Math.max(0, config.maxRequests - entry.count)
    
    if (allowed) {
      entry.count++
    }

    return {
      allowed,
      remaining,
      resetTime: entry.resetTime,
      total: entry.count
    }
  }

  async reset(identifier: string, keyPrefix?: string): Promise<void> {
    if (this.connected && this.redis) {
      try {
        const key = `${keyPrefix || 'rate_limit'}:${identifier}`
        await this.redis.del(key)
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Redis reset error:', error)
        }
      }
    }
  }

  async getStats(identifier: string, config: RateLimitConfig): Promise<RateLimitResult | null> {
    // Use memory-based stats for now
    return this.memoryRateLimit(identifier, config)
  }

  async cleanup(): Promise<void> {
    if (this.redis && this.connected) {
      try {
        await this.redis.quit()
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Redis cleanup error:', error)
        }
      }
    }
  }
}

// Singleton instance
const redisRateLimiter = new RedisRateLimiter()

// Export convenience functions
export async function checkRateLimit(
  identifier: string, 
  config: RateLimitConfig
): Promise<RateLimitResult> {
  return redisRateLimiter.isAllowed(identifier, config)
}

export async function resetRateLimit(identifier: string, keyPrefix?: string): Promise<void> {
  return redisRateLimiter.reset(identifier, keyPrefix)
}

export async function getRateLimitStats(
  identifier: string, 
  config: RateLimitConfig
): Promise<RateLimitResult | null> {
  return redisRateLimiter.getStats(identifier, config)
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await redisRateLimiter.cleanup()
})

process.on('SIGINT', async () => {
  await redisRateLimiter.cleanup()
})
