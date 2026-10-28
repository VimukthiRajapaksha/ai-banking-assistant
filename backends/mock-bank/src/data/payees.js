import { daysAgo } from './utils.js';

/** Beneficiaries the customer has already set up.
 *
 * A payee is what makes "pay 75.00 to Dana Lee" resolvable: the name maps to
 * an account the customer has previously confirmed, so a payment needs no
 * sort code or account number typed into a chat window.
 *
 * Account numbers are returned in full, as a bank API returns them. Keeping
 * them out of the model is the AMP gateway's job, not this data's: the
 * npi-masking-regex guardrail swaps every `accountNumber` value for a
 * placeholder on the way to the LLM and restores it on the way back. Masking
 * here as well would have hidden whether that guardrail works at all. No email
 * is kept -- a payment does not need one.
 *
 * `type` earns its place -- it is what makes "pay my electricity bill"
 * resolvable without the customer recalling the company's name.
 */
export const payees = [
  {
    id: 'pye-4417',
    name: 'Dana Lee',
    type: 'friend',
    accountNumber: '40218834417',
    bank: 'Meridian Trust',
    currency: 'USD',
    lastPaid: 12,
  },
  {
    id: 'pye-2093',
    name: 'Alice Johnson',
    type: 'friend',
    accountNumber: '71650292093',
    bank: 'Apex Bank',
    currency: 'USD',
    lastPaid: 31,
  },
  {
    id: 'pye-9182',
    name: 'Metro Electric',
    type: 'utility',
    accountNumber: '30914479182',
    bank: 'Santander',
    currency: 'USD',
    lastPaid: 7,
  },
  {
    id: 'pye-7756',
    name: 'Riverside Properties',
    type: 'landlord',
    accountNumber: '58802367756',
    bank: 'Northgate Bank',
    currency: 'USD',
    lastPaid: 3,
  },
];

/** Payees with `lastPaid` resolved to a real date, newest first. */
export const payeeList = () =>
  [...payees]
    .sort((a, b) => a.lastPaid - b.lastPaid)
    .map(({ lastPaid, ...payee }) => ({ ...payee, lastPaidOn: daysAgo(lastPaid) }));
