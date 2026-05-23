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

export function SearchTrigger({ onOpen }: SearchTriggerProps) {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        flex: '0 1 240px',
        display: 'flex', alignItems: 'center', gap: 8,
        height: 36, padding: '0 12px',
        background: T.surface, border: `1px solid ${T.n200}`, borderRadius: 8,
        cursor: 'pointer', textAlign: 'left',
        fontFamily: T.fSans,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = T.n300; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.n200; }}
    >
      <Icon icon={Search} size={14} color={T.n500} />
      <span style={{ flex: 1, color: T.n500, fontSize: 13 }}>Search</span>
      <kbd style={{
        fontFamily: T.fMono, fontSize: 10, color: T.n500,
        background: T.n100, borderRadius: 4, padding: '2px 6px',
        lineHeight: 1, fontWeight: 500,
      }}>
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  );
}
