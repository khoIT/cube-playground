import styled from 'styled-components';

import { HelpButton } from './help-button';
import { NotificationBell } from './notification-bell';
import { UserMenu } from './user-menu';

const Wrap = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

// Header search box was removed — ⌘K opens the real SmartSearchOverlay
// registered globally in App.tsx via SmartSearchProvider.
export function RightCluster() {
  return (
    <Wrap>
      <HelpButton />
      <NotificationBell />
      <UserMenu />
    </Wrap>
  );
}
