/** The browser's session identifier, for observability only.
 *
 * Distinct from the agent's conversation `session_id`: that one is minted by
 * the agent on first contact and scopes one conversation, so it does not exist
 * yet on the very first request and says nothing about the sitting as a whole.
 * This one is created when the tab first needs it and lives until the user
 * signs out, which is what makes "show me everything this person did" a single
 * filter across every service -- including ones the browser never calls.
 *
 * Held in sessionStorage so a reload keeps the same sitting, and so two tabs
 * are two sittings, which is what they are.
 */
const KEY = 'apex.session.id';

export function browserSessionId(): string {
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = `sess-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

export function clearBrowserSessionId(): void {
  sessionStorage.removeItem(KEY);
}
