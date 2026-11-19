import { NextResponse, type NextRequest } from 'next/server';
import { currentSession } from '@/lib/auth/current';
import { decide, getConsent, revoke } from '@/lib/asgardeo/consents';
import { AsgardeoError } from '@/lib/asgardeo/client';
import { actionsFor, PROP, statusOf } from '@/lib/consent/model';
import { config, SCOPE_WRITE } from '@/lib/config';

/** Approve, reject or revoke one of the signed-in customer's consents.
 *
 * Every check is made here, on the server, against a fresh read of the
 * consent: Asgardeo enforces none of these transitions itself, and the client
 * credentials behind it can change anyone's consent. The buttons only mirror
 * these rules.
 */

const ACTIONS = ['approve', 'reject', 'revoke'] as const;
type Action = (typeof ACTIONS)[number];

const problem = (status: number, code: string, message: string) => NextResponse.json({ code, message }, { status });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  if (!ACTIONS.includes(action as Action)) return problem(404, 'not_found', 'Unknown action.');

  // The session cookie is SameSite=Lax, which already keeps it off cross-site
  // POSTs; the origin check is the second lock on the same door.
  const origin = request.headers.get('origin');
  if (origin !== new URL(config.appBaseUrl).origin) return problem(403, 'bad_origin', 'Request refused.');

  const session = await currentSession();
  if (!session) return problem(401, 'unauthenticated', 'Sign in again to continue.');
  if (!session.scopes.includes(SCOPE_WRITE)) {
    return problem(403, 'insufficient_scope', 'You are not allowed to change consents.');
  }

  try {
    const consent = await getConsent(session.sub, id);
    if (!consent) return problem(404, 'not_found', 'Consent not found.');

    const allowed = actionsFor(consent, session.sub);
    if (!allowed[action as Action]) {
      return problem(409, 'not_allowed', `This consent is ${statusOf(consent)} and can no longer be changed that way.`);
    }

    if (action === 'revoke') {
      await revoke(consent);
    } else {
      await decide(consent, session.sub, action === 'approve' ? 'APPROVED' : 'REJECTED', {
        [PROP.decidedAt]: String(Date.now()),
      });
    }

    const updated = await getConsent(session.sub, id);
    return NextResponse.json({ status: updated ? statusOf(updated) : undefined });
  } catch (error) {
    if (error instanceof AsgardeoError) {
      return problem(502, 'consent_service', 'The consent service could not complete that. Try again shortly.');
    }
    throw error;
  }
}
