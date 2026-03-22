import { NextRequest } from 'next/server'

// Enhanced brute force protection with exponential backoff
const failedAttempts = new Map<string, { count: number; lastAttempt: number; lockoutUntil: number }>()

function getClientIdentifier(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const userAgent = request.headers.get('user-agent') || ''
  
  // Use combination of IP and user agent for better identification
  return `${forwarded || realIp || 'unknown'}-${userAgent.slice(0, 50)}`
}

function calculateLockoutDuration(attemptCount: number): number {
  // Exponential backoff: 1min, 2min, 4min, 8min, 16min, max 1hr
  const baseDuration = 60 * 1000 // 1 minute
  const maxDuration = 60 * 60 * 1000 // 1 hour
  const duration = Math.min(baseDuration * Math.pow(2, attemptCount - 1), maxDuration)
  return duration
}

export function checkBruteForce(request: NextRequest) {
  const identifier = getClientIdentifier(request)
  const now = Date.now()
  
  let entry = failedAttempts.get(identifier)
  
  if (!entry) {
    entry = { count: 0, lastAttempt: 0, lockoutUntil: 0 }
    failedAttempts.set(identifier, entry)
  }
  
  // Check if currently locked out
  if (now < entry.lockoutUntil) {
    const remainingTime = Math.ceil((entry.lockoutUntil - now) / 1000)
    return {
      blocked: true,
      reason: 'Too many failed attempts. Account temporarily locked.',
      retryAfter: remainingTime,
      attemptCount: entry.count
    }
  }
  
  // Reset if lockout period has passed
  if (now > entry.lockoutUntil && entry.lockoutUntil > 0) {
    entry.count = 0
    entry.lockoutUntil = 0
  }
  
  return {
    blocked: false,
    attemptCount: entry.count
  }
}

export function recordFailedAttempt(request: NextRequest) {
  const identifier = getClientIdentifier(request)
  const now = Date.now()
  
  let entry = failedAttempts.get(identifier)
  if (!entry) {
    entry = { count: 0, lastAttempt: 0, lockoutUntil: 0 }
    failedAttempts.set(identifier, entry)
  }
  
  entry.count++
  entry.lastAttempt = now
  
  // Apply lockout if max attempts reached
  if (entry.count >= 5) {
    entry.lockoutUntil = now + calculateLockoutDuration(entry.count)
  }
  
  return entry
}

export function recordSuccessfulAttempt(request: NextRequest) {
  const identifier = getClientIdentifier(request)
  failedAttempts.delete(identifier) // Reset on successful login
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now()
  const cutoff = now - (24 * 60 * 60 * 1000) // 24 hours
  
  for (const [key, entry] of failedAttempts.entries()) {
    if (entry.lastAttempt < cutoff && entry.lockoutUntil < now) {
      failedAttempts.delete(key)
    }
  }
}, 60 * 60 * 1000) // Clean up every hour
