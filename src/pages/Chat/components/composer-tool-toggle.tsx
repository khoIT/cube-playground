/**
 * ComposerToolToggle — reusable pill-button for the chat composer action row.
 *
 * Props:
 *   active    — controlled on/off state
 *   onToggle  — flip callback
 *   icon      — lucide icon component (rendered at 13–14 px)
 *   label     — visible text (hidden in compact/icon-only mode)
 *   title     — tooltip + aria-label
 *   compact   — icon-only mode for the narrower side-pane surface
 *
 * Visual language mirrors the existing "Bypass cache" pill in chat-composer.tsx:
 *   inactive → transparent bg, n300 border, n500 text
 *   active   → brandSoft bg, brand border, brand text
 */
import React, { useState } from 'react';
import { T, Icon } from '../../../shell/theme';

interface ComposerToolToggleProps {
  active: boolean;
  onToggle: () => void;
  /** Lucide icon component. */
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  /** Visible label text (hidden when compact=true). */
  label: string;
  /** Tooltip text + aria-label. */
  title: string;
  /** When true, renders icon-only (no label text). */
  compact?: boolean;
}

export function ComposerToolToggle({
  active,
  onToggle,
  icon,
  label,
  title,
  compact,
}: ComposerToolToggleProps) {
  const [focused, setFocused] = useState(false);

  const border = active ? `1px solid ${T.brand}` : `1px solid ${T.n300}`;
  const background = active ? T.brandSoft : 'transparent';
  const color = active ? T.brand : T.n500;
  // Subtle hover bg — use surfaceMuted (same token used by disabled composer bg).
  const hoverBg = active ? T.brandSoft : T.surfaceMuted;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={title}
      title={title}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 0 : 4,
        padding: '2px 8px',
        border,
        borderRadius: 4,
        background,
        color,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        fontFamily: T.fSans,
        fontSize: compact ? 10 : 11,
        lineHeight: 1,
        // focus-visible ring
        outline: focused ? `2px solid ${T.brand}` : 'none',
        outlineOffset: focused ? 2 : 0,
        transition: 'background 0.12s, border-color 0.12s, color 0.12s',
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = active ? T.brandSoft : 'transparent';
      }}
    >
      <Icon icon={icon} size={compact ? 13 : 14} color={color} />
      {!compact && (
        <span style={{ marginLeft: 4 }}>{label}</span>
      )}
    </button>
  );
}
