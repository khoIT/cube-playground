/**
 * Query Performance tab — live Cube query latency / status / pre-agg routing.
 *
 * Layout (huashu gate: base "triage table" + master-detail panel on row-click):
 *   - KPI strip (total / failures / p95 / Trino fallthrough / slow)
 *   - Failures & slow table (the actionable list; never sampled upstream)
 *   - default-CLOSED collapsible Successful-queries section (lazy-fetched)
 * Selecting a row opens the Optimize panel in a right-docked column.
 *
 * Mirrors preagg-runs-tab typography/spacing/tokens. Tokens only — no inline hex.
 */

import React, { useState } from 'react';
import { Gauge, ChevronRight, ChevronDown } from 'lucide-react';
import {
  useQueryPerfSummary,
  useQueryPerfFailures,
  useQueryPerfRecent,
  type QueryPerfRowDto,
  type QueryPerfSummaryDto,
} from './query-perf-data';
import { QueryPerfRow } from './query-perf-row';
import { QueryPerfOptimizePanel } from './query-perf-optimize-panel';

function Kpi({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 6, color: bad ? 'var(--destructive-ink)' : 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  );
}

function KpiStrip({ s }: { s: QueryPerfSummaryDto }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
      <Kpi label="Total (window)" value={s.total.toLocaleString()} />
      <Kpi label="Failures" value={s.failures.toLocaleString()} bad={s.failures > 0} />
      <Kpi label="p95 latency" value={`${(s.p95LatencyMs / 1000).toFixed(1)}s`} />
      <Kpi label="Trino fallthrough" value={s.fallthrough.toLocaleString()} />
      <Kpi label={`Slow >${(s.slowMs / 1000).toFixed(0)}s`} value={s.slow.toLocaleString()} />
    </div>
  );
}

const TH: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)',
  textAlign: 'left', padding: '10px 14px', borderBottom: '1px solid var(--border-card)', fontWeight: 600,
};

const COL_COUNT = 6;

/**
 * Failure/success table. Failure rows are expandable: clicking a row toggles an
 * inline recommendation row beneath it (verdict + remedy + draft YAML). Success
 * rows aren't expandable (no remedy to show).
 */
function RowTable({
  rows, expandedId, onToggle, expandable, slowMs,
}: {
  rows: QueryPerfRowDto[];
  expandedId: number | null;
  onToggle: (id: number) => void;
  expandable: boolean;
  slowMs?: number;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 10, overflow: 'hidden' }}>
      <thead>
        <tr>
          <th style={TH}>Status</th><th style={TH}>Latency</th><th style={TH}>Used in</th>
          <th style={TH}>Routing</th><th style={TH}>Query shape</th><th style={TH}>Game</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <React.Fragment key={r.id}>
            <QueryPerfRow
              row={r}
              expandable={expandable}
              expanded={expandable && r.id === expandedId}
              onToggle={onToggle}
              slowMs={slowMs}
            />
            {expandable && r.id === expandedId && (
              <tr data-testid={`qp-expand-${r.id}`}>
                <td colSpan={COL_COUNT} style={{ padding: '0 14px 14px', background: 'var(--surface-inset)' }}>
                  <QueryPerfOptimizePanel row={r} />
                </td>
              </tr>
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}

function SuccessSection() {
  const [open, setOpen] = useState(false);
  const { rows, loading } = useQueryPerfRecent(open);
  return (
    <div style={{ marginTop: 26 }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 10,
          padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)',
        }}
        data-testid="qp-success-toggle"
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Successful queries{rows.length ? ` (${rows.length})` : ''}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontWeight: 400 }}>
          {open ? (loading ? 'loading…' : '') : 'expand to load'}
        </span>
      </div>
      {open && rows.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <RowTable rows={rows} expandedId={null} onToggle={() => {}} expandable={false} />
        </div>
      )}
    </div>
  );
}

export function QueryPerfTab() {
  const { summary } = useQueryPerfSummary();
  const { rows, loading, error } = useQueryPerfFailures();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const toggle = (id: number) => setExpandedId((cur) => (cur === id ? null : id));

  return (
    <div role="tabpanel" id="hub-tab-panel-query-perf" aria-labelledby="hub-tab-query-perf" style={{ fontFamily: 'var(--font-sans)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Gauge size={18} style={{ color: 'var(--brand)' }} />
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Query Performance</h2>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)' }}>
        Live Cube query latency, status, and pre-aggregation routing. Failures are never sampled.
      </p>

      {summary && <KpiStrip s={summary} />}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
        Failures &amp; slow queries
        {summary && summary.failures > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 999, background: 'var(--destructive-soft)', color: 'var(--destructive-ink)' }}>
            {summary.failures} failing
          </span>
        )}
      </div>

      {error && <p style={{ fontSize: 13, color: 'var(--destructive-ink)' }}>{error}</p>}
      {!error && rows.length === 0 && !loading && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No failed or slow queries in the window. 🎉</p>
      )}

      {rows.length > 0 && (
        <RowTable rows={rows} expandedId={expandedId} onToggle={toggle} expandable slowMs={summary?.slowMs} />
      )}

      <SuccessSection />
    </div>
  );
}
