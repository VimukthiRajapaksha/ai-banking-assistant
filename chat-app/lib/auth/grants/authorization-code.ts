// import type { OAuthGrantStrategy } from "../types.ts";
// import { fetchOAuthToken } from "../utils";
import { ClientCredentialsGrant } from "./client-credentials";

export class AuthorizationCodeGrant extends ClientCredentialsGrant {

  async getToken(params: {
    code: string;
  }): Promise<any> {
    const body: object = {
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: process.env.OB_CLIENT_REDIRECT_URI
    };
    return super.getToken(body);
  }
}
