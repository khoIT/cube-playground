/**
 * Sticky bulk-action bar for the /dev/chat-audit session list.
 * Appears when one or more soft-deleted sessions are selected.
 * Lets the operator mass-restore or mass-permanently-delete them.
 */
import React from 'react';
import { T } from '../../shell/theme';

interface SessionListBulkBarProps {
  selectedCount: number;
  isBusy: boolean;
  error: string | null;
  onRestore: () => void;
  onPurge: () => void;
  onClear: () => void;
}

const S = {
  bar: {
    flexShrink: 0,
    padding: '8px 12px',
    borderBottom: `1px solid var(--shell-border)`,
    background: 'var(--shell-brand-soft)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 11,
  } as React.CSSProperties,
  count: {
    flex: 1,
    color: 'var(--shell-text-emphasis)',
    fontWeight: 600,
  } as React.CSSProperties,
  btn: (variant: 'primary' | 'destructive' | 'ghost', disabled: boolean): React.CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    border:
      variant === 'primary' ? `1px solid var(--shell-brand)` :
      variant === 'destructive' ? `1px solid var(--shell-danger)` :
      `1px solid var(--shell-border-strong)`,
    background:
      variant === 'primary' ? 'var(--surface-raised)' :
      variant === 'destructive' ? 'var(--surface-raised)' :
      'transparent',
    color:
      variant === 'primary' ? 'var(--shell-brand)' :
      variant === 'destructive' ? 'var(--shell-danger-strong)' :
      'var(--shell-text-muted)',
  }),
  err: {
    margin: '0 12px 8px',
    padding: '5px 8px',
    background: 'var(--shell-danger-soft)',
    border: `1px solid var(--shell-danger)`,
    borderRadius: 4,
    fontSize: 11,
    color: 'var(--shell-danger-strong)',
  } as React.CSSProperties,
};

export function SessionListBulkBar({
  selectedCount,
  isBusy,
  error,
  onRestore,
  onPurge,
  onClear,
}: SessionListBulkBarProps) {
  return (
    <>
      <div style={S.bar} data-testid="session-list-bulk-bar">
        <span style={S.count}>{selectedCount} selected</span>
        <button
          type="button"
          onClick={onRestore}
          disabled={isBusy}
          style={S.btn('primary', isBusy)}
          data-testid="bulk-restore-btn"
        >
          Restore
        </button>
        <button
          type="button"
          onClick={onPurge}
          disabled={isBusy}
          style={S.btn('destructive', isBusy)}
          data-testid="bulk-purge-btn"
        >
          Delete forever
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={isBusy}
          style={S.btn('ghost', isBusy)}
          aria-label="Clear selection"
        >
          ✕
        </button>
      </div>
      {error && <div style={S.err}>{error}</div>}
    </>
  );
}
