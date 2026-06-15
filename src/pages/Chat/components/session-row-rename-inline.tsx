/**
 * SessionRowRenameInline — inline text input for renaming a session in-place.
 * Commits on Enter, cancels on Esc or blur.
 */
import React, { useRef, useEffect } from 'react';
import { T } from '../../../shell/theme';

interface SessionRowRenameInlineProps {
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function SessionRowRenameInline({
  value,
  busy,
  onChange,
  onCommit,
  onCancel,
}: SessionRowRenameInlineProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  return (
    <div
      data-testid="session-row-rename-input"
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1 }}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={onCancel}
        disabled={busy}
        style={{
          flex: 1,
          fontFamily: T.fSans,
          fontSize: 13,
          padding: '2px 6px',
          border: `1px solid var(--shell-brand-border)`,
          borderRadius: 4,
          outline: 'none',
          background: 'var(--surface-raised)',
          color: 'var(--shell-text-emphasis)',
        }}
      />
    </div>
  );
}
