import { useEffect, useRef } from 'react';

/** Something the customer did outside the dashboard changed their accounts.
 *
 * Fired by the chat widget once a payment it relayed has been approved, and
 * heard by the dashboard, which reloads balances and activity. A DOM event
 * rather than shared state: the widget stays portable (see ChatWidget), and it
 * has no business knowing which panels on the host page show what.
 */
const BANK_DATA_CHANGED = 'apex:bank-data-changed';

export function notifyBankDataChanged() {
  window.dispatchEvent(new Event(BANK_DATA_CHANGED));
}

export function useOnBankDataChanged(handler: () => void) {
  // Latest handler without resubscribing on every render.
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const listener = () => ref.current();
    window.addEventListener(BANK_DATA_CHANGED, listener);
    return () => window.removeEventListener(BANK_DATA_CHANGED, listener);
  }, []);
}
