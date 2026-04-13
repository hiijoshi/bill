const SW_VERSION = 'mbill-pwa-v2'
const STATIC_CACHE = `${SW_VERSION}-static`
const RUNTIME_CACHE = `${SW_VERSION}-runtime`
const OFFLINE_URL = '/offline'
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icon',
  '/apple-icon',
  '/pwa-icons/192',
  '/pwa-icons/512',
  '/pwa-icons/maskable'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

function isStaticAsset(requestUrl, request) {
  return (
    requestUrl.origin === self.location.origin &&
    (
      requestUrl.pathname.startsWith('/_next/static/') ||
      ['style', 'script', 'font', 'image', 'worker'].includes(request.destination)
    )
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') {
    return
  }

  const requestUrl = new URL(request.url)

  if (requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith('/api/')) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(async () => {
          const cached = await caches.match(OFFLINE_URL)
          return cached || Response.error()
        })
    )
    return
  }

  if (isStaticAsset(requestUrl, request)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        const networkPromise = fetch(request)
          .then((response) => {
            if (response.ok) {
              cache.put(request, response.clone())
            }
            return response
          })
          .catch(() => cached)

        return cached || networkPromise
      })
    )
    return
  }

  event.respondWith(fetch(request))
})
