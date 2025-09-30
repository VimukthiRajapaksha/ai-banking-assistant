import { post } from "../http";
import type { OAuthGrantStrategy } from "../types";
import { getSignedClientAssertion } from "../utils";

export class ClientCredentialsGrant implements OAuthGrantStrategy {
    
    async getToken(params: Record<string, any> = {}): Promise<any> {
        const url: string = `${process.env.OB_SERVER_IAM_URL}/oauth2/token`;
        
        // Create basic auth header using client ID and secret
        const credentials = Buffer.from(`${process.env.OB_CLIENT_ID}:${process.env.OB_CLIENT_SECRET}`).toString('base64');
        
        const body: object = {
            grant_type: "client_credentials",
            scope: process.env.OB_CLIENT_SCOPES ?? "",
            // client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            // client_assertion: getSignedClientAssertion(),
            ...params
        };
        return post(url, body, {
            headers: { 
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": `Basic ${credentials}`
            },
            useMtls: true
        });
    }
}
