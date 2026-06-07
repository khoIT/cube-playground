/**
 * Acquisition strip — horizontal milestone steps (install → first login →
 * last login) with relative-date context, plus a categorical chips row
 * (media source / channel / paid-vs-organic). All values come from the single
 * profile row.
 */

import { ReactElement } from 'react';
import type { FieldRef } from '../member360-sections';
import { qualify } from '../member360-sections';
import { formatCell, formatCellExact } from '../format-cell';
import { SoftChip } from './soft-chip';

/** "21 Apr 2025 (412d ago)" → ["21 Apr 2025", "412d ago"] for two-line styling. */
function splitRelative(s: string): [string, string | null] {
  const m = /^(.*) \((.+)\)$/.exec(s);
  return m ? [m[1], m[2]] : [s, null];
}

function Step({ f, row }: { f: FieldRef; row: Record<string, unknown> | null }): ReactElement {
  const v = row?.[qualify(f.field)];
  const [date, rel] = splitRelative(formatCell(v, f.format));
  const exact = formatCellExact(v, f.format);
  return (
    <div style={{ flex: 1, position: 'relative', paddingTop: 14, minWidth: 90 }}>
      <span
        aria-hidden
        style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderRadius: 'var(--radius-pill)', background: 'var(--brand)' }}
      />
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{f.label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', cursor: exact ? 'help' : undefined }} title={exact ?? undefined}>
        {date}
      </div>
      {rel && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{rel}</div>}
    </div>
  );
}

/** Connector line between step dots, drawn per-step except the last. */
const connector: React.CSSProperties = {
  position: 'absolute',
  top: 4,
  left: 14,
  right: 6,
  height: 2,
  background: 'var(--border-card)',
};

export function AcquisitionStrip({
  timeline,
  chips,
  row,
}: {
  timeline: FieldRef[];
  chips: FieldRef[];
  row: Record<string, unknown> | null;
}): ReactElement {
  const chipEls = chips
    .map((f) => {
      const v = row?.[qualify(f.field)];
      if (v == null || v === '') return null;
      // Paid-install flag reads as a paid/organic chip rather than Yes/No.
      if (/^(is_|.*_install$)/.test(f.field)) {
        const truthy = v === true || v === 1 || v === '1';
        return (
          <SoftChip key={f.field} icon={f.icon} tone={truthy ? 'warning' : 'muted'}>
            {truthy ? 'paid install' : 'organic install'}
          </SoftChip>
        );
      }
      return (
        <SoftChip key={f.field} icon={f.icon} tone={f.field === 'media_source' ? 'info' : 'muted'}>
          {String(v)}
        </SoftChip>
      );
    })
    .filter(Boolean);

  return (
    <div>
      <div style={{ display: 'flex', gap: 0, marginTop: 4 }}>
        {timeline.map((f, i) => (
          <div key={f.field} style={{ flex: 1, position: 'relative', display: 'flex' }}>
            {i < timeline.length - 1 && <span aria-hidden style={connector} />}
            <Step f={f} row={row} />
          </div>
        ))}
      </div>
      {chipEls.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-card)' }}>
          {chipEls}
        </div>
      )}
    </div>
  );
}
