export const APP_COMPANY_CHANGED_EVENT = 'app-company-changed'

export function notifyAppCompanyChanged(companyId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(APP_COMPANY_CHANGED_EVENT, {
      detail: { companyId }
    })
  )
}
