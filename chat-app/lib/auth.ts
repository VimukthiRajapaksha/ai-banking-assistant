export interface TokenData {
  access_token: string
  token_type: string
  expires_in?: number
  scope?: string
  refresh_token?: string
  expires_at?: number
}

export function generateSessionId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

export function isTokenExpired(expiresAt?: number): boolean {
  if (!expiresAt) return false
  return Date.now() / 1000 >= expiresAt
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenData | null> {
  try {
    const tokenEndpoint = "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token"
    const clientId = process.env.CLIENT_ID
    const clientSecret = process.env.CLIENT_SECRET

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    })

    if (!response.ok) {
      throw new Error("Token refresh failed")
    }

    const tokenData: TokenData = await response.json()

    if (tokenData.expires_in) {
      tokenData.expires_at = Date.now() / 1000 + tokenData.expires_in
    }

    return tokenData
  } catch (error) {
    console.error("Token refresh error:", error)
    return null
  }
}
