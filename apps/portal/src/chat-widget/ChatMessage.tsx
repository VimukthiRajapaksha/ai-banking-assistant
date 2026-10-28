import { Fragment } from 'react';
import { Box, Button, Paper, Typography } from '@wso2/oxygen-ui';
import { Ban, Check, CheckCheck, CircleCheck, FingerprintPattern } from '@wso2/oxygen-ui-icons-react';
import { ChatAvatar } from './ChatAvatar';
import { MarkdownMessage } from './MarkdownMessage';
import type { ChatMessageEntry } from '../types';

/** One turn in the conversation, plus the consent card when a turn is waiting
 * on the customer's approval. */
export function ChatMessage({
  message,
  onApproveConsent,
  onDenyConsent,
  onChooseAccount,
  userInitial,
}: {
  message: ChatMessageEntry;
  /** The customer's initials, for their avatar. */
  userInitial?: string;
  onApproveConsent?: (entry: ChatMessageEntry) => void;
  onDenyConsent?: (entry: ChatMessageEntry) => void;
  onChooseAccount?: (entry: ChatMessageEntry, accountId: string) => void;
}) {
  const isUser = message.role === 'user';
  const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const state = message.consentState ?? 'pending';
  // The server sends the grant's limits as a reserved property rather than a
  // permission, because only `properties` survives the elicitation wire
  // format. Lifted out here so it renders as a footnote, not a scope row.
  const {
    grant_limits: limits,
    // A payment card states what is being paid rather than listing permissions,
    // so these are pulled out and rendered as facts. `approve` never becomes a
    // row: the button already says what approving does, and showing it twice
    // invites the reader to skim both.
    beneficiary,
    amount_due: amountDue,
    reason,
    accountId,
    approve: _approve,
    passkey_challenge: passkeyChallenge,
    passkey_response: _passkeyResponse,
    ...scopes
  } = message.consent?.schema?.properties ?? {};
  const settled = state === 'granted' || state === 'denied';
  const isStepUp = Boolean(passkeyChallenge);
  const details = [beneficiary, amountDue, reason].filter(Boolean);
  // The choices arrive as one pre-formatted string, because an elicitation
  // schema cannot carry a list. Split back apart so each account is its own
  // option rather than a run-on line the customer has to parse.
  const accountChoices = (accountId?.description ?? '')
    .split(' \u00b7 ')
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes(':'))
    .map((entry) => ({ id: entry.slice(0, entry.indexOf(':')).trim(), label: entry.slice(entry.indexOf(':') + 1).trim() }));
  const chosenAccount = message.selectedAccountId ?? (typeof accountId?.default === 'string' ? accountId.default : '');

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        gap: 1,
        maxWidth: '85%',
        ml: isUser ? 'auto' : 0,
      }}
    >
      <ChatAvatar role={message.role} initial={userInitial} />
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: isUser ? 'flex-end' : 'flex-start',
          minWidth: 0,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 1.5,
            // The theme's radius, as every other panel in both portals; the
            // squared corner is the tail pointing at whoever spoke.
            borderRadius: 1,
            ...(isUser
              ? { bgcolor: 'primary.main', color: 'primary.contrastText', borderTopRightRadius: 4 }
              : { bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderTopLeftRadius: 4 }),
          }}
        >
          {/* Only the assistant writes markdown. The customer's own text is
              shown verbatim -- rendering it would mean their question changes
              appearance depending on the punctuation they happened to type. */}
          {isUser ? (
            <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
              {message.text}
            </Typography>
          ) : (
            <MarkdownMessage text={message.text} />
          )}

          {message.consent && (
            <Box sx={{ mt: 1.5 }}>
              {/* One row per permission. The list is the part of this card a
                  customer is most likely to actually check, so each item gets
                  its own line and its own mark -- run together in a sentence
                  they read as one phrase and stop being checkable. */}
              {isStepUp && (
                // The authenticator is the prompt, so this card reports rather
                // than asks. Without a line here the chat would sit silent while
                // the browser's own dialog is up, and a customer who dismissed it
                // would have nothing on screen explaining what just happened.
                <Typography variant="body2" sx={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <FingerprintPattern size={16} />
                  {state === 'denied'
                    ? 'Not confirmed, so no payment was made.'
                    : state === 'failed'
                      ? 'That confirmation did not complete.'
                      : 'Confirm with your device to continue\u2026'}
                </Typography>
              )}

              {details.length > 0 && (
                // What is actually being paid. A definition list rather than the
                // permission checklist below: these are values the customer is
                // checking, not permissions they are granting, and reading them
                // as ticked-off items would invite skimming past the amount.
                <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1.5, rowGap: 0.5, mb: 1.25 }}>
                  {details.map((field) => (
                    <Fragment key={field!.title}>
                      <Typography variant="caption" color="text.secondary">
                        {field!.title}
                      </Typography>
                      <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>
                        {String(field!.default ?? '')}
                      </Typography>
                    </Fragment>
                  ))}
                </Box>
              )}

              {accountChoices.length > 0 && !settled && (
                <Box sx={{ mb: 1.25 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    {accountId?.title ?? 'Pay from'}
                  </Typography>
                  {accountChoices.map((choice) => (
                    <Box
                      key={choice.id}
                      component="label"
                      sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', py: 0.25 }}
                    >
                      <input
                        type="radio"
                        name={`account-${message.id}`}
                        value={choice.id}
                        checked={chosenAccount === choice.id}
                        onChange={() => onChooseAccount?.(message, choice.id)}
                      />
                      <Typography variant="body2" sx={{ fontSize: 13 }}>
                        {choice.label}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}

              <Box component="ul" sx={{ listStyle: 'none', m: 0, mb: 1.25, p: 0, display: 'grid', gap: 0.75 }}>
                {Object.entries(scopes).map(([name, field]) => (
                  <Box
                    key={name}
                    component="li"
                    sx={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 1, alignItems: 'start' }}
                  >
                    <Check size={15} style={{ marginTop: 2 }} />
                    <Box>
                      <Typography variant="body2" sx={{ fontSize: 13, lineHeight: 1.4 }}>
                        {field.title ?? name}
                      </Typography>
                      {field.description && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {field.description}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>

              {limits?.title && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', pt: 1, mb: 1.25, borderTop: '1px solid', borderColor: 'divider' }}
                >
                  {limits.title}
                </Typography>
              )}

              {settled ? (
                // Answered, so the buttons are gone rather than disabled: a
                // greyed-out "Allow" reads as "you may not approve this", which
                // is the opposite of what happened. The outcome stays on screen
                // instead of vanishing -- this is a consent record, and the
                // customer should be able to scroll back and see what they
                // agreed to and when.
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    color: state === 'granted' ? 'success.main' : 'text.secondary',
                  }}
                >
                  {state === 'granted' ? <CircleCheck size={16} /> : <Ban size={16} />}
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {state === 'granted' ? 'Access granted' : 'Access denied'}
                  </Typography>
                </Box>
              ) : isStepUp ? null : (
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={state === 'approving'}
                    onClick={() => onApproveConsent?.(message)}
                  >
                    {state === 'approving' ? 'Granting\u2026' : state === 'failed' ? 'Try again' : 'Allow'}
                  </Button>
                  {/* "Don't allow", not "Not now": the latter implies they will
                      be asked again, which is a promise about behaviour rather
                      than a description of it. Declining has to be as easy as
                      approving -- without it the only way out is to ignore the
                      request, which leaves the customer unsure whether they
                      have already agreed. */}
                  <Button
                    size="small"
                    variant="text"
                    disabled={state === 'approving'}
                    onClick={() => onDenyConsent?.(message)}
                    sx={{ color: 'text.secondary' }}
                  >
                    Don&rsquo;t allow
                  </Button>
                </Box>
              )}
            </Box>
          )}
        </Paper>

        {/* Timestamp and receipt sit together on one line: both are metadata
            about delivery, and neither deserves the weight of body text. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
          <Typography sx={{ fontSize: 10, lineHeight: 1.4, fontWeight: 600, opacity: 0.45, letterSpacing: '0.03em' }}>
            {time}
          </Typography>
          {isUser && message.delivery && (
            <Box
              component="span"
              role="img"
              aria-label={message.delivery === 'seen' ? 'Seen by the assistant' : 'Sent'}
              sx={{
                display: 'inline-flex',
                // Grey until the assistant has actually replied, then blue --
                // the colour is the signal, so it must not appear early.
                color: message.delivery === 'seen' ? 'primary.main' : 'text.disabled',
              }}
            >
              {message.delivery === 'seen' ? <CheckCheck size={13} /> : <Check size={13} />}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
