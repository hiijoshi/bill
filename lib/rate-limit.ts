import { NextRequest, NextResponse } from 'next/server'

// Simple in-memory rate limiting store
const rateLimitStore = new Map<string, { count: number; resetTime: number }>()

interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Max requests per window
}

type RateLimitedHandler = (request: NextRequest, ...args: unknown[]) => Promise<unknown> | unknown

export function rateLimit(config: RateLimitConfig) {
  return function (
    target: object,
    propertyName: string,
    descriptor: TypedPropertyDescriptor<RateLimitedHandler>
  ) {
    void target
    void propertyName
    const method = descriptor.value
    if (!method) return descriptor

    descriptor.value = async function (request: NextRequest, ...args: unknown[]) {
      const identifier = request.headers.get('x-forwarded-for') || 
                          request.headers.get('x-real-ip') || 
                          'unknown'
      const now = Date.now()
      
      // Get or create rate limit entry
      let entry = rateLimitStore.get(identifier)
      if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + config.windowMs }
        rateLimitStore.set(identifier, entry)
      }

      // Check rate limit
      if (entry.count >= config.maxRequests) {
        const resetIn = Math.ceil((entry.resetTime - now) / 1000)
        return NextResponse.json(
          { 
            error: 'Too many requests',
            retryAfter: resetIn
          },
          { 
            status: 429,
            headers: {
              'X-RateLimit-Limit': config.maxRequests.toString(),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': entry.resetTime.toString(),
              'Retry-After': resetIn.toString()
            }
          }
        )
      }

      // Increment counter
      entry.count++
      
      // Add rate limit headers to successful response
      const response = await method.apply(this, [request, ...args])
      if (response instanceof NextResponse) {
        response.headers.set('X-RateLimit-Limit', config.maxRequests.toString())
        response.headers.set('X-RateLimit-Remaining', (config.maxRequests - entry.count).toString())
        response.headers.set('X-RateLimit-Reset', entry.resetTime.toString())
      }
      
      return response
    }

    return descriptor
  }
}

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key)
    }
  }
}, 60000) // Clean up every minute
