import { daysAgo, today } from './utils.js';

/** Two accounts, so "my savings" and "my checking" are both answerable and the
 * assistant has to actually pick one rather than guessing. */
export const accounts = [
  {
    id: 'acc-chk-1120',
    accountNumber: '50318021120',
    name: 'Everyday Checking',
    type: 'CURRENT',
    currency: 'USD',
    balance: 8450.32,
  },
  {
    id: 'acc-sav-8842',
    accountNumber: '50318048842',
    name: 'High-Yield Savings',
    type: 'SAVINGS',
    currency: 'USD',
    balance: 24310.87,
  },
];

/** Transactions, newest first -- which is the order "last 10" implies.
 *
 * `days` is an offset from today rather than a date, so the list always reads
 * as recent activity. Amounts are negative for money out, positive for money
 * in; one sign convention is easier to reason about than a separate
 * debit/credit indicator.
 */
const seed = {
  'acc-chk-1120': [
    { days: 1, description: 'Whole Foods Market', category: 'Groceries', amount: -86.42 },
    { days: 2, description: 'Payroll Deposit', category: 'Income', amount: 3200.0 },
    { days: 3, description: 'Shell Gas Station', category: 'Transport', amount: -54.1 },
    { days: 4, description: 'Netflix', category: 'Subscription', amount: -15.99 },
    { days: 6, description: 'Amazon', category: 'Shopping', amount: -128.76 },
    { days: 8, description: 'Transfer to Savings', category: 'Transfer', amount: -500.0 },
    { days: 9, description: 'Gym Membership', category: 'Health', amount: -45.0 },
    { days: 11, description: 'Blue Bottle Coffee', category: 'Dining', amount: -6.75 },
    { days: 14, description: 'Electric Bill', category: 'Utilities', amount: -142.3 },
    { days: 17, description: 'Payroll Deposit', category: 'Income', amount: 3200.0 },
    { days: 21, description: 'Pharmacy', category: 'Health', amount: -38.6 },
    { days: 30, description: 'Rent', category: 'Housing', amount: -1850.0 },
  ],
  'acc-sav-8842': [
    { days: 2, description: 'Interest Payment', category: 'Interest', amount: 41.22 },
    { days: 8, description: 'Transfer from Checking', category: 'Transfer', amount: 500.0 },
    { days: 33, description: 'Interest Payment', category: 'Interest', amount: 39.87 },
    { days: 40, description: 'Transfer from Checking', category: 'Transfer', amount: 250.0 },
    { days: 63, description: 'Interest Payment', category: 'Interest', amount: 38.1 },
    { days: 71, description: 'Transfer to Checking', category: 'Transfer', amount: -1200.0 },
    { days: 94, description: 'Interest Payment', category: 'Interest', amount: 44.05 },
    { days: 110, description: 'Transfer from Checking', category: 'Transfer', amount: 800.0 },
    { days: 125, description: 'Interest Payment', category: 'Interest', amount: 36.91 },
    { days: 180, description: 'Opening Deposit', category: 'Deposit', amount: 20000.0 },
  ],
};

/** Every transaction across every account, newest first, dates resolved now.
 *
 * Built once per call rather than cached: the dates are relative to today, and
 * a cached list would drift the moment the process outlived a day boundary.
 */
export const allTransactions = () =>
  accounts
    .flatMap((account) => (transactionsFor(account.id) ?? []).map((t) => ({ ...t })))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

/** Transactions for one account, newest first, resolved to real dates now. */
export const transactionsFor = (accountId) => {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;
  const live = executedFor(accountId).map((txn, index) => ({
    id: `txn-${accountId.slice(-4)}-new-${index + 1}`,
    accountId,
    accountName: account.name,
    accountNumber: account.accountNumber,
    date: txn.date,
    description: txn.description,
    category: txn.category,
    amount: txn.amount,
    currency: account.currency,
  }));
  return live.concat(seed[accountId].map((txn, index) => ({
    id: `txn-${accountId.slice(-4)}-${index + 1}`,
    accountId,
    accountName: account.name,
    accountNumber: account.accountNumber,
    date: daysAgo(txn.days),
    description: txn.description,
    category: txn.category,
    amount: txn.amount,
    currency: account.currency,
  })));
};

export const findAccount = (accountId) => accounts.find((a) => a.id === accountId) ?? null;

/** Payments executed since this process started, newest first.
 *
 * In memory on purpose: this stands in for a core banking ledger, and a demo
 * that persisted would need migrations and a reset story for no extra fidelity.
 * A restart puts every balance back to its seed value, which is the behaviour
 * you want when the same walkthrough is run twice.
 */
const executed = {};

/** Debit `account` and record the payment, or return an error reason.
 *
 * Balance and transaction list move together here rather than in the route, so
 * there is no way to answer "it worked" while the statement still disagrees.
 * The check is `>` not `>=`: paying a balance to exactly zero is legitimate.
 */
export const executePayment = ({ accountId, payee, amount, reference }) => {
  const account = findAccount(accountId);
  if (!account) return { error: 'ACCOUNT_NOT_FOUND' };
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return { error: 'INVALID_AMOUNT' };
  // Money is compared in minor units: 0.1 + 0.2 > 0.3 in binary floating point,
  // and a payment refused for a rounding artefact is a bug the customer sees.
  if (Math.round(value * 100) > Math.round(account.balance * 100)) {
    return { error: 'INSUFFICIENT_FUNDS', balance: account.balance };
  }
  account.balance = Math.round((account.balance - value) * 100) / 100;
  const record = {
    date: today(),
    description: `Payment to ${payee}`,
    category: 'Transfer',
    amount: -value,
    reference: reference || undefined,
  };
  (executed[accountId] ??= []).unshift(record);
  return { balance: account.balance, transaction: record };
};

/** Payments this process has executed for an account, newest first. */
export const executedFor = (accountId) => (executed[accountId] ?? []).map((t) => ({ ...t }));
