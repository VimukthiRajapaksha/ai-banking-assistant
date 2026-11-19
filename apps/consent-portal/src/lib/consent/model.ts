import type { Authorization, Consent, PurposeVersion } from '../asgardeo/types';

/** Asgardeo's consent record, turned into what the customer is shown.
 *
 * Pure -- no I/O, no clock reads except through `now` -- so every rule here is
 * unit-tested rather than discovered in the browser.
 */

/** What the customer sees as the consent's status. Two more than Asgardeo's
 * states, both read off a REVOKED consent whose authorizations were left as
 * they were -- a revoke the customer asked for marks them REVOKED too:
 *
 * - "used": an approved payment. A payment consent is single-use, and the MCP
 *   server revokes it the moment the payment goes through.
 * - "replaced": anything else. Asgardeo keeps one live consent per customer,
 *   service and purpose, and revokes the previous one when a new one is
 *   created. The customer did not do that, so "Revoked" would claim they did. */
export type Status = 'pending' | 'active' | 'rejected' | 'revoked' | 'used' | 'replaced' | 'expired';

export type Kind = 'account' | 'payment' | 'other';

export interface Permission {
  id: string;
  name: string;
  label: string;
  description?: string;
}

export interface PaymentDetails {
  payee: string;
  payeeAccountNumber?: string;
  payeeBank?: string;
  amount?: string;
  currency?: string;
  reference?: string;
  /** The account it is paid from -- chosen when the customer approves. */
  fromAccount?: string;
  stepUp?: string;
}

export interface TimelineEvent {
  label: string;
  /** Epoch ms; absent when Asgardeo records no time for the event. */
  at?: number;
  tone: 'neutral' | 'positive' | 'negative';
}

export interface ConsentView {
  id: string;
  kind: Kind;
  status: Status;
  headline: string;
  app: { name: string; id?: string };
  agent: { name: string; id: string };
  subject: { name: string; id: string };
  permissions: Permission[];
  payment?: PaymentDetails;
  requestedAt: number;
  decidedAt?: number;
  expiresAt?: number;
  purpose: { name: string; description?: string };
  timeline: TimelineEvent[];
  actions: { approve: boolean; reject: boolean; revoke: boolean };
  conversationId?: string;
}

/** Properties the MCP server writes on every consent (see
 * platform/consent/asgardeo/README.md for the full contract). */
export const PROP = {
  subjectName: 'subjectName',
  applicationId: 'applicationId',
  applicationName: 'applicationName',
  agentId: 'agentId',
  agentName: 'agentName',
  conversationId: 'conversationId',
  payee: 'payee',
  payeeAccountNumber: 'payeeAccountNumber',
  payeeBank: 'payeeBank',
  amount: 'amount',
  currency: 'currency',
  reference: 'reference',
  stepUp: 'stepUp',
  debtorAccountName: 'debtorAccountName',
  debtorAccountNumber: 'debtorAccountNumber',
  /** Written by this portal when the customer approves or rejects: the
   * authorization's own timestamp moves again on revoke, which would lose
   * when the decision was made. */
  decidedAt: 'decidedAt',
} as const;

const PURPOSE_KIND: Record<string, Kind> = {
  AccountInformation: 'account',
  PaymentInitiation: 'payment',
};

export function kindOf(consent: Consent): Kind {
  return PURPOSE_KIND[consent.purposes?.[0]?.type ?? ''] ?? 'other';
}

export function statusOf(consent: Consent): Status {
  if (consent.state === 'REVOKED') {
    const authorizations = consent.authorizations ?? [];
    if (authorizations.some((a) => a.state === 'REVOKED')) return 'revoked';
    if (kindOf(consent) === 'payment' && authorizations.some((a) => a.state === 'APPROVED')) return 'used';
    return 'replaced';
  }
  return consent.state.toLowerCase() as Status;
}

/** The customer's own authorization -- the one their decision is recorded on. */
export function authorizationOf(consent: Consent, subject: string): Authorization | undefined {
  return consent.authorizations?.find((a) => a.userId === subject);
}

/** Which actions the customer may take. Asgardeo itself guards none of these
 * transitions -- it will happily re-activate a revoked consent -- so this is
 * the rule, and the API routes enforce it, not just the buttons. */
export function actionsFor(consent: Consent, subject: string) {
  const pendingOnMe = consent.state === 'PENDING' && authorizationOf(consent, subject)?.state === 'PENDING';
  return { approve: pendingOnMe, reject: pendingOnMe, revoke: consent.state === 'ACTIVE' };
}

/** "a, b and c" */
export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function formatMoney(amount: string | undefined, currency: string | undefined): string | undefined {
  if (!amount) return undefined;
  const value = Number(amount);
  if (!Number.isFinite(value)) return currency ? `${currency} ${amount}` : amount;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(value);
  } catch {
    // An unknown currency code: show it as written rather than guessing.
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** Account numbers are shown by their last four digits, the way statements
 * show them. Already-masked values pass through. */
export function maskAccount(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.includes('*') || value.includes('•')) return value.replace(/\*/g, '•');
  const digits = value.replace(/\s/g, '');
  return digits.length <= 4 ? digits : `••••${digits.slice(-4)}`;
}

/** Account-information elements, most revealing first: a consent is titled by
 * the most revealing thing it grants. The rest are listed under the title. */
