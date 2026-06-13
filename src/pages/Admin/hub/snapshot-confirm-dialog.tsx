/**
 * Themed confirmation dialog for the lakehouse "Snapshot now" guard — replaces
 * the browser-native window.confirm() so the warning matches the admin hub's
 * token theme (card surface, semantic warning accent, brand OK button).
 *
 * Rendered through a portal with the app's standard scrim/z-index. Tokens only —
 * no inline hex. Mirrors the overlay idiom used by the other in-app modals.
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  body: React.ReactNode;
  /** Label for the proceed button (e.g. "Snapshot anyway"). */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.45)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};

const dialog: React.CSSProperties = {
  width: 'min(460px, 100%)',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-lg)',
  overflow: 'hidden',
};

const btnBase: React.CSSProperties = {
  height: 32,
  padding: '0 16px',
  borderRadius: 'var(--radius-md)',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};

export function SnapshotConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the proceed button on open + close on Escape — match native-dialog
  // affordances the window.confirm() gave us for free.
  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    // Backdrop click cancels; clicks inside the card are stopped from bubbling.
    <div style={overlay} onMouseDown={onCancel} role="presentation">
      <div
        style={dialog}
        onMouseDown={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '16px 18px 0' }}>
          <span
            style={{
              display: 'inline-flex',
              flexShrink: 0,
              width: 30,
              height: 30,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--radius-md)',
              background: 'var(--warning-soft)',
              color: 'var(--warning-ink)',
            }}
          >
            <AlertTriangle size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{title}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-secondary)', marginTop: 6 }}>{body}</div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '16px 18px',
            marginTop: 8,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              ...btnBase,
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card)',
              color: 'var(--text-secondary)',
            }}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{
              ...btnBase,
              border: 'none',
              background: 'var(--brand)',
              color: 'var(--text-on-brand)',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
