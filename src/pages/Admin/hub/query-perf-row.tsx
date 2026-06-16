/**
 * One captured-query row for the Query Performance failures/success tables.
 *
 * Status pill (504/502/400 → destructive, slow-200 → warning, 200 → success),
 * latency (red past the slow threshold), a routing badge (hit / miss / lambda?),
 * and the NAMES-only query shape as chips. Failure rows are expandable: a leading
 * chevron toggles an inline recommendation panel (rendered by the parent table).
 * No "Optimize" action button yet — that affordance is reserved for when a real
 * fix-activation flow is wired in.
 */

import React from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { QueryPerfRowDto } from './query-perf-data';

/** Fallback slow threshold (ms) when the server summary hasn't loaded yet. */
const DEFAULT_SLOW_MS = 3000;

function StatusPill({ row, slowMs }: { row: QueryPerfRowDto; slowMs: number }) {
  const slow = row.status === 200 && row.latencyMs >= slowMs;
  const label = row.status === 200 ? (slow ? 'slow 200' : '200') : String(row.status);
  const soft = row.status >= 400 ? 'var(--destructive-soft)' : slow ? 'var(--warning-soft)' : 'var(--success-soft)';
  const ink = row.status >= 400 ? 'var(--destructive-ink)' : slow ? 'var(--warning-ink)' : 'var(--success-ink)';
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: soft, color: ink }}>
      {label}
    </span>
  );
}

function RoutingBadge({ row }: { row: QueryPerfRowDto }) {
  const map: Record<string, { label: string; soft: string; ink: string }> = {
    hit: { label: 'pre-agg', soft: 'var(--success-soft)', ink: 'var(--success-ink)' },
    unknown: { label: 'lambda?', soft: 'var(--info-soft)', ink: 'var(--info-ink)' },
    miss: { label: 'raw Trino', soft: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
  };
  const m = map[row.preaggHit] ?? map.miss;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: m.soft, color: m.ink }}>
      {m.label}
    </span>
  );
}

function ShapeChips({ row }: { row: QueryPerfRowDto }) {
  const s = row.shape;
  if (!s) return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>;
  const cube = s.cubes[0] ?? '(query)';
  const members = [...s.measures, ...s.dimensions]
    .map((m) => (m.includes('.') ? `·${m.slice(m.indexOf('.') + 1)}` : m))
    .slice(0, 4);
  const chip: React.CSSProperties = {
    fontSize: 11, background: 'var(--surface-inset)', border: '1px solid var(--border-card)',
    borderRadius: 6, padding: '1px 6px', color: 'var(--text-secondary)',
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      <span style={{ ...chip, fontWeight: 600 }}>{cube}</span>
      {members.map((m, i) => <span key={i} style={chip}>{m}</span>)}
      {s.cubes.length + s.measures.length + s.dimensions.length > 5 && (
        <span style={{ ...chip, color: 'var(--text-muted)' }}>…</span>
      )}
    </div>
  );
}

export function QueryPerfRow({
  row, expanded = false, onToggle, expandable = true, slowMs = DEFAULT_SLOW_MS,
}: {
  row: QueryPerfRowDto;
  expanded?: boolean;
  onToggle?: (id: number) => void;
  /** Failure rows expand to a recommendation; success rows don't. */
  expandable?: boolean;
  slowMs?: number;
}) {
  const slow = row.status === 200 && row.latencyMs >= slowMs;
  const latBad = row.status >= 400 || slow;
  return (
    <tr
      onClick={() => expandable && onToggle?.(row.id)}
      style={{
        cursor: expandable ? 'pointer' : 'default',
        background: expanded ? 'var(--surface-inset)' : undefined,
        borderBottom: '1px solid var(--border-card)',
      }}
      data-testid={`qp-row-${row.id}`}
    >
      <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
        {expandable && (
          <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 6, color: 'var(--text-muted)' }}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
        <StatusPill row={row} slowMs={slowMs} />
      </td>
      <td style={{ padding: '11px 14px', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: latBad ? 'var(--destructive-ink)' : 'var(--text-primary)' }}>
        {(row.latencyMs / 1000).toFixed(1)}s
      </td>
      <td style={{ padding: '11px 14px' }}><RoutingBadge row={row} /></td>
      <td style={{ padding: '11px 14px' }}><ShapeChips row={row} /></td>
      <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>{row.game ?? '—'}</td>
    </tr>
  );
}
