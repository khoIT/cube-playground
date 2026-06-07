/**
 * Monetization band — one dominant lifetime stat, inline secondary stats, and
 * an IAP-vs-Web split ratio bar derived from the same profile row (no extra
 * query). The paying flag intentionally lives in the hero badges, not here.
 */

import { ReactElement } from 'react';
import type { FieldRef, SplitSegmentRef } from '../member360-sections';
import { qualify } from '../member360-sections';
import { formatCell, formatCellExact } from '../format-cell';

const SEGMENT_COLOR: Record<SplitSegmentRef['tone'], string> = {
  brand: 'var(--brand)',
  info: 'var(--info)',
};

function num(row: Record<string, unknown> | null, field: string): number | null {
  const v = row?.[qualify(field)];
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function Stat({ f, row }: { f: FieldRef; row: Record<string, unknown> | null }): ReactElement {
  const v = row?.[qualify(f.field)];
  const exact = formatCellExact(v, f.format);
  return (
    <div style={{ minWidth: 96 }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>{f.label}</div>
      <div
        style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', cursor: exact ? 'help' : undefined }}
        title={exact ?? undefined}
      >
        {formatCell(v, f.format)}
      </div>
    </div>
  );
}

function SplitBar({
  split,
  total,
  row,
}: {
  split: SplitSegmentRef[];
  total: FieldRef;
  row: Record<string, unknown>;
}): ReactElement | null {
  const totalN = num(row, total.field);
  if (totalN == null || totalN <= 0) return null;
  const parts = split
    .map((seg) => ({ seg, n: num(row, seg.field) ?? 0 }))
    .filter((p) => p.n > 0);
  if (parts.length === 0) return null;
  // Channels outside the configured splits render as a neutral remainder.
  const other = Math.max(0, totalN - parts.reduce((s, p) => s + p.n, 0));
  const pct = (n: number): number => (n / totalN) * 100;
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{ height: 8, borderRadius: 'var(--radius-pill)', overflow: 'hidden', display: 'flex', background: 'var(--bg-muted)' }}
        role="img"
        aria-label={`${total.label} split`}
      >
        {parts.map((p) => (
          <span key={p.seg.field} style={{ width: `${pct(p.n)}%`, background: SEGMENT_COLOR[p.seg.tone] }} />
        ))}
        {other > 0 && <span style={{ width: `${pct(other)}%`, background: 'var(--border-strong)' }} />}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
        {parts.map((p) => (
          <span key={p.seg.field} title={formatCellExact(p.n, 'currency') ?? undefined}>
            <span
              aria-hidden
              style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 'var(--radius-pill)', marginRight: 4, background: SEGMENT_COLOR[p.seg.tone] }}
            />
            {p.seg.label} {formatCell(p.n, 'currency')} ({Math.round(pct(p.n))}%)
          </span>
        ))}
        {other > 0 && (
          <span title={formatCellExact(other, 'currency') ?? undefined}>
            <span
              aria-hidden
              style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 'var(--radius-pill)', marginRight: 4, background: 'var(--border-strong)' }}
            />
            Other {formatCell(other, 'currency')} ({Math.round(pct(other))}%)
          </span>
        )}
      </div>
    </div>
  );
}

export function MonetizationBand({
  config,
  row,
}: {
  config: { primary: FieldRef; stats: FieldRef[]; split?: SplitSegmentRef[] };
  row: Record<string, unknown> | null;
}): ReactElement {
  const primaryV = row?.[qualify(config.primary.field)];
  const primaryExact = formatCellExact(primaryV, config.primary.format);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{config.primary.label}</div>
          <div
            style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, color: 'var(--text-primary)', cursor: primaryExact ? 'help' : undefined }}
            title={primaryExact ?? undefined}
          >
            {formatCell(primaryV, config.primary.format)}
          </div>
        </div>
        {config.stats.map((f) => (
          <Stat key={f.field} f={f} row={row} />
        ))}
      </div>
      {config.split && row && <SplitBar split={config.split} total={config.primary} row={row} />}
    </div>
  );
}
