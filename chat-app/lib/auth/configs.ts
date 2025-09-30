import fs from "fs";

// Read certs at server startup (if configured)
export let clientTransportCert: Buffer | undefined = undefined;
export let clientTransportKey: Buffer | undefined = undefined;
export let clientSigningCert: Buffer | undefined = undefined;
export let clientSigningKey: Buffer | undefined = undefined;
export let serverTransportCert: Buffer | undefined = undefined;

if (process.env.OB_CLIENT_TRANSPORT_CERT &&
    process.env.OB_CLIENT_TRANSPORT_KEY &&
    process.env.OB_CLIENT_SIGNING_CERT &&
    process.env.OB_CLIENT_SIGNING_KEY &&
    process.env.OB_SERVER_TRANSPORT_CERT) {
    try {
        clientTransportCert = fs.readFileSync(process.env.OB_CLIENT_TRANSPORT_CERT);
        clientTransportKey = fs.readFileSync(process.env.OB_CLIENT_TRANSPORT_KEY);
        clientSigningCert = fs.readFileSync(process.env.OB_CLIENT_SIGNING_CERT);
        clientSigningKey = fs.readFileSync(process.env.OB_CLIENT_SIGNING_KEY);
        serverTransportCert = fs.readFileSync(process.env.OB_SERVER_TRANSPORT_CERT);
    } catch (err) {
        console.error("Failed to load TLS/Signing certs. Caused by, ", err);
        throw err;
    }
}
