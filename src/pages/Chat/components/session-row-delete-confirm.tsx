/**
 * SessionRowDeleteConfirm — inline "Delete this conversation?" confirm bar.
 */
import React from 'react';
import { T } from '../../../shell/theme';

interface SessionRowDeleteConfirmProps {
  busy: boolean;
  onConfirm: (e: React.MouseEvent) => void;
  onCancel: (e: React.MouseEvent) => void;
}

export function SessionRowDeleteConfirm({
  busy,
  onConfirm,
  onCancel,
}: SessionRowDeleteConfirmProps) {
  return (
    <div
      data-testid="session-row-delete-confirm"
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}
    >
      <span style={{ fontFamily: T.fSans, fontSize: 12, color: T.n600, whiteSpace: 'nowrap' }}>
        Delete?
      </span>
      <button
        type="button"
        data-testid="session-row-delete-confirm-btn"
        onClick={onConfirm}
        disabled={busy}
        style={{
          padding: '2px 8px',
          border: 'none',
          borderRadius: 4,
          background: T.red500,
          color: '#fff',
          fontFamily: T.fSans,
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        Delete
      </button>
      <button
        type="button"
        onClick={onCancel}
        style={{
          padding: '2px 8px',
          border: `1px solid ${T.n300}`,
          borderRadius: 4,
          background: 'none',
          fontFamily: T.fSans,
          fontSize: 12,
          cursor: 'pointer',
          color: T.n600,
        }}
      >
        Cancel
      </button>
    </div>
  );
}
