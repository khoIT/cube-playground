/**
 * SearchTrigger — input-styled button that opens cube's SmartSearch overlay.
 * Click → onOpen(); ⌘K shortcut continues to work via cube's global listener.
 */
import React from 'react';
import { Search } from 'lucide-react';
import { T, Icon } from '../theme';

interface SearchTriggerProps {
  onOpen: () => void;
}

const KBD_STYLE: React.CSSProperties = {
  fontFamily: T.fMono,
  fontSize: 10,
  color: T.n600,
  background: T.surface,
  border: `1px solid ${T.n200}`,
  borderRadius: 4,
  padding: '1px 4px',
  lineHeight: 1,
  fontWeight: 500,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 14,
};

export function SearchTrigger({ onOpen }: SearchTriggerProps) {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        flex: '0 1 120px',
        display: 'flex', alignItems: 'center', gap: 8,
        height: 28, padding: '0 12px',
        background: T.surface, border: `1px solid ${T.n200}`, borderRadius: 999,
        cursor: 'pointer', textAlign: 'left',
        fontFamily: T.fSans,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = T.n300; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.n200; }}
    >
      <Icon icon={Search} size={13} color={T.n500} />
      <span style={{ flex: 1, color: T.n500, fontSize: 12.5, lineHeight: 1 }}>Search</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <kbd style={KBD_STYLE}>{isMac ? '⌘' : 'Ctrl'}</kbd>
        <span style={{ color: T.n400, fontSize: 10, lineHeight: 1 }}>+</span>
        <kbd style={KBD_STYLE}>K</kbd>
      </span>
    </button>
  );
}