const ACCOUNT_TITLE: [element: string, title: string][] = [
  ['ReadTransactionsDetail', 'View your transactions'],
  ['ReadBalances', 'View your balances'],
  ['ReadAccountsDetail', 'View your accounts'],
];

/** A short, verb-led title -- "Pay Sam Lee $240.75", "View your balances".
 * The status is not in it: the chip beside it says that. */
function headline(kind: Kind, permissions: Permission[], purposeName: string, payment?: PaymentDetails) {
  if (kind === 'payment' && payment) {
    const amount = formatMoney(payment.amount, payment.currency);
    return amount ? `Pay ${payment.payee} ${amount}` : `Pay ${payment.payee}`;
  }
  if (kind === 'account') {
    const granted = new Set(permissions.map((p) => p.name));
    return ACCOUNT_TITLE.find(([element]) => granted.has(element))?.[1] ?? 'View your accounts';
  }
  return purposeName;
}

function timeline(consent: Consent, status: Status, mine: Authorization | undefined, decidedAt?: number): TimelineEvent[] {
  const events: TimelineEvent[] = [{ label: 'Requested', at: consent.timestamp, tone: 'neutral' }];

  // A decision was made if the authorization says so now, or -- once revoked,
  // which overwrites the authorization -- if this portal recorded one.
  const approved =
    mine?.state === 'APPROVED' || status === 'active' || status === 'used' || (status === 'revoked' && decidedAt !== undefined);
  if (status === 'rejected') {
    events.push({ label: 'Rejected by you', at: decidedAt ?? mine?.updatedTime, tone: 'negative' });
  } else if (approved) {
    events.push({ label: 'Approved by you', at: decidedAt ?? (mine?.state === 'APPROVED' ? mine.updatedTime : undefined), tone: 'positive' });
  }

  if (status === 'revoked') {
    const revokedAt = consent.authorizations?.find((a) => a.state === 'REVOKED')?.updatedTime;
    events.push({ label: 'Revoked', at: revokedAt, tone: 'negative' });
  } else if (status === 'used') {
    // Asgardeo records no time for the revoke that retired it.
    events.push({ label: 'Used for the payment', tone: 'positive' });
  } else if (status === 'replaced') {
    events.push({ label: 'Replaced by a newer request', tone: 'neutral' });
  } else if (status === 'expired') {
    events.push({ label: 'Expired', at: consent.expiryTime ?? undefined, tone: 'neutral' });
  }
  return events;
}

export function toView(consent: Consent, subject: string, purpose?: PurposeVersion): ConsentView {
  const props = consent.properties ?? {};
  const consented = consent.purposes?.[0];
  const kind = kindOf(consent);
  const status = statusOf(consent);
  const mine = authorizationOf(consent, subject);

  const descriptions = new Map((purpose?.elements ?? []).map((e) => [e.id, e.description ?? undefined]));
  const permissions: Permission[] = (consent.purposes ?? []).flatMap((p) =>
    (p.elements ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      label: e.displayName || e.name,
      description: descriptions.get(e.id),
    })),
  );

  const payment: PaymentDetails | undefined =
    kind === 'payment' && props[PROP.payee]
      ? {
          payee: props[PROP.payee],
          payeeAccountNumber: maskAccount(props[PROP.payeeAccountNumber]),
          payeeBank: props[PROP.payeeBank] || undefined,
          amount: props[PROP.amount] || undefined,
          currency: props[PROP.currency] || undefined,
          reference: props[PROP.reference] || undefined,
          fromAccount: props[PROP.debtorAccountName]
            ? [props[PROP.debtorAccountName], maskAccount(props[PROP.debtorAccountNumber])].filter(Boolean).join(' ')
            : undefined,
          stepUp: props[PROP.stepUp] || undefined,
        }
      : undefined;

  const decidedAtRaw = Number(props[PROP.decidedAt]);
  const decidedAt = Number.isFinite(decidedAtRaw) && decidedAtRaw > 0 ? decidedAtRaw : undefined;
  const agentName = props[PROP.agentName] || consent.serviceId;
  const purposeName = consented?.properties?.displayName || consented?.name || 'Consent';

  return {
    id: consent.id,
    kind,
    status,
    headline: headline(kind, permissions, purposeName, payment),
    app: { name: props[PROP.applicationName] || props[PROP.applicationId] || 'Unknown app', id: props[PROP.applicationId] },
    agent: { name: agentName, id: props[PROP.agentId] || consent.serviceId },
    subject: { name: props[PROP.subjectName] || 'You', id: consent.subjectId },
    permissions,
    payment,
    requestedAt: consent.timestamp,
    decidedAt: decidedAt ?? (mine && (mine.state === 'APPROVED' || mine.state === 'REJECTED') ? mine.updatedTime : undefined),
    expiresAt: consent.expiryTime ?? undefined,
    purpose: { name: purposeName, description: purpose?.description || undefined },
    timeline: timeline(consent, status, mine, decidedAt),
    actions: actionsFor(consent, subject),
    conversationId: props[PROP.conversationId] || undefined,
  };
}

/** Status groups used by the list's tabs. */
export const ENDED: Status[] = ['rejected', 'revoked', 'used', 'replaced', 'expired'];

export function isExpiringWithin(view: ConsentView, ms: number, now: number): boolean {
  return view.status === 'active' && view.expiresAt !== undefined && view.expiresAt - now <= ms && view.expiresAt > now;
}
