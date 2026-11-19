import { describe, expect, it } from 'vitest';
import type { Consent } from '../asgardeo/types';
import { actionsFor, formatMoney, listPhrase, maskAccount, statusOf, toView } from './model';

const ME = 'sub-me';

function consent(over: Partial<Consent> = {}): Consent {
  return {
    id: 'c1',
    subjectId: ME,
    serviceId: 'apex-banking-agent',
    state: 'PENDING',
    timestamp: 1_000,
    expiryTime: 9_000,
    purposes: [
      {
        id: 'p1',
        name: 'account_information_access',
        type: 'AccountInformation',
        versionId: 'v1id',
        version: 'v1',
        elements: [
          { id: 'e1', name: 'ReadAccountsDetail', displayName: 'Account details' },
          { id: 'e2', name: 'ReadBalances', displayName: 'Balances' },
        ],
        properties: { displayName: 'Account information' },
      },
    ],
    authorizations: [{ userId: ME, state: 'PENDING', updatedTime: 1_000 }],
    properties: { agentName: 'Apex Banking Assistant', applicationName: 'Apex Bank portal', subjectName: 'Alex Morgan' },
    ...over,
  };
}

const PAYMENT_PURPOSE = { id: 'p2', name: 'payment_initiation', type: 'PaymentInitiation', versionId: 'v', version: 'v1', elements: [] };

describe('statusOf', () => {
  it('reads a revoke with a revoked authorization as revoked', () => {
    expect(statusOf(consent({ state: 'REVOKED', authorizations: [{ userId: ME, state: 'REVOKED', updatedTime: 5 }] }))).toBe('revoked');
  });

  it('reads a revoke that left the authorizations alone as replaced', () => {
    expect(statusOf(consent({ state: 'REVOKED', authorizations: [{ userId: ME, state: 'APPROVED', updatedTime: 5 }] }))).toBe('replaced');
    expect(statusOf(consent({ state: 'REVOKED' }))).toBe('replaced');
  });

  it('reads an approved payment the MCP server retired as used', () => {
    const payment = (state: 'APPROVED' | 'PENDING' | 'REVOKED') =>
      consent({ state: 'REVOKED', purposes: [{ ...PAYMENT_PURPOSE }], authorizations: [{ userId: ME, state, updatedTime: 5 }] });
    expect(statusOf(payment('APPROVED'))).toBe('used');
    // Never approved, so never spent: a newer request took its place.
    expect(statusOf(payment('PENDING'))).toBe('replaced');
    // The customer revoked it before it was spent.
    expect(statusOf(payment('REVOKED'))).toBe('revoked');
  });

  it('passes other states through', () => {
    expect(statusOf(consent({ state: 'ACTIVE' }))).toBe('active');
    expect(statusOf(consent({ state: 'EXPIRED' }))).toBe('expired');
  });
});

describe('actionsFor', () => {
  it('lets the authorizer decide a pending consent', () => {
    expect(actionsFor(consent(), ME)).toEqual({ approve: true, reject: true, revoke: false });
  });

  it('does not let someone who is not the authorizer decide', () => {
    expect(actionsFor(consent(), 'someone-else')).toEqual({ approve: false, reject: false, revoke: false });
  });

  it('does not offer a decision twice', () => {
    const decided = consent({ authorizations: [{ userId: ME, state: 'APPROVED', updatedTime: 2 }] });
    expect(actionsFor(decided, ME).approve).toBe(false);
  });

  it('offers revoke only on an active consent', () => {
    expect(actionsFor(consent({ state: 'ACTIVE' }), ME).revoke).toBe(true);
    for (const state of ['PENDING', 'REJECTED', 'REVOKED', 'EXPIRED'] as const) {
      expect(actionsFor(consent({ state }), ME).revoke).toBe(false);
    }
  });
});

