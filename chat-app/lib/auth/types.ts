export interface OAuthGrantStrategy {
  getToken(params: Record<string, any>): Promise<any>;
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
  scope?: string
  refresh_token?: string
  expires_at?: number
}
