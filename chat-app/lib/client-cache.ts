// Client cache to store registered client IDs
const clientCache = new Map<string, { clientId: string, timestamp: number }>()

// Cache duration: 1 hour
const CACHE_DURATION = 60 * 60 * 1000

export function getCachedClient(key: string) {
  const cached = clientCache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.clientId
  }
  return null
}

export function setCachedClient(key: string, clientId: string) {
  clientCache.set(key, { clientId, timestamp: Date.now() })
}

export function clearExpiredClients() {
  const now = Date.now()
  for (const [key, value] of clientCache.entries()) {
    if (now - value.timestamp >= CACHE_DURATION) {
      clientCache.delete(key)
    }
  }
}
