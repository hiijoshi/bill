export const SUPER_ADMIN_TAB_SESSION_KEY = 'super-admin-tab-unlocked'

export function markSuperAdminTabUnlocked(): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(SUPER_ADMIN_TAB_SESSION_KEY, '1')
}

export function clearSuperAdminTabUnlocked(): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(SUPER_ADMIN_TAB_SESSION_KEY)
}

export function isSuperAdminTabUnlocked(): boolean {
  if (typeof window === 'undefined') return false
  return window.sessionStorage.getItem(SUPER_ADMIN_TAB_SESSION_KEY) === '1'
}
