import 'server-only';
import { getConsent, listConsents, purposeVersion } from '../asgardeo/consents';
import { toView, type ConsentView } from './model';

/** Server-side loaders for the pages: Asgardeo records in, view models out.
 * Only the view model crosses to the browser -- never raw records, and never
 * another customer's. */

export async function loadViews(subject: string): Promise<ConsentView[]> {
  return (await listConsents(subject)).map((consent) => toView(consent, subject));
}

export async function loadView(subject: string, id: string): Promise<ConsentView | undefined> {
  const consent = await getConsent(subject, id);
  if (!consent) return undefined;
  const purpose = consent.purposes?.[0];
  const version = purpose ? await purposeVersion(purpose.id, purpose.versionId) : undefined;
  return toView(consent, subject, version);
}
