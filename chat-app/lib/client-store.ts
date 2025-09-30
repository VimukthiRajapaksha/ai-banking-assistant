// Simple in-memory cache for client IDs
// In production, you'd want to use a persistent store
let globalClientId: string | null = null
let globalClientTimestamp: number = 0

// Cache duration: 1 hour
const CACHE_DURATION = 60 * 60 * 1000

export function getGlobalClientId(): string | null {
  if (globalClientId && Date.now() - globalClientTimestamp < CACHE_DURATION) {
    return globalClientId
  }
  return null
}

export function setGlobalClientId(clientId: string) {
  globalClientId = clientId
  globalClientTimestamp = Date.now()
}

export function clearGlobalClientId() {
  globalClientId = null
  globalClientTimestamp = 0
}
