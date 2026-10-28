import { useEffect, useRef, useState } from 'react';
import { Box, Fab, IconButton, Paper, Tooltip, Typography } from '@wso2/oxygen-ui';
import { Bot, Maximize2, Minimize2, X } from '@wso2/oxygen-ui-icons-react';
import { useAsgardeo } from '@asgardeo/react';
import { sendChatMessage, type ElicitationAnswer } from '../api/chatClient';
import { ApiError } from '../api/httpClient';
import { ChatAvatar } from './ChatAvatar';
import { ChatMessage } from './ChatMessage';
import { useIdTokenProfile } from '../auth/useIdTokenProfile';
import { notifyBankDataChanged } from '../bankEvents';
import { ChatInput } from './ChatInput';
import { placeholderFor } from './placeholders';
import { TypingIndicator } from './TypingIndicator';
import { PasskeyError, signStepUpChallenge } from '../auth/passkey';
import { loadTranscript, saveTranscript } from './transcript';
import type { ChatMessageEntry, ConsentState } from '../types';

/** Remembered per tab, so a refresh reopens the panel the size it was. */
const FULL_SCREEN_KEY = 'apex.chat.fullScreen';

/** How wide the conversation runs in full screen. */
const CONVERSATION_WIDTH = 800;

function loadFullScreen(): boolean {
  try {
    return sessionStorage.getItem(FULL_SCREEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Portable chat widget: the only thing it depends on from its host is the
 * Asgardeo auth context (for token exchange) -- any MUI/Oxygen UI app that
 * wraps itself in AsgardeoProvider + a themed OxygenUIThemeProvider can drop
 * this in and it inherits the host's theme automatically (see theme.ts). */
export function ChatWidget() {
  const { getAccessToken } = useAsgardeo();
  const { initial } = useIdTokenProfile();
  const [open, setOpen] = useState(false);
  // How many times the panel has been opened; picks the placeholder.
  const [openings, setOpenings] = useState(0);
  const [fullScreen, setFullScreen] = useState(loadFullScreen);
  // Restored once, at mount. A refresh keeps both the transcript and the
  // agent's session id -- without the id the agent starts a fresh
  // conversation and forgets everything on screen.
  const restored = useRef(loadTranscript());
  const [messages, setMessages] = useState<ChatMessageEntry[]>(
    restored.current?.messages?.length
      ? restored.current.messages
      : [
          {
            id: 'welcome',
            role: 'assistant',
            text: 'Hi there! How can I help you today?',
            timestamp: Date.now(),
          },
        ],
  );
  const [sending, setSending] = useState(false);
  const lastQuestionRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | undefined>(restored.current?.sessionId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Approving a consent also waits on the agent, so the indicator has to
  // follow that too -- otherwise the panel goes silent at exactly the moment
  // the customer has just committed to something.
  const busy = sending || messages.some((m) => m.consentState === 'approving');

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages, busy, open, fullScreen]);

  useEffect(() => {
    try {
      sessionStorage.setItem(FULL_SCREEN_KEY, fullScreen ? '1' : '0');
    } catch {
      // Storage blocked: the panel just opens docked next time.
    }
  }, [fullScreen]);

  // Esc steps back out of full screen -- to the docked panel, not all the way
  // closed, which is what the expand button promised to undo.
  useEffect(() => {
    if (!open || !fullScreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullScreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, fullScreen]);

  useEffect(() => {
    saveTranscript(sessionIdRef.current, messages);
  }, [messages]);

  // Put the cursor back in the box once the assistant has finished, so a
  // follow-up is just typing. Only when idle and open: stealing focus while a
  // reply is still streaming would fight the customer for the keyboard, and
  // focusing a panel that is closed would scroll the page to it.
  useEffect(() => {
    if (open && !busy) inputRef.current?.focus();
  }, [open, busy]);

  // A step-up answers itself: the authenticator is the prompt. Runs once per
  // card -- the `pending` guard is what stops a re-render from opening a second
  // WebAuthn dialog while the first is still up, which the browser rejects
  // outright ("a request is already pending").
  useEffect(() => {
    const awaiting = messages.find(
      (m) => m.consent?.key === 'payment_step_up' && (m.consentState ?? 'pending') === 'pending',
    );
    if (awaiting) void handleStepUp(awaiting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  /** The token /chat is called with -- the session token itself.
   *
   * It used to be exchanged first, for one scoped to a separate agent
   * audience. There is one resource server now, so the session token already
   * carries apex:agent:chat:read/write alongside everything the chain narrows from
   * later, and an exchange here could only ever hand back the same grant. */
  async function getChatToken(): Promise<string> {
    return getAccessToken();
  }

  function appendMessage(entry: Omit<ChatMessageEntry, 'id' | 'timestamp'>) {
    setMessages((prev) => [...prev, { ...entry, id: crypto.randomUUID(), timestamp: Date.now() }]);
  }

  function setConsentState(id: string, consentState: ConsentState) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, consentState } : m)));
  }

  /** Mark every message the customer has sent as seen.
   *
   * Called once a reply arrives: that is the first moment the assistant has
   * demonstrably read them. Marking on send would be a claim nothing supports.
   */
  function markSeen() {
    setMessages((prev) => prev.map((m) => (m.role === 'user' ? { ...m, delivery: 'seen' } : m)));
  }

  /** Run a payment step-up as soon as the server asks for one.
   *
   * No button: the browser shows its own prompt for a passkey, so a card
   * saying "click to confirm" would just be a second click in front of the
   * real one. The signed response goes straight back, and the customer sees
   * the payment details only after their device has confirmed them -- which
   * is the point of doing this first.
   */
  async function handleStepUp(entry: ChatMessageEntry) {
    const challenge = entry.consent?.schema?.properties?.passkey_challenge?.default;
    if (!entry.consent || typeof challenge !== 'string') return;
    setConsentState(entry.id, 'approving');
    try {
      const signed = await signStepUpChallenge(challenge);
      const answer: ElicitationAnswer = {
        key: entry.consent.key,
        action: 'accept',
        content: { passkey_response: signed },
      };
      const token = await getChatToken();
      const response = await sendChatMessage(token, sessionIdRef.current, lastQuestionRef.current ?? '', answer);
      sessionIdRef.current = response.session_id;
      setConsentState(entry.id, 'granted');
      appendMessage({ role: 'assistant', text: response.reply, consent: response.elicitation });
    } catch (err) {
      const cancelled = err instanceof PasskeyError && err.message === 'cancelled';
      setConsentState(entry.id, cancelled ? 'denied' : 'failed');
      if (cancelled) {
        // Tell the server the customer declined, so the payment is abandoned
        // rather than left waiting on an answer that is never coming.
        try {
          const token = await getChatToken();
          const response = await sendChatMessage(token, sessionIdRef.current, lastQuestionRef.current ?? '', {
            key: entry.consent.key, action: 'decline',
          });
          sessionIdRef.current = response.session_id;
          appendMessage({ role: 'assistant', text: response.reply, consent: response.elicitation });
        } catch {
          appendMessage({ role: 'assistant', text: "No problem, I didn't make the payment." });
        }
        return;
      }
      appendMessage({
        role: 'assistant',
        text: `I could not confirm your identity: ${err instanceof Error ? err.message : 'unknown error'}`,
      });
    }
  }

  /** Relay the customer's approval and replay the question that triggered it.
   *
   * The answer travels to the MCP server, which records it against the consent
   * it created. This app has no idea a consent service exists -- it renders
   * the question it was handed and reports the answer it was given. */
  async function handleApproveConsent(entry: ChatMessageEntry) {
    if (!entry.consent) return;
    setConsentState(entry.id, 'approving');
    try {
      // The funding account is part of what is being approved, so it has to
      // travel with the approval. Defaults come from the card the server sent:
      // the customer approved what they were shown.
      const props = entry.consent.schema?.properties ?? {};
      const content: Record<string, unknown> = { approve: true };
      if ('accountId' in props) {
        content.accountId = entry.selectedAccountId ?? props.accountId?.default ?? '';
      }
      const answer: ElicitationAnswer = { key: entry.consent.key, action: 'accept', content };
      const original = lastQuestionRef.current ?? '';
      const token = await getChatToken();
      const response = await sendChatMessage(token, sessionIdRef.current, original, answer);
      sessionIdRef.current = response.session_id;
      setConsentState(entry.id, 'granted');
      appendMessage({ role: 'assistant', text: response.reply, consent: response.elicitation });
      // Approving the payment card is the round that moves money. The reply
      // is prose, so whether it succeeded is not machine-readable here --
      // refresh either way: a reload that finds nothing new costs nothing,
      // a stale balance after a payment is a bug the customer sees.
      if (entry.consent.key === 'payment_authorization') notifyBankDataChanged();
    } catch (err) {
      // Left as 'failed', not 'granted': the customer needs to be able to
      // retry, and must not be told access was granted when it wasn't.
      setConsentState(entry.id, 'failed');
      appendMessage({
        role: 'assistant',
        text: `Sorry, the approval did not go through: ${err instanceof Error ? err.message : 'unknown error'}`,
      });
    }
  }

  /** Decline the request. The agent is told the customer said no, so it can
   * answer accordingly instead of waiting for an approval that never comes.
   * Nothing is sent to the consent service: a consent that is never approved
   * simply expires. */
  async function handleDenyConsent(entry: ChatMessageEntry) {
    if (!entry.consent) return;
    setConsentState(entry.id, 'denied');
    try {
      const answer: ElicitationAnswer = { key: entry.consent.key, action: 'decline' };
      const token = await getChatToken();
      const response = await sendChatMessage(token, sessionIdRef.current, lastQuestionRef.current ?? '', answer);
      sessionIdRef.current = response.session_id;
      appendMessage({ role: 'assistant', text: response.reply, consent: response.elicitation });
    } catch {
      appendMessage({ role: 'assistant', text: "No problem, I won't look at anything." });
    }
  }

  async function handleSend(text: string) {
    lastQuestionRef.current = text;
    appendMessage({ role: 'user', text, delivery: 'sent' });
    setSending(true);
    try {
      const token = await getChatToken();
      let response;
      try {
        response = await sendChatMessage(token, sessionIdRef.current, text);
      } catch (err) {
        // The session token may have expired mid-turn; the SDK refreshes it on
        // the next read, so ask again once and retry rather than failing a
        // message the customer has already sent.
        if (err instanceof ApiError && err.status === 401) {
          response = await sendChatMessage(await getChatToken(), sessionIdRef.current, text);
        } else {
          throw err;
        }
      }
      sessionIdRef.current = response.session_id;
      markSeen();
      appendMessage({ role: 'assistant', text: response.reply, consent: response.elicitation });
    } catch (err) {
      appendMessage({
        role: 'assistant',
        text: `Sorry, something went wrong: ${err instanceof Error ? err.message : 'unknown error'}`,
      });
    } finally {
      setSending(false);
    }
  }

  // Docked and full screen are one panel in two sizes, not two components:
  // switching never remounts it, so the transcript, a pending consent card and
  // the half-typed message all survive the change.
  const full = open && fullScreen;
  const toggleLabel = fullScreen ? 'Exit full screen' : 'Full screen';

  return (
    <Box
      sx={
        full
          ? { position: 'fixed', inset: 0, zIndex: 'tooltip', display: 'flex' }
          : {
              position: 'fixed',
              bottom: 32,
              right: 32,
              zIndex: 'tooltip',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
            }
      }
    >
      {open && (
        <Paper
          elevation={8}
          role="dialog"
          aria-label="AI Concierge"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            // The acrylic theme makes Paper see-through; a conversation needs
            // something solid behind the text.
            bgcolor: full ? 'background.default' : 'background.paper',
            backdropFilter: 'blur(20px)',
            ...(full
              ? { width: '100%', height: '100dvh', borderRadius: 0, border: 'none' }
              : { width: 380, borderRadius: 1, mb: 3 }),
          }}
        >
          <Box
            sx={{
              p: 2,
              // surface.low, not primary.light: the same tint that reads as a
              // gentle accent on a small chip becomes heavy as a full-width
              // band, and this header sits behind text.
              bgcolor: 'surface.low',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {/* The same bot as the launcher and every assistant turn, so the
                  panel is visibly the thing the customer just opened. */}
              <ChatAvatar role="assistant" size={40} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  AI Concierge
                </Typography>
                {/* Availability is ambient information -- a dot says it
                    without competing with the name for attention. */}
                <Box
                  aria-label="Online"
                  sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main', flexShrink: 0 }}
                />
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Tooltip title={toggleLabel}>
                <IconButton size="small" onClick={() => setFullScreen((v) => !v)} aria-label={toggleLabel}>
                  {fullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </IconButton>
              </Tooltip>
              <Tooltip title="Close chat">
                <IconButton size="small" onClick={() => setOpen(false)} aria-label="Close chat">
                  <X size={18} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          <Box
            sx={{
              overflowY: 'auto',
              p: 2,
              ...(full ? { flex: 1, minHeight: 0 } : { height: 384 }),
            }}
          >
            {/* Full screen widens the panel, not the conversation: past ~800px
                a line of text is too long to read comfortably. */}
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                ...(full && { maxWidth: CONVERSATION_WIDTH, mx: 'auto' }),
              }}
            >
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  userInitial={initial}
                  onApproveConsent={handleApproveConsent}
                  onDenyConsent={handleDenyConsent}
                  onChooseAccount={(entry, accountId) =>
                    setMessages((prev) =>
                      prev.map((m) => (m.id === entry.id ? { ...m, selectedAccountId: accountId } : m)),
                    )
                  }
                />
              ))}
              {busy && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </Box>
          </Box>

          <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Box sx={full ? { maxWidth: CONVERSATION_WIDTH, mx: 'auto' } : undefined}>
              <ChatInput
                disabled={sending}
                onSend={handleSend}
                inputRef={inputRef}
                placeholder={placeholderFor(openings)}
              />
            </Box>
          </Box>
        </Paper>
      )}

      {/* Full screen has its own close button; a launcher floating over the
          conversation would only cover the last message. */}
      {!full && (
        <Fab
          onClick={() => {
            if (!open) setOpenings((n) => n + 1);
            setOpen((value) => !value);
          }}
          aria-label={open ? 'Close chat' : 'Open chat'}
          color="primary"
          sx={{ width: 64, height: 64 }}
        >
          <Bot size={28} />
        </Fab>
      )}
    </Box>
  );
}
