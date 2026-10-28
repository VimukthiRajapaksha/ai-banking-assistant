/**
 * Mock banking backend for the Apex AI banking assistant.
 *
 * Stands in for the bank's own APIs. Deliberately has no authorization of its
 * own: it sits behind the WSO2 API Manager gateway, which validates the token
 * and enforces consent before anything reaches here. Duplicating those checks
 * in this service would mean two places to keep correct and a second, weaker
 * copy of the policy that actually matters.
 *
 * Only the three operations the assistant performs are exposed. Anything else
 * would be surface with no caller.
 */
import { randomUUID } from 'node:crypto';

import cors from 'cors';
import express from 'express';

import { accounts, allTransactions, executePayment, findAccount, transactionsFor } from './data/accounts.js';
import { payeeList } from './data/payees.js';
import { products } from './data/products.js';
import { requestLogger } from './logging.js';
import { now } from './data/utils.js';

const app = express();
// Defaults match .env.example. The file is loaded by `--env-file` in the start
// script -- without it these defaults silently won hands-down, which is how
// this service kept listening on its old port after being reconfigured.
const PORT = process.env.PORT ?? 18030;
const HOST = process.env.HOST ?? '127.0.0.1';

app.use(cors());
app.use(express.json());
app.use(requestLogger);

/** Liveness. */
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: now() }));

/** The customer's accounts and balances. */
app.get('/accounts', (_req, res) => res.json(accounts));

/** Transactions, newest first.
 *
 * One endpoint with an optional filter rather than a nested
 * /accounts/:id/transactions: the dashboard needs activity across every
 * account, which a path nested under one account cannot express. Adding a
 * second route for that would mean two shapes of the same resource.
 *
 * Paginated, so the caller states what it wants instead of taking whatever
 * default the server happens to have. `total` is the full match count, not
 * the page size -- a pager cannot render without it.
 */
app.get('/transactions', (req, res) => {
  const { accountId } = req.query;
  if (accountId && !findAccount(accountId)) {
    return res.status(404).json({ error: 'Account not found' });
  }
  const matching = accountId ? transactionsFor(accountId) : allTransactions();
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json({ items: matching.slice(offset, offset + limit), total: matching.length, limit, offset });
});

/** The customer's saved beneficiaries -- who they can pay without re-entering
 * account details. Personal data, so it sits behind the gateway like accounts. */
app.get('/payees', (_req, res) => res.json(payeeList()));

/** The product catalogue. Deliberately unauthenticated: nothing here belongs
 * to a customer, so requiring a token would imply otherwise. */
app.get('/products', (_req, res) => res.json(products));

/** Execute one payment from the given account.
 *
 * Actually moves the money: the balance drops and the payment appears at the
 * top of the statement, for the life of this process. It used to return
 * EXECUTED and change nothing, which made every downstream check -- the
 * consent, the scope, the step-up -- untestable, because the one observable
 * effect they are all guarding was never there.
 */
app.post('/accounts/:accountId/payments', (req, res) => {
  const { payee, amount, reference } = req.body ?? {};
  if (!findAccount(req.params.accountId)) {
    return res.status(404).json({ error: 'Account not found' });
  }
  if (!payee || !amount) {
    return res.status(400).json({ error: 'payee and amount are required' });
  }

  const result = executePayment({ accountId: req.params.accountId, payee, amount, reference });
  if (result.error === 'INVALID_AMOUNT') {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  if (result.error === 'INSUFFICIENT_FUNDS') {
    // 422, not 400: the request is well formed, the account simply cannot
    // cover it -- and the caller needs to tell those two apart to know whether
    // retrying with the same body could ever succeed.
    return res.status(422).json({
      error: 'Insufficient funds',
      balance: result.balance,
      currency: findAccount(req.params.accountId).currency,
    });
  }

  res.json({
    paymentId: `pmt-${randomUUID().slice(0, 8)}`,
    status: 'EXECUTED',
    payee,
    amount,
    reference: reference ?? null,
    debtorAccount: req.params.accountId,
    balanceAfter: result.balance,
    currency: findAccount(req.params.accountId).currency,
    executedAt: now(),
  });
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled error:', error.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, HOST, () => console.log(`Mock bank backend listening on http://${HOST}:${PORT}`));
