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
  color: 'var(--shell-text-muted)',
  background: 'var(--surface-raised)',
  border: `1px solid var(--shell-border)`,
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
        background: 'var(--surface-panel)', border: `1px solid var(--shell-border-strong)`, borderRadius: 999,
        cursor: 'pointer', textAlign: 'left',
        fontFamily: T.fSans,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--shell-text-faint)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--shell-border-strong)'; }}
    >
      <Icon icon={Search} size={13} color={'var(--shell-text-subtle)'} />
      <span style={{ flex: 1, color: 'var(--shell-text-subtle)', fontSize: 12.5, lineHeight: 1 }}>Search</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <kbd style={KBD_STYLE}>{isMac ? '⌘' : 'Ctrl'}</kbd>
        <span style={{ color: 'var(--shell-text-faint)', fontSize: 10, lineHeight: 1 }}>+</span>
        <kbd style={KBD_STYLE}>K</kbd>
      </span>
    </button>
  );
}
