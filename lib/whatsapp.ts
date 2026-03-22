export function normalizeWhatsappPhone(rawPhone: string, defaultCountryCode = '91'): string {
  const digits = String(rawPhone || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 10) return `${defaultCountryCode}${digits}`
  return digits
}

export function buildWhatsappUrl(phone: string, message: string): string {
  const normalizedPhone = normalizeWhatsappPhone(phone)
  if (!normalizedPhone) return ''
  return `https://web.whatsapp.com/send?phone=${normalizedPhone}&text=${encodeURIComponent(message)}`
}

export function openWhatsappChat(phone: string, message: string): boolean {
  const normalizedPhone = normalizeWhatsappPhone(phone)
  if (!normalizedPhone || typeof window === 'undefined') return false

  const encodedMessage = encodeURIComponent(message)
  const isMobile = /android|iphone|ipad|ipod/i.test(window.navigator.userAgent || '')

  if (isMobile) {
    const appUrl = `whatsapp://send?phone=${normalizedPhone}&text=${encodedMessage}`
    const fallbackUrl = `https://wa.me/${normalizedPhone}?text=${encodedMessage}`
    const startedAt = Date.now()

    window.location.href = appUrl
    window.setTimeout(() => {
      if (document.visibilityState === 'visible' && Date.now() - startedAt < 2500) {
        window.location.href = fallbackUrl
      }
    }, 900)

    return true
  }

  const webUrl = `https://web.whatsapp.com/send?phone=${normalizedPhone}&text=${encodedMessage}`
  const popup = window.open(webUrl, '_blank', 'noopener,noreferrer')
  if (!popup) {
    window.location.href = webUrl
  }

  return true
}
