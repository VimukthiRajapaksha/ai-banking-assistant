'use client';

import { useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppShell, Box, ColorSchemeToggle, Header, Sidebar, UserMenu } from '@wso2/oxygen-ui';
import { ArrowUpRight, Clock3, House, LogOut, Menu, ShieldCheck } from '@wso2/oxygen-ui-icons-react';
import { withBase } from '@/lib/basePath';

export interface ShellUser {
  name?: string;
  email?: string;
}

const NAV = [
  { id: 'overview', label: 'Overview', path: '/', icon: <House size={18} /> },
  { id: 'all', label: 'All consents', path: '/consents', icon: <ShieldCheck size={18} /> },
  { id: 'pending', label: 'Waiting for you', path: '/consents?status=pending', icon: <Clock3 size={18} /> },
];

function activeItem(pathname: string, status: string | null) {
  if (pathname.startsWith('/consents')) return status === 'pending' ? 'pending' : 'all';
  return 'overview';
}

/** The bank portal's shell -- Oxygen UI's AppShell, Header and Sidebar, laid
 * out the same way -- so moving from banking to consents reads as one product. */
export function PortalShell({
  user,
  bankPortalUrl,
  children,
}: {
  user: ShellUser;
  bankPortalUrl?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useSearchParams().get('status');
  const [navOpen, setNavOpen] = useState(true);
  const logoutForm = useRef<HTMLFormElement>(null);

  const name = user.name ?? 'Your account';
  const initial = name.charAt(0).toUpperCase();

  return (
    <AppShell collapseOnSelectOnMobile>
      <AppShell.Navbar>
        <Header>
          <Header.Toggle
            collapsed={!navOpen}
            onToggle={() => setNavOpen((v) => !v)}
            expandLabel="Show menu"
            collapseLabel="Hide menu"
            expandIcon={<Menu size={20} />}
            collapseIcon={<Menu size={20} />}
          />
          <Header.Brand>
            <Header.BrandLogo>
              <Box
                component="img"
                src={withBase('/apex-logo.png')}
                alt=""
                aria-hidden
                sx={{ width: 28, height: 28, display: 'block', objectFit: 'contain' }}
              />
            </Header.BrandLogo>
            <Header.BrandTitle>
              <Box component="span" sx={{ color: 'primary.main' }}>
                Apex
              </Box>
              Bank
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, ml: 1 }}>
                Consents
              </Box>
            </Header.BrandTitle>
          </Header.Brand>
          <Header.Spacer />
          <Header.Actions>
            <ColorSchemeToggle />
            <UserMenu>
              <UserMenu.Trigger name={name} avatar={initial} aria-label="Account menu" />
              <UserMenu.Header name={name} email={user.email ?? ''} avatar={initial} />
              <UserMenu.Divider />
              {bankPortalUrl && (
                <UserMenu.Item
                  icon={<ArrowUpRight size={18} />}
                  label="Back to banking"
                  onClick={() => window.location.assign(bankPortalUrl)}
                />
              )}
              <UserMenu.Divider />
              <UserMenu.Logout icon={<LogOut size={18} />} label="Sign out" onClick={() => logoutForm.current?.submit()} />
            </UserMenu>
          </Header.Actions>
        </Header>
        {/* Sign-out is a POST (see auth/logout), so it is a form, not a link. */}
        <form ref={logoutForm} method="post" action={withBase('/auth/logout')} hidden />
      </AppShell.Navbar>

      <AppShell.Sidebar>
        <Sidebar
          collapsed={!navOpen}
          activeItem={activeItem(pathname, status)}
          onSelect={(id) => {
            const item = NAV.find((n) => n.id === id);
            if (item) router.push(item.path);
          }}
          aria-label="Main navigation"
        >
          <Sidebar.Nav>
            <Sidebar.Category>
              <Sidebar.CategoryLabel>Consents</Sidebar.CategoryLabel>
              {NAV.map((item) => (
                <Sidebar.Item key={item.id} id={item.id}>
                  <Sidebar.ItemIcon>{item.icon}</Sidebar.ItemIcon>
                  <Sidebar.ItemLabel>{item.label}</Sidebar.ItemLabel>
                </Sidebar.Item>
              ))}
            </Sidebar.Category>
          </Sidebar.Nav>
        </Sidebar>
      </AppShell.Sidebar>

      <AppShell.Main>
        {/* AppShell's content area is a flex row: without flex and minWidth
            the page shrinks to its content and leaves a gap on the right
            (the bank portal's Dashboard does the same). */}
        <Box sx={{ flex: 1, minWidth: 0, p: { xs: 2, sm: 3 } }}>{children}</Box>
      </AppShell.Main>
    </AppShell>
  );
}