describe('toView', () => {
  it('titles an account-information consent by the most revealing thing it grants', () => {
    // Account details and balances.
    expect(toView(consent(), ME).headline).toBe('View your balances');
    // The status is the chip's to say, not the title's.
    expect(toView(consent({ state: 'ACTIVE' }), ME).headline).toBe('View your balances');

    const withElements = (...names: string[]) =>
      toView(
        consent({
          purposes: [{ ...consent().purposes![0], elements: names.map((name, i) => ({ id: `e${i}`, name, displayName: name })) }],
        }),
        ME,
      ).headline;
    expect(withElements('ReadAccountsDetail', 'ReadBalances', 'ReadTransactionsDetail')).toBe('View your transactions');
    expect(withElements('ReadAccountsDetail')).toBe('View your accounts');
    expect(withElements()).toBe('View your accounts');
  });

  it('adds descriptions from the purpose version', () => {
    const view = toView(consent(), ME, {
      id: 'v1id',
      version: 'v1',
      description: 'Read accounts',
      elements: [{ id: 'e2', name: 'ReadBalances', description: 'Current and available balances', mandatory: true }],
    });
    expect(view.permissions.find((p) => p.id === 'e2')?.description).toBe('Current and available balances');
    expect(view.purpose).toEqual({ name: 'Account information', description: 'Read accounts' });
  });

  it('leaves the purpose description out when there is none', () => {
    expect(toView(consent(), ME).purpose.description).toBeUndefined();
    expect(toView(consent(), ME, { id: 'v1id', version: 'v1', description: '', elements: [] }).purpose.description).toBeUndefined();
  });

  it('describes a payment by payee and amount, with masked accounts', () => {
    const view = toView(
      consent({
        purposes: [{ id: 'p2', name: 'payment_initiation', type: 'PaymentInitiation', versionId: 'v', version: 'v1', elements: [] }],
        properties: {
          payee: 'Sam Lee',
          amount: '240.75',
          currency: 'USD',
          payeeAccountNumber: '5566778899',
          debtorAccountName: 'Everyday Checking',
          debtorAccountNumber: '****4521',
        },
      }),
      ME,
    );
    expect(view.kind).toBe('payment');
    expect(view.headline).toBe('Pay Sam Lee $240.75');
    expect(view.payment?.payeeAccountNumber).toBe('••••8899');
    expect(view.payment?.fromAccount).toBe('Everyday Checking ••••4521');
  });

  it('keeps the decision time across a revoke when the portal recorded it', () => {
    const view = toView(
      consent({ state: 'REVOKED', authorizations: [{ userId: ME, state: 'REVOKED', updatedTime: 7_000 }], properties: { decidedAt: '4000' } }),
      ME,
    );
    expect(view.timeline.map((e) => [e.label, e.at])).toEqual([
      ['Requested', 1_000],
      ['Approved by you', 4_000],
      ['Revoked', 7_000],
    ]);
  });

  it('shows a replaced consent without claiming the customer revoked it', () => {
    const view = toView(consent({ state: 'REVOKED', authorizations: [{ userId: ME, state: 'APPROVED', updatedTime: 3_000 }] }), ME);
    expect(view.status).toBe('replaced');
    expect(view.timeline.map((e) => e.label)).toEqual(['Requested', 'Approved by you', 'Replaced by a newer request']);
  });

  it('shows a spent payment as used, approved and then used', () => {
    const view = toView(
      consent({
        state: 'REVOKED',
        purposes: [{ ...PAYMENT_PURPOSE }],
        authorizations: [{ userId: ME, state: 'APPROVED', updatedTime: 3_000 }],
        properties: { payee: 'Sam Lee', amount: '240.75', currency: 'USD' },
      }),
      ME,
    );
    expect(view.status).toBe('used');
    expect(view.timeline.map((e) => e.label)).toEqual(['Requested', 'Approved by you', 'Used for the payment']);
  });

  it('falls back when properties are missing', () => {
    const view = toView(consent({ properties: null }), ME);
    expect(view.agent.name).toBe('apex-banking-agent');
    expect(view.app.name).toBe('Unknown app');
  });
});

describe('formatting', () => {
  it('lists naturally', () => {
    expect(listPhrase(['a'])).toBe('a');
    expect(listPhrase(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('formats money and survives an unrecognised currency', () => {
    expect(formatMoney('12500', 'USD')).toBe('$12,500.00');
    // Intl formats any well-formed code, separating it with a no-break space.
    expect(formatMoney('10', 'XXQ')).toMatch(/^XXQ\s10\.00$/);
    expect(formatMoney('10', 'not-a-code')).toBe('not-a-code 10.00');
    expect(formatMoney('abc', 'USD')).toBe('USD abc');
    expect(formatMoney(undefined, 'USD')).toBeUndefined();
  });

  it('masks account numbers', () => {
    expect(maskAccount('0011223344')).toBe('••••3344');
    expect(maskAccount('****4521')).toBe('••••4521');
  });
});
