/**
 * CostBreakdownSection — org-wide LLM spend for the admin observability tab.
 *
 * Headline KPIs (total cost / sessions / turns / tokens) + a dimension
 * switcher (Users · Sessions · Games · Workspaces) rendering a cost-sorted
 * table. Range picker: 7d / 30d / 90d / all-time (default all-time).
 *
 * chat-down degrades to a muted "unreachable" note (breakdown: null), never
 * an error page. tokens.css only.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CollapseChevron } from './collapse-chevron';
import {
  useCostSummary,
  COST_RANGE_LABEL,
  type CostRangeKey,
  type CostSummary,
} from './cost-observability-data';

const card: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
};

const eyebrow: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', color: 'var(--text-muted)',
};

const th: React.CSSProperties = {
  ...eyebrow, textAlign: 'left', padding: '8px 14px',
  borderBottom: '1px solid var(--border-card)', whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  fontSize: 12.5, color: 'var(--text-secondary)', padding: '8px 14px',
  borderBottom: '1px solid var(--border-card)', whiteSpace: 'nowrap',
};

const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

/** $ with sensible precision: >=$1 → 2dp, smaller amounts keep 4dp. */
export function fmtUsd(v: number): string {
  return `$${v.toFixed(v >= 1 ? 2 : 4)}`;
}

/** Token counts abbreviated: 1234 → 1.2k, 5_600_000 → 5.6M. */
export function fmtTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

type Dimension = 'users' | 'sessions' | 'games' | 'workspaces' | 'auth';
const DIMENSIONS: Array<{ key: Dimension; label: string }> = [
  { key: 'users', label: 'Users' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'games', label: 'Games' },
  { key: 'workspaces', label: 'Workspaces' },
  { key: 'auth', label: 'Auth lane' },
];

/** Human label for an auth lane bucket (gateway key labels vs subscription). */
const AUTH_LANE_LABEL: Record<string, string> = {
  primary: 'Gateway · primary key',
  stg: 'Gateway · stg key',
  backup: 'Gateway · backup key',
  subscription: 'Subscription (OAuth)',
  unknown: 'Unrecorded (legacy turns)',
};

