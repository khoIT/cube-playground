/**
 * PortfolioStrip — 5-stat summary bar at the top of the CS Monitor.
 *
 * Stats:
 *   1. Playbooks live / total
 *   2. VIPs triggered now (open cases)
 *   3. Open cases
 *   4. Blended KPI attainment %
 *   5. SLA breaches
 *
 * Uses design tokens exclusively (var(--*)). Mirrors the stat-card style from
 * the flow prototype (VIP Care CS Console Flow.html).
 */

import React from 'react';
import type { PortfolioStats } from './use-care-playbooks';

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: 'neutral' | 'good' | 'warn' | 'bad';
}

const ACCENT_COLOR: Record<NonNullable<StatCardProps['accent']>, string> = {
  neutral: 'var(--text-primary)',
  good: 'var(--success-ink)',
  warn: 'var(--warning-ink)',
  bad: 'var(--destructive-ink)',
};

function StatCard({ label, value, sub, accent = 'neutral' }: StatCardProps) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-xl)',
        padding: '14px 16px',
        boxShadow: 'var(--shadow-sm)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          fontWeight: 500,
          marginBottom: 7,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 23,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          color: ACCENT_COLOR[accent],
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>{sub}</div>
      )}
    </div>
  );
}

// ── Skeleton (loading state) ──────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-xl)',
        padding: '14px 16px',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div
        style={{
          height: 11,
          width: '60%',
          background: 'var(--bg-muted)',
          borderRadius: 4,
          marginBottom: 11,
        }}
      />
      <div
        style={{
          height: 23,
          width: '45%',
          background: 'var(--bg-muted)',
          borderRadius: 4,
        }}
      />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}

// ── Main component ────────────────────────────────────────────────────────────

interface PortfolioStripProps {
  stats: PortfolioStats;
  loading?: boolean;
}

export function PortfolioStrip({ stats, loading }: PortfolioStripProps) {
  const stripStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: 12,
    marginBottom: 22,
  };

  if (loading) {
    return (
      <div style={stripStyle}>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  const attainmentAccent: StatCardProps['accent'] =
    stats.attainmentRate === null
      ? 'neutral'
      : stats.attainmentRate >= 0.8
      ? 'good'
      : stats.attainmentRate >= 0.5
      ? 'warn'
      : 'bad';

  const slaAccent: StatCardProps['accent'] = stats.slaBreaches > 0 ? 'bad' : 'good';

  return (
    <div style={stripStyle}>
      <StatCard
        label="Playbooks live"
        value={
          <>
            {stats.livePlaybooks}
            <small
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginLeft: 4 }}
            >
              / {stats.totalPlaybooks}
            </small>
          </>
        }
        sub="available + partial"
      />
      <StatCard
        label="VIPs triggered"
        value={stats.vipsTriggered}
        sub="with open cases"
        accent={stats.vipsTriggered > 0 ? 'warn' : 'neutral'}
      />
      <StatCard
        label="Open cases"
        value={stats.openCases}
        sub={stats.openCases === 0 ? 'queue clear' : 'new + in review'}
        accent={stats.openCases > 0 ? 'warn' : 'neutral'}
      />
      <StatCard
        label="KPI attainment"
        value={fmtPct(stats.attainmentRate)}
        sub={stats.attainmentRate === null ? 'no data yet' : 'treated / total closed'}
        accent={attainmentAccent}
      />
      <StatCard
        label="KPI met %"
        value={fmtPct(stats.kpiMetRate ?? null)}
        sub={stats.kpiMetRate === null ? 'no outcomes yet' : 'met / closed with outcome'}
        accent={
          stats.kpiMetRate === null
            ? 'neutral'
            : stats.kpiMetRate >= 0.8
            ? 'good'
            : stats.kpiMetRate >= 0.5
            ? 'warn'
            : 'bad'
        }
      />
      <StatCard
        label="SLA breaches"
        value={stats.slaBreaches}
        sub="open cases past SLA"
        accent={slaAccent}
      />
    </div>
  );
}
