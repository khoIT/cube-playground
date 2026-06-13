/**
 * CubestoreStoragePanel — what pre-aggregations are actually MATERIALISED in
 * CubeStore (read from system.* over the MySQL wire), grouped by schema.
 *
 * The key signal: a pre-agg can be registered (tables exist) yet have ZERO
 * active partitions — defined but not sealed, so queries fall through to source.
 * That "registered, not active" state is exactly what made the readiness matrix
 * read green-but-passthrough; here it is explicit. Tokens only — no inline hex.
 */

import React from 'react';
import type { CubestoreStorage, PreaggMaterialization } from './cubestore-data';

const card: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
};
const eyebrow: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', color: 'var(--text-muted)',
};
const th: React.CSSProperties = { ...eyebrow, textAlign: 'left', padding: '6px 12px' };
const td: React.CSSProperties = { padding: '6px 12px', fontSize: 12, color: 'var(--text-primary)', borderTop: '1px solid var(--border-card)', verticalAlign: 'top' };

function fmtBytes(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

function age(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

type Tone = 'success' | 'warning' | 'muted';
function stateOf(p: PreaggMaterialization): { tone: Tone; label: string } {
  if (p.activePartitions > 0 && p.readyCount > 0) return { tone: 'success', label: 'serving' };
  if (p.tableCount > 0) return { tone: 'warning', label: 'registered · not active' };
  return { tone: 'muted', label: 'empty' };
}

function StateChip({ tone, label }: { tone: Tone; label: string }) {
  const map = {
    success: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
    warning: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
    muted: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
  } as const;
  return (
    <span style={{ background: map[tone].bg, color: map[tone].ink, borderRadius: 'var(--radius-sm)', padding: '1px 7px', fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

export function CubestoreStoragePanel({ data, loading, error }: {
  data: CubestoreStorage | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return <div style={{ ...card, padding: '12px 16px', fontSize: 12.5, color: 'var(--destructive-ink)' }}>Could not load CubeStore storage: {error}</div>;
  }
  if (!data && loading) {
    return <div style={{ ...card, padding: '12px 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>Loading CubeStore storage…</div>;
  }
  if (!data) return null;

  if (!data.enabled) {
    return (
      <div style={{ ...card, padding: '12px 16px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        CubeStore introspection is off on this gateway. Set <code>CUBESTORE_INTROSPECT_ENABLED=true</code>
        {' '}(and a reachable <code>CUBESTORE_MYSQL_HOST/PORT</code>) to read materialised pre-aggregations here.
      </div>
    );
  }
  if (data.error) {
    return <div style={{ ...card, padding: '12px 16px', fontSize: 12.5, color: 'var(--warning-ink)' }}>CubeStore unreachable: {data.error}</div>;
  }
  if (data.schemas.length === 0) {
    return <div style={{ ...card, padding: '12px 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>No pre-aggregation tables found in CubeStore.</div>;
  }

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      {data.schemas.map((s, i) => (
        <div key={s.schema} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-card)' }}>
          <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'baseline', gap: 8, background: 'var(--bg-subtle, var(--muted-soft))' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{s.schema}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.preaggs.length} pre-agg{s.preaggs.length === 1 ? '' : 's'}</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Pre-aggregation</th>
                <th style={th}>State</th>
                <th style={{ ...th, textAlign: 'right' }}>Partitions</th>
                <th style={{ ...th, textAlign: 'right' }}>Rows</th>
                <th style={{ ...th, textAlign: 'right' }}>Size</th>
                <th style={{ ...th, textAlign: 'right' }}>Data through</th>
              </tr>
            </thead>
            <tbody>
              {s.preaggs.map((p) => {
                const st = stateOf(p);
                return (
                  <tr key={p.base}>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 11 }} title={p.base}>{p.base}</td>
                    <td style={td}><StateChip tone={st.tone} label={st.label} /></td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: p.activePartitions > 0 ? 'var(--success-ink)' : 'var(--text-muted)' }}>{p.activePartitions}</span>
                      <span style={{ color: 'var(--text-muted)' }}>/{p.partitions}</span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.rows ? p.rows.toLocaleString() : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtBytes(p.bytes)}</td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--text-muted)' }} title={p.buildRangeEnd ?? ''}>{age(p.buildRangeEnd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
