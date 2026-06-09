/**
 * Topbar — sticky 56px chrome inside <main>.
 * Layout: Breadcrumb (flex 1) | trailing slot | fixedTrailing (GamePicker) |
 *         AskCubeFab (when fabVisible) | Search input | NotificationBell | Avatar.
 * Backdrop blur w/ opaque fallback; sits below AntD modal portals (z 1000+).
 */
import React from 'react';
import { T } from '../theme';
import { Breadcrumb } from './breadcrumb';
import { useCsFlowNav } from './cs-flow-nav';
import { SearchTrigger } from './search-trigger';
import { AvatarMenu } from './avatar-menu';
import { TopbarTrailingContext } from './topbar-trailing-context';
import { NotificationBell } from '../../components/Header/notification-bell';
import { AnomalyBell } from '../anomaly-bell';
import { AskCubeFab } from '../chat-overlay/ask-cube-fab';
import { useChatSurfaces } from '../chat-overlay/use-chat-surfaces';
import { setOpen } from '../chat-overlay/chat-panel-open-store';

interface TopbarProps {
  onSearchOpen: () => void;
  /** Always-present node (e.g. GamePicker). Sits left of the trailing slot
   *  so per-page registrations don't clobber it. */
  fixedTrailing?: React.ReactNode;
}

export function Topbar({ onSearchOpen, fixedTrailing }: TopbarProps) {
  const { node: trailing } = React.useContext(TopbarTrailingContext);
  const { fabVisible, panelVisible } = useChatSurfaces();
  // CS flow surfaces lift their 3-step wayfinding bar into the leading slot;
  // every other route falls back to the route-derived breadcrumb.
  const csNav = useCsFlowNav();
  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 20,
        height: 56, padding: '0 24px',
        display: 'flex', alignItems: 'center', gap: 10,
        background: T.topbar,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderBottom: `1px solid ${T.n200}`,
        fontFamily: T.fSans,
      }}
    >
      {csNav ?? <Breadcrumb />}
      {trailing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {trailing}
        </div>
      )}
      {/* Pill cluster: GamePicker → Ask Cube → Search. Tight 6px gap so the
       *  three controls read as one group, sitting next to the bell. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {fixedTrailing}
        {fabVisible && (
          <AskCubeFab onClick={() => setOpen(true)} panelVisible={panelVisible} />
        )}
        <SearchTrigger onOpen={onSearchOpen} />
      </div>
      <AnomalyBell />
      <NotificationBell />
      <AvatarMenu />
    </header>
  );
}
