import https from "https";
import axios from "axios";

import { clientTransportCert, clientTransportKey, serverTransportCert } from "./configs";

/**
 * POST request with optional mutual TLS support
 * @param url The endpoint URL
 * @param body The request body (object or string)
 * @param headers The request headers (object)
 * @param options Optional: { useMtls }
 */
export async function post(
    url: string,
    body: any,
    options?: {
        headers?: Record<string, string>,
        useMtls?: boolean;
    }
): Promise<any> {
    let agent: https.Agent | undefined = undefined;
    if (options?.useMtls) {
        agent = new https.Agent({
            cert: clientTransportCert,
            key: clientTransportKey,
            ca: serverTransportCert,
            rejectUnauthorized: true,
        });
    }

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
    };

    return axios.post(url, body, { headers, httpsAgent: agent })

    // const response = await fetch(url, {
    //     method: "POST",
    //     headers: base_headers,
    //     body: typeof body === "string" ? body : JSON.stringify(body),
    //     // @ts-ignore
    //     agent,
    // });
    // if (!response.ok) throw new Error(await response.text());
    // return response.json();
}
