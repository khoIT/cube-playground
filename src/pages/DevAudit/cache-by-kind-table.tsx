/**
 * CacheByKindTable — tiny per-kind row count + hit summary from kv_cache.
 *
 * Surfaces non-response_cache caches (cube /load, turn-detail audit) so the
 * dashboard reflects the whole cache surface, not just response_cache. Kept
 * deliberately small (one row per kind) since these caches don't have an
 * LLM cost / latency-saved formula to display.
 */

import React from 'react';
import { T } from '../../shell/theme';
import type { KvCacheKindStat } from '../../api/cache-effectiveness-types';

const KIND_LABELS: Record<string, string> = {
  load: 'cube /load rows',
  turn_detail: 'turn-detail audit',
};

const S = {
  root: {
    marginTop: 24,
    border: `1px solid var(--shell-border)`,
    borderRadius: 8,
    background: 'var(--surface-raised)',
    overflow: 'hidden',
  } as React.CSSProperties,
  header: {
    padding: '10px 12px',
    borderBottom: `1px solid var(--shell-border)`,
    background: 'var(--surface-subtle)',
    fontSize: 11,
    fontFamily: T.fMono,
    color: 'var(--shell-text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  } as React.CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 12,
    fontFamily: T.fMono,
  } as React.CSSProperties,
  th: {
    textAlign: 'left' as const,
    padding: '8px 12px',
    color: 'var(--shell-text-subtle)',
    fontWeight: 500,
    fontSize: 11,
    borderBottom: `1px solid var(--shell-border)`,
  } as React.CSSProperties,
  thRight: {
    textAlign: 'right' as const,
    padding: '8px 12px',
    color: 'var(--shell-text-subtle)',
    fontWeight: 500,
    fontSize: 11,
    borderBottom: `1px solid var(--shell-border)`,
  } as React.CSSProperties,
  td: {
    padding: '8px 12px',
    color: 'var(--shell-text-emphasis)',
    borderBottom: `1px solid var(--shell-bg-subtle)`,
  } as React.CSSProperties,
  tdRight: {
    padding: '8px 12px',
    color: 'var(--shell-text-emphasis)',
    borderBottom: `1px solid var(--shell-bg-subtle)`,
    textAlign: 'right' as const,
  } as React.CSSProperties,
  kindLabel: {
    color: 'var(--shell-text-emphasis)',
    fontWeight: 500,
  } as React.CSSProperties,
  kindSlug: {
    marginLeft: 6,
    color: 'var(--shell-text-faint)',
    fontSize: 11,
  } as React.CSSProperties,
};

function formatLastHit(ms: number | null): string {
  if (ms == null) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

export interface CacheByKindTableProps {
  rows: KvCacheKindStat[];
}

export function CacheByKindTable({ rows }: CacheByKindTableProps) {
  if (rows.length === 0) return null;

  return (
    <div style={S.root} data-testid="cache-by-kind-table">
      <div style={S.header}>Other caches (kv_cache)</div>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Kind</th>
            <th style={S.thRight}>Entries</th>
            <th style={S.thRight}>Hits</th>
            <th style={S.thRight}>Last hit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind} data-testid={`cache-by-kind-row-${r.kind}`}>
              <td style={S.td}>
                <span style={S.kindLabel}>{KIND_LABELS[r.kind] ?? r.kind}</span>
                {KIND_LABELS[r.kind] && (
                  <span style={S.kindSlug}>{r.kind}</span>
                )}
              </td>
              <td style={S.tdRight}>{r.entries.toLocaleString()}</td>
              <td style={S.tdRight}>{r.totalHits.toLocaleString()}</td>
              <td style={S.tdRight}>{formatLastHit(r.lastHitAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
