/**
 * Reads the CSRF token from cookies for the current session namespace.
 * Super admin pages use 'super-admin-csrf-token', app pages use 'csrf-token'.
 */
export function getCsrfToken(namespace: 'super_admin' | 'app' = 'app'): string {
  const cookieName = namespace === 'super_admin' ? 'super-admin-csrf-token' : 'csrf-token'
  return (
    document.cookie
      .split('; ')
      .find((row) => row.startsWith(cookieName + '='))
      ?.split('=')[1] || ''
  )
}

/**
 * Returns headers with CSRF token included.
 * Use this for all PUT, POST, PATCH, DELETE requests.
 */
export function authHeaders(namespace: 'super_admin' | 'app' = 'app'): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-csrf-token': getCsrfToken(namespace)
  }
}

/**
 * Scoped cookie name may include host suffix like:
 * super-admin-csrf-token__mbill-hiijoshi-in
 * This helper finds whichever variant exists.
 */
export function getCsrfTokenScoped(namespace: 'super_admin' | 'app' = 'app'): string {
  const prefix = namespace === 'super_admin' ? 'super-admin-csrf-token' : 'csrf-token'
  const cookies = document.cookie.split('; ')
  const match = cookies.find((row) => row.startsWith(prefix))
  return match?.split('=')[1] || ''
}

export function authHeadersScoped(namespace: 'super_admin' | 'app' = 'app'): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-csrf-token': getCsrfTokenScoped(namespace)
  }
}