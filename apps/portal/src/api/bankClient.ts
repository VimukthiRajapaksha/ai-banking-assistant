import { config } from '../config';
import type { Account, Product, TransactionPage } from '../types';
import { authedFetch } from './httpClient';
import { newTraceparent } from './httpClient';
import { browserSessionId } from './session';

/** The bank's APIs, called directly with the customer's own token.
 *
 * No fallback data. An earlier version substituted sample accounts whenever a
 * call failed, which meant a broken bank looked exactly like a working one --
 * the dashboard showed plausible balances that belonged to nobody. A failure
 * here has to reach the screen.
 */

const trace = () => ({ traceparent: newTraceparent(), sessionId: browserSessionId() });
const url = (path: string) => `${config.bankApi.baseUrl.replace(/\/$/, '')}${path}`;

export function fetchAccounts(token: string, signal?: AbortSignal): Promise<Account[]> {
  return authedFetch<Account[]>(url('/accounts'), token, { signal }, trace());
}

export function fetchTransactions(
  token: string,
  { limit, offset, accountId }: { limit: number; offset: number; accountId?: string },
  signal?: AbortSignal,
): Promise<TransactionPage> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (accountId) query.set('accountId', accountId);
  return authedFetch<TransactionPage>(url(`/transactions?${query}`), token, { signal }, trace());
}

/** The catalogue is not customer data, so this one needs no token -- but it
 * goes through the same client for the trace headers. */
export function fetchProducts(token: string, signal?: AbortSignal): Promise<Product[]> {
  return authedFetch<Product[]>(url('/products'), token, { signal }, trace());
}
