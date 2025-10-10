import crypto from "crypto";
import jwt from "jsonwebtoken";
import { clientSigningKey } from "./configs";

export async function fetchOAuthToken(
    tokenEndpoint: string,
    body: URLSearchParams
): Promise<any> {
    const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
}

export const getAuthorizationRequest = (params: {
    consentId: string,
    nonce: string,
    state: string
}): object => {
    return {
        "max_age": oneDayInSeconds,
        "aud": `${process.env.OB_SERVER_IAM_URL}/oauth2/token`,
        "scope": process.env.OB_CLIENT_SCOPES ?? "",
        "iss": process.env.OB_CLIENT_ID,
        "client_id": process.env.OB_CLIENT_ID,
        "claims": {
            "id_token": {
                "acr": {
                    "values": [
                        "urn:openbanking:psd2:sca",
                        "urn:openbanking:psd2:ca"
                    ],
                    "essential": true
                },
                "openbanking_intent_id": {
                    "value": params.consentId,
                    "essential": true
                }
            },
            "userinfo": {
                "openbanking_intent_id": {
                    "value": params.consentId,
                    "essential": true
                }
            }
        },
        "response_type": "code id_token",
        "redirect_uri": process.env.OB_CLIENT_BASE_URL + "/auth/callback",
        "state": params.state,
        "nonce": params.nonce,
        "jti": getRandomString()
    }
}

export const getSignedAuthorizationRequest = (params: {
    consentId: string,
    nonce: string,
    state: string
}): string => {
    return getSignedPayload(getAuthorizationRequest(params));
}

export const getClientAssertionPayload = (): object => {
    return {
        "sub": process.env.OB_CLIENT_ID,
        "aud": `${process.env.OB_SERVER_IAM_URL}/oauth2/token`,
        "iss": process.env.OB_CLIENT_ID,
        "jti": getRandomString()
    }
}

export const getSignedClientAssertion = (): string => {
    return getSignedPayload(getClientAssertionPayload());
}

const getSignedPayload = (payload: object): string => {
    return jwt.sign(payload, clientSigningKey ?? "", {
        algorithm: "PS256",
        notBefore: 0,
        expiresIn: "1d",
        keyid: process.env.OB_CLIENT_SIGNING_KEY_ID,
    });
}

export const getRandomString = (length: number = 16): string => crypto.randomBytes(length).toString('base64url');

export const oneDayInSeconds: number = 24 * 60 * 60;

export const getCurrentTimestamp = (): number => Math.floor(Date.now() / 1000);

export const getCurrentIsoTimestamp = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export const getFutureIsoTimestamp = (): string => new Date(Date.now() + oneDayInSeconds * 1000)
    .toISOString().replace(/\.\d{3}Z$/, 'Z');

export const getAuthorizationUrl = (params: {
    nonce: string;
    state: string;
    consent_id?: string;
}): string => {
    const url = new URL(`${process.env.OB_SERVER_IAM_URL}/oauth2/authorize`);
    url.searchParams.append("response_type", "code");
    url.searchParams.append("client_id", process.env.OB_CLIENT_ID ?? "");
    url.searchParams.append("redirect_uri", process.env.OB_CLIENT_BASE_URL + "/auth/callback");
    url.searchParams.append("scope", process.env.OB_CLIENT_SCOPES ?? "");
    url.searchParams.append("state", params.state);
    url.searchParams.append("nonce", params.nonce);
    url.searchParams.append("prompt", "login");
    if (params.consent_id) {
        url.searchParams.append("request", getSignedAuthorizationRequest({
            consentId: params.consent_id,
            nonce: params.nonce,
            state: params.state
        }));
    }

    console.log("Authorization URL:", url.toString());

    return url.toString();
}

export const getAccountsConsentPayload = (): object => {
    return {
        "Data": {
            "Permissions": [
                "ReadAccountsDetail",
                "ReadTransactionsDetail",
                "ReadBalances"
            ],
            "ExpirationDateTime": getFutureIsoTimestamp(),
            "TransactionFromDateTime": getCurrentIsoTimestamp(),
            "TransactionToDateTime": getFutureIsoTimestamp()
        },
        "Risk": {

        }
    }
}
