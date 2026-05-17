import styled from 'styled-components';

import { HelpButton } from './help-button';
import { NotificationBell } from './notification-bell';
import { SearchBox } from './search-box';
import { UserMenu } from './user-menu';

const Wrap = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

export function RightCluster() {
  return (
    <Wrap>
      <SearchBox />
      <HelpButton />
      <NotificationBell />
      <UserMenu />
    </Wrap>
  );
}
