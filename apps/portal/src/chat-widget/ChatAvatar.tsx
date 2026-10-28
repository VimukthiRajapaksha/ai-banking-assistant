import { Avatar } from '@wso2/oxygen-ui';
import { Bot, User } from '@wso2/oxygen-ui-icons-react';

/** Who said it, at a glance.
 *
 * Bubble side and colour already separate the two voices, but only for a
 * reader who has learnt the convention; a face next to each turn says it
 * outright. The customer's avatar is the same initials as the account menu,
 * so it is recognisably them; the assistant's is the same bot as the
 * launcher, so it is recognisably the thing they opened.
 */
export function ChatAvatar({ role, initial, size = 28 }: { role: 'user' | 'assistant'; initial?: string; size?: number }) {
  const assistant = role === 'assistant';
  return (
    <Avatar
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        fontSize: size * 0.4,
        fontWeight: 600,
        color: 'primary.contrastText',
        // Avatar's theme default is the neutral secondary; both voices get the
        // brand colour here, and only the glyph tells them apart.
        background: (t) => (assistant ? (t.gradient?.primary ?? t.palette.primary.main) : t.palette.primary.main),
      }}
    >
      {assistant ? <Bot size={size * 0.6} /> : (initial ?? <User size={size * 0.55} />)}
    </Avatar>
  );
}
