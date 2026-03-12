import { NextRequest, NextResponse } from 'next/server'
import { env } from './config'

// CAPTCHA configuration
const CAPTCHA_CONFIG = {
  enabled: env.CAPTCHA_ENABLED === 'true',
  threshold: 3, // Show CAPTCHA after 3 failed attempts
  provider: env.CAPTCHA_PROVIDER || 'recaptcha', // recaptcha, hcaptcha, turnstile
  siteKey: env.CAPTCHA_SITE_KEY,
  secretKey: env.CAPTCHA_SECRET_KEY
}

interface CaptchaVerification {
  success: boolean
  score?: number
  error?: string
}

export async function verifyCaptcha(token: string, ip?: string): Promise<CaptchaVerification> {
  if (!CAPTCHA_CONFIG.enabled) {
    return { success: true }
  }

  if (!CAPTCHA_CONFIG.secretKey || !token) {
    return { success: false, error: 'CAPTCHA configuration missing' }
  }

  try {
    let verificationUrl: string
    let requestBody: Record<string, string>

    switch (CAPTCHA_CONFIG.provider) {
      case 'recaptcha':
        verificationUrl = 'https://www.google.com/recaptcha/api/siteverify'
        requestBody = {
          secret: CAPTCHA_CONFIG.secretKey,
          response: token,
          remoteip: ip || ''
        }
        break
      
      case 'hcaptcha':
        verificationUrl = 'https://hcaptcha.com/siteverify'
        requestBody = {
          secret: CAPTCHA_CONFIG.secretKey,
          response: token,
          sitekey: CAPTCHA_CONFIG.siteKey || '',
          remoteip: ip || ''
        }
        break
      
      case 'turnstile':
        verificationUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
        requestBody = {
          secret: CAPTCHA_CONFIG.secretKey,
          response: token,
          remoteip: ip || ''
        }
        break
      
      default:
        return { success: false, error: 'Unsupported CAPTCHA provider' }
    }

    const formData = new URLSearchParams(requestBody)
    const response = await fetch(verificationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData
    })

    const result = await response.json()

    if (CAPTCHA_CONFIG.provider === 'recaptcha' && result.score !== undefined) {
      // reCAPTCHA v3 - score based (0.0 to 1.0)
      const isHuman = result.score >= 0.5
      return { 
        success: result.success && isHuman,
        score: result.score
      }
    }

    return { success: result.success }

  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('CAPTCHA verification error:', error)
    }
    return { success: false, error: 'CAPTCHA verification failed' }
  }
}

export function shouldRequireCaptcha(failedAttempts: number): boolean {
  return CAPTCHA_CONFIG.enabled && failedAttempts >= CAPTCHA_CONFIG.threshold
}

export function getCaptchaConfig() {
  return {
    enabled: CAPTCHA_CONFIG.enabled,
    siteKey: CAPTCHA_CONFIG.siteKey,
    provider: CAPTCHA_CONFIG.provider,
    threshold: CAPTCHA_CONFIG.threshold
  }
}
