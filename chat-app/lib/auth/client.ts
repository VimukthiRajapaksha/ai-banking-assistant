
import type { OAuthGrantStrategy, TokenResponse } from "./types";
import { getAccountsConsentPayload, getAuthorizationUrl, getCurrentTimestamp, getRandomString } from "./utils";
import { ClientCredentialsGrant } from "./grants/client-credentials";
import { post } from "./http";

export class OAuthClient {
    private strategy: OAuthGrantStrategy;

    constructor(strategy: OAuthGrantStrategy) {
        this.strategy = strategy;
    }

    setStrategy(strategy: OAuthGrantStrategy) {
        this.strategy = strategy;
    }

    async getToken(params: Record<string, any>): Promise<any> {
        return this.strategy.getToken(params);
    }
}

export class OpenBankingClient extends OAuthClient {

    private static tokenStore: Record<string, TokenResponse | null> = {};
    constructor(strategy: OAuthGrantStrategy) {
        super(strategy);
    }

    async initiateAccountsConsent(): Promise<any> {

        return new ClientCredentialsGrant().getToken({})
            .then(response => {
                return post(`${process.env.OB_SERVER_AM_URL}/account-access-consents`,
                    getAccountsConsentPayload(),
                    {
                        headers: { "Authorization": `Bearer ${response.data.access_token}` },
                        useMtls: true
                    });
            });
    }

    async authorize(): Promise<string> {

        // return this.initiateAccountsConsent()
        //     .then(response => {
                return getAuthorizationUrl({
                    // consent_id: response.data.Data.ConsentId,
                    nonce: getRandomString(),
                    state: getRandomString()
                });
            // })
    }

    async getTokenFromCacheOrRetrieve(sessionId: string, params: Record<string, any> = {}): Promise<any> {
        if (!(sessionId in OpenBankingClient.tokenStore)) {
            const response = await super.getToken(params);
            OpenBankingClient.tokenStore[sessionId] = {
                ...response.data,
                expires_at: getCurrentTimestamp() + (response.data.expires_in || 3600)
            } as TokenResponse;
        }
        // TODO: Handle token expiry and refresh using refresh_token
        return OpenBankingClient.tokenStore[sessionId];
    }
}

export class OpenBankingClientBuilder {

    private strategy: OAuthGrantStrategy;
    private static openBankingClient: OpenBankingClient | null = null;

    constructor() {
        this.strategy = new ClientCredentialsGrant();
    }

    with(strategy: OAuthGrantStrategy): OpenBankingClientBuilder {
        this.strategy = strategy;
        return this;
    }

    build(): OpenBankingClient {
        return new OpenBankingClient(this.strategy);
    }

    buildSingleton(): OpenBankingClient {
        if (OpenBankingClientBuilder.openBankingClient === null) {
            OpenBankingClientBuilder.openBankingClient = new OpenBankingClient(this.strategy);
        } else {
            OpenBankingClientBuilder.openBankingClient.setStrategy(this.strategy);
        }
        return OpenBankingClientBuilder.openBankingClient;
    }
}
