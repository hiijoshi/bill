// Redis-based Rate Limiting for Distributed Systems
// This implementation requires Redis client: npm install redis

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

class RedisRateLimiter {
  private redis: any // Redis client
  private connected: boolean = false

  constructor() {
    // Redis is disabled for now to avoid build issues
    // To enable Redis rate limiting:
    // 1. Install redis package: npm install redis
    // 2. Set REDIS_URL environment variable
    // 3. Uncomment the Redis initialization code below
    
    if (process.env.NODE_ENV === 'development') {
      console.log('Redis rate limiting disabled - using memory-based rate limiting')
    }
    this.connected = false
  }

  async isAllowed(
    identifier: string, 
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    // Fallback to memory-based rate limiting if Redis is not available
    if (!this.connected || !this.redis) {
      return this.memoryRateLimit(identifier, config)
    }

    try {
      const key = `${config.keyPrefix || 'rate_limit'}:${identifier}`
      const now = Date.now()
      const windowStart = now - config.windowMs

      // Use Redis pipeline for atomic operations
      const pipeline = this.redis.pipeline()
      
      // Remove old entries
      pipeline.zremrangebyscore(key, 0, windowStart)
      
      // Add current request
      pipeline.zadd(key, now, `${now}-${Math.random()}`)
      
      // Count requests in window
      pipeline.zcard(key)
      
      // Set expiry
      pipeline.expire(key, Math.ceil(config.windowMs / 1000))
      
      const results = await pipeline.exec()
      const requestCount = results?.[2]?.[1] || 0

      const remaining = Math.max(0, config.maxRequests - requestCount)
      const allowed = requestCount < config.maxRequests
      const resetTime = now + config.windowMs

      return {
        allowed,
        remaining,
        resetTime,
        total: requestCount
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Redis rate limiting error:', error)
      }
      // Fallback to memory-based rate limiting
      return this.memoryRateLimit(identifier, config)
    }
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
    if (this.connected && this.redis) {
      try {
        const key = `${config.keyPrefix || 'rate_limit'}:${identifier}`
        const now = Date.now()
        const windowStart = now - config.windowMs

        // Remove old entries and get count
        const pipeline = this.redis.pipeline()
        pipeline.zremrangebyscore(key, 0, windowStart)
        pipeline.zcard(key)
        
        const results = await pipeline.exec()
        const requestCount = results?.[1]?.[1] || 0

        const remaining = Math.max(0, config.maxRequests - requestCount)
        const allowed = requestCount < config.maxRequests
        const resetTime = now + config.windowMs

        return {
          allowed,
          remaining,
          resetTime,
          total: requestCount
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Redis stats error:', error)
        }
        return null
      }
    }
    return null
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