export function CostBreakdownSection() {
  const [range, setRange] = useState<CostRangeKey>('all');
  const [dimension, setDimension] = useState<Dimension>('users');
  // Secondary block on the org overview — collapsed by default so cost detail
  // doesn't dominate the triage view; expand on demand.
  const [open, setOpen] = useState(false);
  const { summary, loading, error } = useCostSummary(range);

  const breakdown = summary?.breakdown ?? null;

  return (
    <section style={{ ...card, marginTop: 12, overflow: 'hidden' }}>
      {/* Header: title + range picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: open ? '1px solid var(--border-card)' : 'none' }}>
        <CollapseChevron open={open} onToggle={() => setOpen((o) => !o)} label="Toggle cost breakdown" />
        <span
          onClick={() => setOpen((o) => !o)}
          style={{ display: 'flex', alignItems: 'baseline', gap: 8, cursor: 'pointer' }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Cost</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>LLM spend across the whole app</span>
        </span>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as CostRangeKey)}
          aria-label="Cost time range"
          style={{
            marginLeft: 'auto', fontSize: 12, fontFamily: 'var(--font-sans)',
            color: 'var(--text-primary)', background: 'var(--bg-card)',
            border: '1px solid var(--border-card)', borderRadius: 'var(--radius-sm)', padding: '4px 8px',
          }}
        >
          {(Object.keys(COST_RANGE_LABEL) as CostRangeKey[]).map((k) => (
            <option key={k} value={k}>{COST_RANGE_LABEL[k]}</option>
          ))}
        </select>
      </div>

      {open && (error ? (
        <div style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)' }}>
          Couldn't load cost data: {error}
        </div>
      ) : loading && !summary ? (
        <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : !breakdown ? (
        <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>
          — chat-service unreachable, cost data unavailable.
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, padding: '12px 14px' }}>
            <Kpi label="Total cost" value={fmtUsd(breakdown.total.cost_usd)} />
            <Kpi label="Sessions" value={String(breakdown.total.sessions)} />
            <Kpi label="Turns" value={String(breakdown.total.turns)} />
            <Kpi label="Input tokens" value={fmtTokens(breakdown.total.input_tokens)} />
            <Kpi label="Output tokens" value={fmtTokens(breakdown.total.output_tokens)} />
          </div>

          {/* Dimension switcher */}
          <div role="tablist" aria-label="Cost breakdown dimension" style={{ display: 'flex', gap: 4, padding: '0 14px 10px' }}>
            {DIMENSIONS.map((d) => {
              const active = d.key === dimension;
              return (
                <button
                  key={d.key}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => setDimension(d.key)}
                  style={{
                    fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                    padding: '4px 10px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
                    border: '1px solid var(--border-card)',
                    background: active ? 'var(--brand)' : 'var(--bg-card)',
                    color: active ? 'var(--text-on-brand)' : 'var(--text-secondary)',
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>

          <BreakdownTable dimension={dimension} breakdown={breakdown} />
        </>
      ))}
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={eyebrow}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, marginTop: 2, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function userCell(row: { email: string | null; owner_label: string | null; owner_id: string }) {
  if (row.email) {
    return (
      <Link
        to={`/admin/observability/users/${encodeURIComponent(row.email)}`}
        style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
        title="View activity"
      >
        {row.email}
      </Link>
    );
  }
  // Departed/unknown sub: fall back to the stamped display name, then the raw sub.
  return <span title={row.owner_id}>{row.owner_label ?? row.owner_id}</span>;
}

function BreakdownTable({
  dimension,
  breakdown,
}: {
  dimension: Dimension;
  breakdown: NonNullable<CostSummary['breakdown']>;
}) {
  const bucketCols = (
    <>
      <th style={{ ...th, textAlign: 'right' }}>Sessions</th>
      <th style={{ ...th, textAlign: 'right' }}>Turns</th>
      <th style={{ ...th, textAlign: 'right' }}>Tokens in / out</th>
      <th style={{ ...th, textAlign: 'right' }}>Cost</th>
    </>
  );
  const bucketCells = (r: { sessions: number; turns: number; input_tokens: number; output_tokens: number; cost_usd: number }) => (
    <>
      <td style={num}>{r.sessions}</td>
      <td style={num}>{r.turns}</td>
      <td style={num}>{fmtTokens(r.input_tokens)} / {fmtTokens(r.output_tokens)}</td>
      <td style={{ ...num, color: 'var(--text-primary)', fontWeight: 600 }}>{fmtUsd(r.cost_usd)}</td>
    </>
  );

  const empty = (label: string) => (
    <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>No {label} with spend in this range.</div>
  );

  const table = (head: React.ReactNode, body: React.ReactNode) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{head}</tr></thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );

  if (dimension === 'users') {
    if (breakdown.byUser.length === 0) return empty('users');
    return table(
      <><th style={th}>User</th>{bucketCols}</>,
      breakdown.byUser.map((r) => (
        <tr key={r.owner_id}><td style={td}>{userCell(r)}</td>{bucketCells(r)}</tr>
      )),
    );
  }

  if (dimension === 'games') {
    if (breakdown.byGame.length === 0) return empty('games');
    return table(
      <><th style={th}>Game</th>{bucketCols}</>,
      breakdown.byGame.map((r) => (
        <tr key={r.game_id}><td style={td}>{r.game_id}</td>{bucketCells(r)}</tr>
      )),
    );
  }

  if (dimension === 'workspaces') {
    if (breakdown.byWorkspace.length === 0) return empty('workspaces');
    return table(
      <><th style={th}>Workspace</th>{bucketCols}</>,
      breakdown.byWorkspace.map((r) => (
        <tr key={r.workspace}><td style={td}>{r.workspace}</td>{bucketCells(r)}</tr>
      )),
    );
  }

  if (dimension === 'auth') {
    const byAuth = breakdown.byAuth ?? [];
    if (byAuth.length === 0) return empty('auth lanes');
    return table(
      <><th style={th}>Auth lane</th>{bucketCols}</>,
      byAuth.map((r) => (
        <tr key={r.auth_label}>
          <td style={td}>{AUTH_LANE_LABEL[r.auth_label] ?? r.auth_label}</td>
          {bucketCells(r)}
        </tr>
      )),
    );
  }

  // Sessions: top-N by cost (server caps the list); note when truncated.
  if (breakdown.sessions.length === 0) return empty('sessions');
  return (
    <>
      {table(
        <>
          <th style={th}>Session</th>
          <th style={th}>User</th>
          <th style={th}>Game</th>
          <th style={th}>Workspace</th>
          <th style={{ ...th, textAlign: 'right' }}>Turns</th>
          <th style={{ ...th, textAlign: 'right' }}>Tokens in / out</th>
          <th style={{ ...th, textAlign: 'right' }}>Cost</th>
        </>,
        breakdown.sessions.map((s) => (
          <tr key={s.session_id}>
            <td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.session_id}>
              {s.title ?? 'Untitled'}
            </td>
            <td style={td}>{userCell(s)}</td>
            <td style={td}>{s.game_id}</td>
            <td style={td}>{s.workspace}</td>
            <td style={num}>{s.turns}</td>
            <td style={num}>{fmtTokens(s.input_tokens)} / {fmtTokens(s.output_tokens)}</td>
            <td style={{ ...num, color: 'var(--text-primary)', fontWeight: 600 }}>{fmtUsd(s.cost_usd)}</td>
          </tr>
        )),
      )}
      {breakdown.sessionTotal > breakdown.sessions.length && (
        <div style={{ padding: '8px 14px', fontSize: 11.5, color: 'var(--text-muted)' }}>
          Showing top {breakdown.sessions.length} of {breakdown.sessionTotal} sessions by cost.
        </div>
      )}
    </>
  );
}
