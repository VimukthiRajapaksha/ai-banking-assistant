/** Shapes as the bank actually returns them. Named after the bank's own
 * fields rather than renamed on the way in -- a second vocabulary for the same
 * data is one more thing to keep in step. */
export interface Account {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
}

export interface Transaction {
  id: string;
  accountId: string;
  accountName: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
}

/** One page of transactions, plus the full match count the pager needs. */
export interface TransactionPage {
  items: Transaction[];
  total: number;
}

/** A product the bank offers. Nothing here belongs to a customer. */
export interface Product {
  id: string;
  name: string;
  type: string;
  description: string;
  interestRate: number;
  rateType: string;
  minAmount: number;
  maxAmount: number | null;
  termMonths: { min: number; max: number } | null;
  currency: string;
}

export type ChatStatus = 'ok' | 'awaiting_consent';

/** A consent form the MCP server asked the user to answer. Rendered inline in
 * the chat; approval is sent straight to the consent service under the user's
 * own identity, never relayed through the agent. */
export interface ConsentForm {
  key: string;
  message: string;
  consent_id?: string | null;
  schema?: {
    /** Limits that apply to the grant as a whole -- how long it lasts, and
     * that it can be withdrawn. Rendered under the permission list. */
    description?: string;
    /** One entry per field the server is asking about, in display order.
     * Only `type`, `title`, `description` and `default` survive the
     * elicitation wire format, so those are the only ones worth typing --
     * `default` is what carries a payment's stated values and the WebAuthn
     * challenge, both of which are read rather than edited. */
    properties?: Record<
      string,
      { type?: string; title?: string; description?: string; default?: string | boolean }
    >;
  };
}

export interface ChatResponse {
  session_id: string;
  reply: string;
  status: ChatStatus;
  elicitation?: ConsentForm | null;
}

/** Where an inline consent request has got to.
 *
 * A consent request is answered exactly once, so the card has to settle into a
 * state that cannot be clicked again -- leaving a live "Allow" button after
 * approval invites the customer to grant something twice and leaves them
 * unsure whether the first click registered. */
export type ConsentState = 'pending' | 'approving' | 'granted' | 'denied' | 'failed';

/** Delivery state of a message the customer sent.
 *
 * 'sent' is the moment it left the browser; 'seen' is the moment the
 * assistant's reply to it came back, which is the first point at which the
 * assistant has demonstrably read it. Nothing claims the assistant has seen a
 * message before that, because nothing knows. */
export type DeliveryState = 'sent' | 'seen';

export interface ChatMessageEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  delivery?: DeliveryState;
  consent?: ConsentForm | null;
  consentState?: ConsentState;
  /** Which account the customer picked on a payment approval card. Held on the
   * message rather than in one shared field: two cards can be on screen, and a
   * single value would let an answer to one be sent for the other. */
  selectedAccountId?: string;
  timestamp: number;
}
