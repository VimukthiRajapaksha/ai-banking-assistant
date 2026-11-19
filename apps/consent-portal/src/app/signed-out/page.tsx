import { CenteredMessage } from '@/components/CenteredMessage';

const REASONS: Record<string, string> = {
  sign_in_expired: 'Your sign-in took too long and expired.',
  sign_in_failed: 'We could not complete your sign-in.',
  access_denied: 'Sign-in was cancelled.',
  idp_unavailable: 'The sign-in service could not be reached.',
};

/** Where a failed sign-in lands. Not redirected straight back to sign-in:
 * when the failure is a configuration problem, that would loop forever. */
export default async function SignedOutPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const reason = error ? (REASONS[error] ?? 'We could not sign you in.') : undefined;
  return (
    <CenteredMessage
      title={reason ? 'Sign-in did not complete' : 'You are signed out'}
      body={reason ? `${reason} Try again, and contact the bank if it keeps happening.` : 'Sign in to review your consents.'}
      action={{ label: 'Sign in', href: '/auth/login' }}
    />
  );
}
