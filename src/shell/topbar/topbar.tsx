/**
 * Topbar — sticky 56px chrome inside <main>.
 * Layout: Breadcrumb (flex 1) | trailing slot | Search input (420) | Avatar.
 * Backdrop blur w/ opaque fallback; sits below AntD modal portals (z 1000+).
 */
import React from 'react';
import { T } from '../theme';
import { Breadcrumb } from './breadcrumb';
import { SearchTrigger } from './search-trigger';
import { AvatarMenu } from './avatar-menu';
import { TopbarTrailingContext } from './topbar-trailing-context';

interface TopbarProps {
  onSearchOpen: () => void;
  /** Always-present node (e.g. GamePicker). Sits left of the trailing slot
   *  so per-page registrations don't clobber it. */
  fixedTrailing?: React.ReactNode;
}

export function Topbar({ onSearchOpen, fixedTrailing }: TopbarProps) {
  const { node: trailing } = React.useContext(TopbarTrailingContext);
  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 20,
        height: 56, padding: '0 24px',
        display: 'flex', alignItems: 'center', gap: 16,
        background: T.topbar,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderBottom: `1px solid ${T.n200}`,
        fontFamily: T.fSans,
      }}
    >
      <Breadcrumb />
      {trailing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {trailing}
        </div>
      )}
      {fixedTrailing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {fixedTrailing}
        </div>
      )}
      <SearchTrigger onOpen={onSearchOpen} />
      <AvatarMenu />
    </header>
  );
}
