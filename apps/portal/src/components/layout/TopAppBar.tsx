import { useState } from 'react';
import { Box, ColorSchemeToggle, Header, IconButton, Tooltip } from '@wso2/oxygen-ui';
import { Bell, Menu, Settings } from '@wso2/oxygen-ui-icons-react';
import { AccountMenu } from './AccountMenu';
import { SettingsDialog } from '../settings/SettingsDialog';
import { takeEnrolIntent } from '../settings/enrolIntent';

/** Oxygen UI's Header, laid out the way the consent portal lays out its own --
 * toggle, brand, then actions -- so the two read as one product. */
export function TopAppBar({ onToggleNav, navOpen }: { onToggleNav: () => void; navOpen: boolean }) {
  // Read once, at mount: the customer asked to add a passkey, was sent through
  // a sign-in to prove it, and has just come back. Single-use, so a later
  // refresh does not reopen it.
  const [autoEnrol] = useState(() => takeEnrolIntent());
  const [settingsOpen, setSettingsOpen] = useState(autoEnrol);

  return (
    <>
      <Header>
        {/* A hamburger both ways, as the consent portal's Oxygen version
            draws it -- this version's default chevron would be the one
            visible difference between the two headers. */}
        <Header.Toggle
          collapsed={!navOpen}
          onToggle={onToggleNav}
          expandLabel="Show menu"
          collapseLabel="Hide menu"
          expandIcon={<Menu size={20} />}
          collapseIcon={<Menu size={20} />}
        />
        <Header.Brand>
          <Header.BrandLogo>
            <Box
              component="img"
              src="/apex-logo-32.png"
              alt=""
              aria-hidden
              sx={{ width: 28, height: 28, display: 'block', objectFit: 'contain' }}
            />
          </Header.BrandLogo>
          {/* BrandTitle's own type, not a heading variant: the consent
              portal's title uses it, and the two should set the same. */}
          <Header.BrandTitle>
            <Box component="span" sx={{ color: 'primary.main' }}>
              Apex
            </Box>
            Bank
          </Header.BrandTitle>
        </Header.Brand>
        <Header.Spacer />
        <Header.Actions>
          <ColorSchemeToggle />
          <Tooltip title="Notifications">
            <IconButton aria-label="Notifications">
              <Bell size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Settings">
            <IconButton aria-label="Settings" onClick={() => setSettingsOpen(true)}>
              <Settings size={18} />
            </IconButton>
          </Tooltip>
          <AccountMenu />
        </Header.Actions>
      </Header>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        autoEnrol={autoEnrol}
      />
    </>
  );
}
