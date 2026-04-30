# AI Banking Assistant

This is an AI-powered banking assistant solution (web chat UI + backend services) that can read a user's banking data (accounts, transactions, products) and perform actions such as initiating payments.

The solution is already deployed and reachable at:

- https://fa8faeab-92e9-4f40-9dc1-0488f952fc4f.e1-us-east-azure.choreoapps.dev/

## What’s Included

- **Chat UI**: end-user web experience.
- **AI Agent**: the orchestration layer that interprets user questions and calls tools.
- **Banking MCP Server**: exposes “tools” the agent can use (accounts, payees, payments, products).
- **Mock Bank Backend**: a mock Open Banking-style API used for demos/testing.

## Hosted Usage (Web)

1. Open https://fa8faeab-92e9-4f40-9dc1-0488f952fc4f.e1-us-east-azure.choreoapps.dev/
2. Click **Sign in with Bank** (this starts the bank OAuth login flow).
3. Complete bank login and consent.
4. You’ll be redirected back to the chat UI and can start asking questions.

### Example Questions (end user)

1. **Read / insights**
	 - "Show my current account balance and my last 5 transactions."

2. **Write / action**
	 - "Send $25 USD to John Smith with remarks 'Dinner split'."

## Notes

### Valid OTP format

In this implementation, the valid OTP is derived from the server date in **DDMM** format:

- `OTP = day_of_month (2 digits) + month (2 digits)`

Examples:

- On **January 6** → OTP is `0601`
- On **December 31** → OTP is `3112`

### Sandbox bank login 

This demo setup is integrated with Asgardeo, use the following test user credentials provided by the IDP, or configure the "Sign in With Passkey" option.

username: kevin_william
password: Pa$$w0rd@1

https://wso2.com/asgardeo/docs/guides/authentication/passwordless-login/add-passwordless-login-with-passkey/#try-it-out
