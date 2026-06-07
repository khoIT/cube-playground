/**
 * Shared 360 section primitives: SectionCard shell (used by every section incl.
 * journey/details) + KvList key-value rows. All read the single `user_profile`
 * row passed in. Bool-ish fields render Yes/No; everything else via formatCell,
 * with full-precision hover tooltips when the display form is lossy.
 */

import { ReactElement, ReactNode } from 'react';
import type { FieldRef } from '../member360-sections';
import { qualify } from '../member360-sections';
import { formatCell, formatCellExact } from '../format-cell';

/** White card with an emoji-prefixed uppercase section title. */
export function SectionCard({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section style={{ marginBottom: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
        }}
      >
        <span aria-hidden>{icon}</span>
        {title}
      </div>
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          padding: 16,
        }}
      >
        {children}
      </div>
    </section>
  );
}

/** Display string + full-precision tooltip (null when display is already exact). */
function display(row: Record<string, unknown> | null, f: FieldRef): { text: string; exact: string | null } {
  const v = row?.[qualify(f.field)];
  // Heuristic: is_*/paid fields read as Yes/No flags.
  if (/^(is_|.*_install$)/.test(f.field) && (typeof v === 'boolean' || v === 0 || v === 1 || v === '0' || v === '1')) {
    const truthy = v === true || v === 1 || v === '1';
    return { text: truthy ? 'Yes' : 'No', exact: null };
  }
  return { text: formatCell(v, f.format), exact: formatCellExact(v, f.format) };
}

/** Two-column key-value list (icon + label left, bold value right). */
export function KvList({
  fields,
  row,
}: {
  fields: FieldRef[];
  row: Record<string, unknown> | null;
}): ReactElement {
  return (
    <div>
      {fields.map((f, i) => {
        const d = display(row, f);
        return (
          <div
            key={f.field}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              padding: '8px 0',
              borderTop: i === 0 ? 'none' : '1px solid var(--border-card)',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'inline-flex', gap: 6 }}>
              <span aria-hidden>{f.icon}</span>
              {f.label}
            </span>
            <span
              style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right', cursor: d.exact ? 'help' : undefined }}
              title={d.exact ?? undefined}
            >
              {d.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
