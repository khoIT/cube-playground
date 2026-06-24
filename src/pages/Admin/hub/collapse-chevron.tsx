/**
 * CollapseChevron — the expand/collapse affordance shared by the collapsible
 * org-overview sections (LLM key & model, Cost). A boxed 28px control with a
 * 16px chevron that rotates 90° when open — a real hit target, unlike the old
 * ~10px text glyph that was hard to see and tap. tokens.css only.
 */

import React from 'react';
import { ChevronRight } from 'lucide-react';

export function CollapseChevron({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={label}
      style={{
        width: 28,
        height: 28,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-muted)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        padding: 0,
        transition: 'transform 0.15s ease',
        transform: open ? 'rotate(90deg)' : 'none',
      }}
    >
      <ChevronRight size={16} strokeWidth={2.5} />
    </button>
  );
}
