// Centralized API helper with authentication

export async function authenticatedFetch(url: string, options: RequestInit = {}) {
  // Get token from cookie
  const token = document.cookie.replace(/(?:(?:^|.*;\s*)auth-token\s*\=\s*([^;]*).*$)|^.*$/, '$1');
  
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...options.headers,
  };

  return fetch(url, {
    ...options,
    headers,
  });
}

// Helper for GET requests
export async function apiGet(url: string) {
  return authenticatedFetch(url);
}

// Helper for POST requests
export async function apiPost(url: string, data: any) {
  return authenticatedFetch(url, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Helper for PUT requests
export async function apiPut(url: string, data: any) {
  return authenticatedFetch(url, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// Helper for DELETE requests
export async function apiDelete(url: string) {
  return authenticatedFetch(url, {
    method: 'DELETE',
  });
}
