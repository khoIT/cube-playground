/**
 * SessionRowMenuDropdown — the popover that appears after clicking the kebab.
 * Renders "Rename" and "Delete" action items.
 */
import React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { T } from '../../../shell/theme';

interface SessionRowMenuDropdownProps {
  onRename: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}

export function SessionRowMenuDropdown({ onRename, onDelete }: SessionRowMenuDropdownProps) {
  const itemBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '8px 12px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontFamily: T.fSans,
    fontSize: 13,
    textAlign: 'left',
  };

  return (
    <div
      style={{
        position: 'absolute',
        right: 0,
        top: '100%',
        zIndex: 100,
        background: T.surface,
        border: `1px solid ${T.n200}`,
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        minWidth: 120,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        data-testid="session-row-menu-rename"
        onClick={onRename}
        style={{ ...itemBase, color: T.n800 }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = T.surfaceSubtle; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
      >
        <Pencil size={13} />
        Rename
      </button>
      <button
        type="button"
        data-testid="session-row-menu-delete"
        onClick={onDelete}
        style={{ ...itemBase, color: T.red600 }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = T.redSoft; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
      >
        <Trash2 size={13} />
        Delete
      </button>
    </div>
  );
}
