import type { OAuthGrantStrategy } from "../types.ts";
import { fetchOAuthToken } from "../utils";

export class RefreshTokenGrant implements OAuthGrantStrategy {
  async getToken(params: {
    refresh_token: string;
    client_id: string;
    client_secret?: string;
    token_endpoint: string;
  }): Promise<any> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refresh_token,
      client_id: params.client_id,
    });
    if (params.client_secret) body.append("client_secret", params.client_secret);
    return fetchOAuthToken(params.token_endpoint, body);
  }
}
