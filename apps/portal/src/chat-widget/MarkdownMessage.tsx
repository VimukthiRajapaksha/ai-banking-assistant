import { memo } from 'react';
import { Box, Link, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@wso2/oxygen-ui';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Renders an assistant message as markdown.
 *
 * The model replies in markdown -- bold amounts, numbered account lists,
 * transaction tables -- so showing the raw text meant the customer read `**`
 * and `|` instead of the emphasis and columns those characters stand for.
 *
 * Deliberately no `rehype-raw`: that plugin renders raw HTML embedded in the
 * markdown, and this markdown comes from a model that is summarising
 * attacker-influenceable data (a transaction description is whatever the payee
 * typed). Parsing markdown only means a crafted description can produce bold
 * text at worst, never script.
 *
 * Every element maps onto a themed MUI component, so the bubble inherits the
 * host app's palette and typography instead of carrying its own colours.
 */

const components: Components = {
  // `component="span"` + block display: a <p> inside the bubble's own <p>
  // is invalid HTML and React logs a hydration warning for it.
  p: ({ children }) => (
    <Typography variant="body2" component="span" sx={{ display: 'block', lineHeight: 1.6, '& + &': { mt: 1 } }}>
      {children}
    </Typography>
  ),
  strong: ({ children }) => (
    <Box component="strong" sx={{ fontWeight: 700 }}>
      {children}
    </Box>
  ),
  em: ({ children }) => <Box component="em" sx={{ fontStyle: 'italic' }}>{children}</Box>,
  ul: ({ children }) => (
    <Box component="ul" sx={{ pl: 2.5, my: 1, '& li + li': { mt: 0.5 } }}>
      {children}
    </Box>
  ),
  ol: ({ children }) => (
    <Box component="ol" sx={{ pl: 2.5, my: 1, '& li + li': { mt: 0.5 } }}>
      {children}
    </Box>
  ),
  li: ({ children }) => (
    <Typography component="li" variant="body2" sx={{ lineHeight: 1.6 }}>
      {children}
    </Typography>
  ),
  h1: ({ children }) => <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1.5, mb: 0.5 }}>{children}</Typography>,
  h2: ({ children }) => <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1.5, mb: 0.5 }}>{children}</Typography>,
  h3: ({ children }) => <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1.5, mb: 0.5 }}>{children}</Typography>,
  // Transaction tables are wider than a 380px widget, so the table scrolls
  // inside the bubble rather than stretching the panel.
  table: ({ children }) => (
    <Box sx={{ overflowX: 'auto', my: 1, borderRadius: '8px', border: '1px solid', borderColor: 'divider' }}>
      <Table size="small" sx={{ '& td, & th': { px: 1, py: 0.5, fontSize: 12, whiteSpace: 'nowrap' } }}>
        {children}
      </Table>
    </Box>
  ),
  thead: ({ children }) => <TableHead sx={{ bgcolor: 'action.hover' }}>{children}</TableHead>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children }) => <TableCell sx={{ fontWeight: 700 }}>{children}</TableCell>,
  td: ({ children }) => <TableCell>{children}</TableCell>,
  code: ({ children }) => (
    <Box
      component="code"
      sx={{ px: 0.5, py: 0.25, borderRadius: '4px', bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: '0.85em' }}
    >
      {children}
    </Box>
  ),
  pre: ({ children }) => (
    <Box component="pre" sx={{ p: 1, my: 1, borderRadius: '8px', bgcolor: 'action.hover', overflowX: 'auto', fontSize: 12 }}>
      {children}
    </Box>
  ),
  blockquote: ({ children }) => (
    <Box sx={{ pl: 1.5, my: 1, borderLeft: '3px solid', borderColor: 'primary.main', color: 'text.secondary' }}>
      {children}
    </Box>
  ),
  a: ({ children, href }) => (
    <Link href={href} target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit', textDecorationColor: 'inherit' }}>
      {children}
    </Link>
  ),
  hr: () => <Box sx={{ my: 1.5, borderTop: '1px solid', borderColor: 'divider' }} />,
};

export const MarkdownMessage = memo(function MarkdownMessage({ text }: { text: string }) {
  return (
    <Box sx={{ '& > :first-of-type': { mt: 0 }, '& > :last-child': { mb: 0 } }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </Box>
  );
});
