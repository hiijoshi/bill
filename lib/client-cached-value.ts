import { getClientCache, setClientCache } from './client-fetch-cache'

type ClientCachedValueOptions = {
  maxAgeMs: number
  persist?: boolean
  force?: boolean
}

const inFlightRequests = new Map<string, Promise<unknown>>()

export function getClientCachedValue<T>(key: string, maxAgeMs: number): T | null {
  return getClientCache<T>(key, maxAgeMs)
}

export async function loadClientCachedValue<T>(
  key: string,
  loader: () => Promise<T>,
  options: ClientCachedValueOptions
): Promise<T> {
  if (!options.force) {
    const cached = getClientCache<T>(key, options.maxAgeMs)
    if (cached !== null) {
      return cached
    }
  }

  const inFlight = inFlightRequests.get(key)
  if (inFlight) {
    return inFlight as Promise<T>
  }

  const request = loader()
    .then((value) => {
      setClientCache(key, value, { persist: options.persist !== false })
      return value
    })
    .finally(() => {
      if (inFlightRequests.get(key) === request) {
        inFlightRequests.delete(key)
      }
    })

  inFlightRequests.set(key, request)

  return request
}
