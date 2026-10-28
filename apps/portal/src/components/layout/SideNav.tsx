import { useState } from 'react';
import { Sidebar } from '@wso2/oxygen-ui';
import { Landmark, LifeBuoy, ReceiptText, Tag } from '@wso2/oxygen-ui-icons-react';

/** Only what the bank can actually answer. Cards, Transfers and Investments
 * were nav items with no data and no page behind them -- a menu that leads
 * nowhere teaches people not to trust the menu. */
const NAV_ITEMS = [
  { id: 'accounts', icon: <Landmark size={18} />, label: 'Accounts' },
  { id: 'transactions', icon: <ReceiptText size={18} />, label: 'Recent activity' },
  { id: 'products', icon: <Tag size={18} />, label: 'Products' },
];

/** Oxygen UI's Sidebar, which already is the mini-variant pattern: it takes a
 * `collapsed` flag and narrows to an icon rail, carrying its own widths,
 * transitions and active-item state. AppShell places it and offsets the main
 * content, so nothing here has to know the header's height.
 *
 * Items sit inside a Sidebar.Category because that is the unit the component
 * groups by -- nav and footer alike. Left as direct children of Sidebar.Nav
 * each item counts as its own category, and the rules the component draws
 * between categories then land between every item.
 */
export function SideNav({ open }: { open: boolean }) {
  const [activeItem, setActiveItem] = useState('accounts');

  // Each item scrolls to its section. There is no router, and a nav item that
  // does nothing when clicked is worse than no nav item.
  const select = (id: string) => {
    setActiveItem(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Sidebar collapsed={!open} activeItem={activeItem} onSelect={select} aria-label="Main navigation">
      <Sidebar.Nav>
        <Sidebar.Category>
          <Sidebar.CategoryLabel>Banking</Sidebar.CategoryLabel>
          {NAV_ITEMS.map((item) => (
            <Sidebar.Item key={item.id} id={item.id}>
              <Sidebar.ItemIcon>{item.icon}</Sidebar.ItemIcon>
              <Sidebar.ItemLabel>{item.label}</Sidebar.ItemLabel>
            </Sidebar.Item>
          ))}
        </Sidebar.Category>
      </Sidebar.Nav>

      {/* Logging out lives in the account menu, where people look for it.
          A second one here would be two places to keep consistent. */}
      <Sidebar.Footer>
        <Sidebar.Category>
          <Sidebar.Item id="support">
            <Sidebar.ItemIcon>
              <LifeBuoy size={18} />
            </Sidebar.ItemIcon>
            <Sidebar.ItemLabel>Support</Sidebar.ItemLabel>
          </Sidebar.Item>
        </Sidebar.Category>
      </Sidebar.Footer>
    </Sidebar>
  );
}
