import 'server-only';
import { asgardeo, AsgardeoError } from './client';
import type { Consent, ConsentedPurpose, ConsentList, PurposeVersion } from './types';

/** Customer-scoped access to consents.
 *
 * Every function here takes the customer's subject and never returns a
 * consent that is not theirs: the client credentials behind it can see the
 * whole organization, so this file is the boundary.
 */

/** A customer holds a handful of consents, not thousands -- but a ceiling
 * keeps a runaway record set from turning one page view into hundreds of
 * upstream calls. */
const MAX_PAGES = 10;
const PAGE_SIZE = 100;

/** All of the customer's consents, newest first.
 *
 * Asgardeo lists oldest first, and its cursors only walk forward from there,
 * so "newest first" means reading every page and sorting. Fine at this size;
 * see MAX_PAGES.
 */
export async function listConsents(subject: string): Promise<Consent[]> {
  const query = new URLSearchParams({
    userId: subject,
    relation: 'SUBJECT',
    attributes: 'purposes,authorizations,properties',
    limit: String(PAGE_SIZE),
  });
  const consents: Consent[] = [];
  let next: string | undefined = `/consents?${query.toString()}`;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const body: ConsentList = await asgardeo<ConsentList>('GET', next);
    consents.push(...(body.Consents ?? []));
    next = body.links?.find((link) => link.rel === 'next')?.href;
  }
  // The subject filter is Asgardeo's; this is the check that does not depend
  // on it.
  const mine = consents.filter((consent) => consent.subjectId === subject).sort((a, b) => b.timestamp - a.timestamp);
  return withElements(mine);
}

/** A consent's purposes and their elements, keyed by consent id.
 *
 * The listing returns purposes without their elements -- the permissions a
 * row has to name. They are fixed when the consent is created, so each
 * consent's are fetched once and kept; only new consents cost a call. */
const elementCache = new Map<string, ConsentedPurpose[]>();
const ELEMENT_CACHE_LIMIT = 5_000;
const DETAIL_CONCURRENCY = 6;

async function withElements(consents: Consent[]): Promise<Consent[]> {
  const missing = consents.filter((c) => !elementCache.has(c.id));
  for (let i = 0; i < missing.length; i += DETAIL_CONCURRENCY) {
    await Promise.all(
      missing.slice(i, i + DETAIL_CONCURRENCY).map(async (c) => {
        try {
          const detail = await asgardeo<Consent>('GET', `/consents/${encodeURIComponent(c.id)}`);
          if (elementCache.size >= ELEMENT_CACHE_LIMIT) elementCache.clear();
          elementCache.set(c.id, detail.purposes ?? []);
        } catch (error) {
          // The row still renders, naming the purpose instead of permissions.
          console.warn('consent detail lookup failed:', error instanceof Error ? error.message : error);
        }
      }),
    );
  }
  return consents.map((c) => (elementCache.has(c.id) ? { ...c, purposes: elementCache.get(c.id) } : c));
}

/** One consent, or undefined when it does not exist or is not the customer's.
 * The two are deliberately indistinguishable: a 403 would confirm that a
 * guessed id belongs to someone. */
export async function getConsent(subject: string, id: string): Promise<Consent | undefined> {
  try {
    const consent = await asgardeo<Consent>('GET', `/consents/${encodeURIComponent(id)}`);
    return consent?.subjectId === subject ? consent : undefined;
  } catch (error) {
    if (error instanceof AsgardeoError && (error.status === 404 || error.status === 400)) return undefined;
    throw error;
  }
}

/** Records the customer's decision on a pending consent. Properties are sent
 * whole because Asgardeo replaces the map on PATCH -- `extra` is merged into
 * what the consent already carries, never sent alone. */
export async function decide(
  consent: Consent,
  subject: string,
  state: 'APPROVED' | 'REJECTED',
  extra: Record<string, string>,
): Promise<Consent> {
  return asgardeo<Consent>('PATCH', `/consents/${encodeURIComponent(consent.id)}`, {
    authorizations: [{ userId: subject, state }],
    properties: { ...(consent.properties ?? {}), ...extra },
  });
}

export async function revoke(consent: Consent): Promise<void> {
  await asgardeo<void>('POST', `/consents/${encodeURIComponent(consent.id)}/revoke`);
}

/** Purpose versions are immutable once created, so a cached copy never goes
 * stale; the TTL only bounds memory. */
const PURPOSE_TTL_MS = 30 * 60_000;
const purposeCache = new Map<string, { at: number; value: Promise<PurposeVersion | undefined> }>();

/** The version of the purpose a consent was given under -- the source of each
 * permission's description, which the consent itself does not carry. */
export function purposeVersion(purposeId: string, versionId: string): Promise<PurposeVersion | undefined> {
  const key = `${purposeId}/${versionId}`;
  const hit = purposeCache.get(key);
  if (hit && Date.now() - hit.at < PURPOSE_TTL_MS) return hit.value;

  const value = asgardeo<PurposeVersion>(
    'GET',
    `/purposes/${encodeURIComponent(purposeId)}/versions/${encodeURIComponent(versionId)}`,
  ).catch((error) => {
    // Descriptions are a nicety; a consent still renders without them.
    purposeCache.delete(key);
    console.warn('purpose version lookup failed:', error instanceof Error ? error.message : error);
    return undefined;
  });
  purposeCache.set(key, { at: Date.now(), value });
  return value;
}
