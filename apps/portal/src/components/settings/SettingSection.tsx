import type { ReactNode } from 'react';
import { Box, Typography } from '@wso2/oxygen-ui';


/** One setting, boxed off from its neighbours.
 *
 * Settings dialogs grow. A flat stack of headings and controls stops being
 * readable the moment there are three of them, because nothing says where one
 * setting ends and the next begins -- and the reader has to infer it from
 * spacing. Giving each its own bordered panel makes that structural rather
 * than typographic, so adding the next setting is dropping in another
 * <SettingSection> and nothing else has to be re-tuned.
 */
export function SettingSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component="span" sx={{ display: 'inline-flex' }}>
          {icon}
        </Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
      </Box>
      {description && (
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      )}
      {children}
    </Box>
  );
}
