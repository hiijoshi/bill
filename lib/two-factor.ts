import * as speakeasy from 'speakeasy'
import { toDataURL } from 'qrcode'
import { env } from '@/lib/config'

const DEFAULT_ISSUER = 'MandiCentral'
const TOKEN_WINDOW = 1

function normalizeOtpToken(value: string): string {
  return String(value || '').replace(/\D/g, '').slice(0, 6)
}

export function isValidOtpTokenFormat(value: string): boolean {
  return /^\d{6}$/.test(normalizeOtpToken(value))
}

function resolveIssuer(): string {
  return String(env.MFA_ISSUER || '').trim() || DEFAULT_ISSUER
}

function buildOtpAuthLabel(userId: string): string {
  const issuer = resolveIssuer().replace(/[:\s]+/g, ' ').trim()
  const account = String(userId || '').trim() || 'superadmin'
  return `${issuer}:${account}`
}

export async function createTwoFactorSetupPayload(userId: string): Promise<{
  secret: string
  otpauthUrl: string
  qrCodeDataUrl: string
}> {
  const issuer = resolveIssuer()
  const generated = speakeasy.generateSecret({
    name: buildOtpAuthLabel(userId),
    issuer,
    length: 32
  })

  const base32Secret = String(generated.base32 || '').trim()
  if (!base32Secret) {
    throw new Error('Unable to generate two-factor secret')
  }

  const otpauthUrl = String(generated.otpauth_url || '').trim()
  if (!otpauthUrl) {
    throw new Error('Unable to generate OTP auth URL')
  }

  const qrCodeDataUrl = await toDataURL(otpauthUrl, {
    width: 260,
    margin: 2,
    errorCorrectionLevel: 'M'
  })

  return {
    secret: base32Secret,
    otpauthUrl,
    qrCodeDataUrl
  }
}

export async function createTwoFactorQrFromSecret(userId: string, secret: string): Promise<{
  otpauthUrl: string
  qrCodeDataUrl: string
}> {
  const normalizedSecret = String(secret || '').trim()
  if (!normalizedSecret) {
    throw new Error('2FA secret is missing')
  }

  const issuer = resolveIssuer()
  const otpauthUrl = `otpauth://totp/${encodeURIComponent(buildOtpAuthLabel(userId))}?secret=${encodeURIComponent(normalizedSecret)}&issuer=${encodeURIComponent(issuer)}`
  const qrCodeDataUrl = await toDataURL(otpauthUrl, {
    width: 260,
    margin: 2,
    errorCorrectionLevel: 'M'
  })

  return {
    otpauthUrl,
    qrCodeDataUrl
  }
}

export function verifyTwoFactorToken(secret: string, token: string): boolean {
  const normalizedSecret = String(secret || '').trim()
  const normalizedToken = normalizeOtpToken(token)
  if (!normalizedSecret || normalizedToken.length !== 6) {
    return false
  }

  return speakeasy.totp.verify({
    secret: normalizedSecret,
    encoding: 'base32',
    token: normalizedToken,
    window: TOKEN_WINDOW
  })
}
