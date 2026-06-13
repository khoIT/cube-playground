/**
 * InfoTip — a tiny instant hover/focus tooltip for inline metric explanations.
 *
 * Replaces the native `title` attribute, which forces a `help` (?) cursor and a
 * ~1s OS-controlled show delay that reads as "broken". This shows immediately on
 * pointer-enter / focus via React state, styled with design tokens. Kept local
 * to the Care History header (the only current consumer); promote to a shared
 * component if a second surface needs it.
 *
 * Positioning is a plain absolutely-positioned bubble below the ⓘ icon — the
 * header is not inside an overflow-clipping container, so no portal is needed.
 */

import { ReactElement, useState } from 'react';
import { Info } from 'lucide-react';

export function InfoTip({ text, width = 280 }: { text: string; width?: number }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'default' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      <Info size={11} aria-hidden style={{ color: 'var(--text-muted)' }} />
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 1000,
            width,
            background: 'var(--bg-card)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            padding: '8px 10px',
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.45,
            textTransform: 'none',
            letterSpacing: 'normal',
            whiteSpace: 'normal',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
