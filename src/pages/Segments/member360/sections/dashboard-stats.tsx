/**
 * Static profile-derived sections: Monetization tile grid + Profile/Acquisition
 * key-value columns. All read the single `user_profile` row passed in. Bool-ish
 * fields render Yes/No; everything else via formatCell.
 */

import { ReactElement, ReactNode } from 'react';
import type { FieldRef } from '../member360-sections';
import { qualify } from '../member360-sections';
import { formatCell } from '../format-cell';

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

function display(row: Record<string, unknown> | null, f: FieldRef): string {
  const v = row?.[qualify(f.field)];
  // Heuristic: is_*/paid fields read as Yes/No flags.
  if (/^(is_|.*_install$)/.test(f.field) && (typeof v === 'boolean' || v === 0 || v === 1 || v === '0' || v === '1')) {
    const truthy = v === true || v === 1 || v === '1';
    return truthy ? 'Yes' : 'No';
  }
  return formatCell(v, f.format);
}

/** Monetization-style grid of labeled stat tiles. */
export function StatTileGrid({
  fields,
  row,
}: {
  fields: FieldRef[];
  row: Record<string, unknown> | null;
}): ReactElement {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 12,
      }}
    >
      {fields.map((f) => (
        <div
          key={f.field}
          style={{
            background: 'var(--bg-muted)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: 18, marginBottom: 6 }} aria-hidden>{f.icon}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{f.label}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{display(row, f)}</div>
        </div>
      ))}
    </div>
  );
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
      {fields.map((f, i) => (
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
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right' }}>
            {display(row, f)}
          </span>
        </div>
      ))}
    </div>
  );
}
