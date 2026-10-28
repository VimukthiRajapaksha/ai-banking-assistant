import { Box, Paper } from '@wso2/oxygen-ui';
import { ChatAvatar } from './ChatAvatar';

/** The assistant is composing a reply.
 *
 * Shown in the same bubble the reply will occupy, so the answer appears where
 * the customer is already looking. This app's turns are slow -- a question can
 * involve a token exchange, a consent check and two bank calls -- and without
 * it the panel looks like it dropped the message.
 */
export function TypingIndicator() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
      <ChatAvatar role="assistant" />
      <Paper
        elevation={0}
        aria-live="polite"
        aria-label="The assistant is typing"
        sx={{
          px: 1.75,
          py: 1.25,
          borderRadius: 1,
          borderTopLeftRadius: 4,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          gap: 0.6,
          alignItems: 'center',
        }}
      >
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              bgcolor: 'text.disabled',
              animation: 'chat-typing 1.25s ease-in-out infinite',
              animationDelay: `${i * 0.16}s`,
              // Reduced motion still needs to say "working" -- the dots hold a
              // steady mid-opacity rather than disappearing entirely.
              '@media (prefers-reduced-motion: reduce)': { animation: 'none', opacity: 0.55 },
              '@keyframes chat-typing': {
                '0%, 60%, 100%': { opacity: 0.25, transform: 'translateY(0)' },
                '30%': { opacity: 0.9, transform: 'translateY(-3px)' },
              },
            }}
          />
        ))}
      </Paper>
    </Box>
  );
}
