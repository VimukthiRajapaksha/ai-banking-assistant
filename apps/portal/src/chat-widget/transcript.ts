import type { ChatMessageEntry } from '../types';

/** The conversation, kept across a page refresh but not beyond the sitting.
 *
 * Two things have to survive together or neither is worth keeping: the
 * messages the customer can see, and the agent's `session_id`. The agent holds
 * the model's message history against that id, so losing it does not just
 * clear the panel -- it starts a brand-new conversation, and the assistant
 * forgets everything said so far while the customer is still looking at it.
 *
 * sessionStorage rather than localStorage: this is a banking transcript. It
 * belongs to the tab and the sitting, it dies when the browser session does,
 * and two tabs are two conversations, which is what they are. Sign-out clears
 * it explicitly.
 */
const KEY = 'apex.chat.transcript';

/** Consent cards are deliberately NOT restored as pending. A restored card
 * would offer an Allow button for a round the agent is no longer waiting on,
 * and clicking it would relay an answer to nothing. Anything unanswered when
 * the page reloaded is shown as it was left, without controls. */
type Stored = { sessionId?: string; messages: ChatMessageEntry[] };

export function loadTranscript(): Stored | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!Array.isArray(parsed.messages)) return null;
    return {
      sessionId: parsed.sessionId,
      messages: parsed.messages.map((m) =>
        m.consentState === 'pending' || m.consentState === 'approving'
          ? { ...m, consentState: 'failed' }
          : m,
      ),
    };
  } catch {
    // Storage blocked, or a shape from an older build. A lost transcript is a
    // cosmetic loss; throwing here would take the whole widget down with it.
    return null;
  }
}

export function saveTranscript(sessionId: string | undefined, messages: ChatMessageEntry[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ sessionId, messages }));
  } catch {
    // Quota or a private window. Losing persistence must not lose the message
    // the customer just sent.
  }
}

export function clearTranscript(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing stored to begin with */
  }
}
