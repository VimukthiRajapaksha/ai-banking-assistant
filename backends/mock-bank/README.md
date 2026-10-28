# AI Banking Mock Backend

Stands in for the bank's own APIs, so the rest of the system has something real
to call. Only the operations the assistant actually performs are exposed.

It has no authorization of its own. It sits behind the WSO2 API Manager gateway,
which validates the token and enforces consent before anything reaches here —
including the checks that bind a payment to exactly what the customer approved.

Transaction dates are computed from the current date at runtime, so the data
always reads as recent activity.

## Directory structure

```
src/
  server.js       Express app and the four routes
  logging.js      Request logging, stamped with the session, trace and span ids
                  the other services use, so one grep follows a question across
                  every hop
  data/
    accounts.js   Accounts and their transactions, stored as day offsets
    products.js   The product catalogue -- what the bank offers, not what is held
    utils.js      Date helpers resolved at request time
```

## Endpoints

| Method | Path | Returns |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/accounts` | The customer's accounts and balances |
| `GET` | `/transactions?accountId=&limit=&offset=` | Transactions, newest first. Omit `accountId` for activity across every account. Returns `{items, total, limit, offset}` |
| `GET` | `/products` | The product catalogue. Not customer data, so no token is required |
| `POST` | `/accounts/:accountId/payments` | Executes a payment (`payee`, `amount`) |

## Environment variables

Copy `.env.example` to `.env` and fill in the values.

| Variable | What it is |
|---|---|
| `HOST` / `PORT` | Where this service listens. Default `127.0.0.1:18030` |

## Running

```bash
npm install
npm start
```
