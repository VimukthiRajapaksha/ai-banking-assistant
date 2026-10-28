import type { ReactNode } from 'react';
import { Alert, Box, CircularProgress, Paper, Typography } from '@wso2/oxygen-ui';

/** A titled panel that owns its own loading, error and empty states.
 *
 * Each section fetches independently, so one slow or failing call must not
 * blank the others -- the older dashboard withheld everything until every
 * request had finished.
 */
export function DataSection({
  id,
  title,
  loading,
  error,
  isEmpty,
  emptyMessage = 'Nothing to show yet.',
  action,
  children,
}: {
  id: string;
  title: string;
  loading: boolean;
  error: string | null;
  isEmpty?: boolean;
  emptyMessage?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box component="section" id={id} sx={{ mb: 5, scrollMarginTop: 96 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {action}
      </Box>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ borderRadius: 0 }}>
            {title} could not be loaded: {error}
          </Alert>
        ) : isEmpty ? (
          <Typography color="text.secondary" sx={{ p: 3 }}>
            {emptyMessage}
          </Typography>
        ) : (
          children
        )}
      </Paper>
    </Box>
  );
}
