'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
} from '@wso2/oxygen-ui';
import type { ConsentView } from '@/lib/consent/model';
import { withBase, withoutBase } from '@/lib/basePath';

type Action = 'approve' | 'reject' | 'revoke';

/** What each action does, said before it is done. Revoking and rejecting
 * cannot be undone from here, so neither happens on a single click. */
function copy(view: ConsentView, action: Action) {
  const agent = view.agent.name;
  switch (action) {
    case 'approve':
      return {
        title: view.kind === 'payment' ? 'Approve this payment?' : 'Approve this access?',
        body:
          view.kind === 'payment'
            ? `${agent} will be able to ${view.headline.charAt(0).toLowerCase()}${view.headline.slice(1)}, once.`
            : `${agent} will be able to view your ${view.permissions.map((p) => p.label.toLowerCase()).join(', ')} until this consent ends or you revoke it.`,
        confirm: 'Approve',
        color: 'primary' as const,
      };
    case 'reject':
      return {
        title: 'Reject this request?',
        body: `${agent} will not get this access. If it still needs it, it will have to ask again.`,
        confirm: 'Reject',
        color: 'error' as const,
      };
    case 'revoke':
      return {
        title: 'Revoke this consent?',
        body:
          view.kind === 'payment'
            ? `${agent} won't be able to make this payment.`
            : `${agent} will stop seeing your account information right away. It will ask you again if it needs it.`,
        confirm: 'Revoke',
        color: 'error' as const,
      };
  }
}

export function ConsentActions({ view }: { view: ConsentView }) {
  const router = useRouter();
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { approve, reject, revoke } = view.actions;
  if (!approve && !reject && !revoke) return null;

  const run = async (action: Action) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(withBase(`/api/consents/${encodeURIComponent(view.id)}/${action}`), { method: 'POST' });
      if (response.status === 401) {
        // The session ended; sign in again and come straight back here.
        window.location.assign(
          withBase(`/auth/login?returnTo=${encodeURIComponent(withoutBase(window.location.pathname))}`),
        );
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'That did not work. Try again.');
      }
      setPending(null);
      // Re-render from the server: the record, not a local guess, decides
      // what the page shows next.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const dialog = pending ? copy(view, pending) : null;

  return (
    <>
      <Stack direction="row" spacing={1.5}>
        {reject && (
          <Button variant="outlined" color="error" onClick={() => setPending('reject')}>
            Reject
          </Button>
        )}
        {approve && (
          <Button variant="contained" onClick={() => setPending('approve')}>
            Approve
          </Button>
        )}
        {revoke && (
          <Button variant="outlined" color="error" onClick={() => setPending('revoke')}>
            Revoke access
          </Button>
        )}
      </Stack>

      <Dialog open={pending !== null} onClose={() => !busy && setPending(null)} maxWidth="xs" fullWidth>
        {dialog && (
          <>
            <DialogTitle>{dialog.title}</DialogTitle>
            <DialogContent>
              <DialogContentText>{dialog.body}</DialogContentText>
              {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {error}
                </Alert>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPending(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="contained" color={dialog.color} onClick={() => run(pending!)} disabled={busy}>
                {busy ? 'Working…' : dialog.confirm}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}
