/**
 * Ops Console hero/stat card. Promotes the CS portfolio-strip StatCard idiom with
 * an optional Δ-vs-prior pill (shown only when a delta is provided — i.e. 7d).
 * Tokens only.
 */
import React from 'react';
import { formatDeltaPct } from './ops-format';

export type OpsCardAccent = 'neutral' | 'good' | 'warn' | 'bad';

const ACCENT_COLOR: Record<OpsCardAccent, string> = {
  neutral: 'var(--text-primary)',
  good: 'var(--success-ink)',
  warn: 'var(--warning-ink)',
  bad: 'var(--destructive-ink)',
};

interface OpsStatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** Δ-vs-prior as a signed fraction; null/undefined hides the pill. */
  delta?: number | null;
  /** When higher is worse (e.g. negative tickets), invert the pill colour. */
  deltaInverse?: boolean;
  accent?: OpsCardAccent;
  loading?: boolean;
}

export function OpsStatCard({
  label,
  value,
  sub,
  delta,
  deltaInverse,
  accent = 'neutral',
  loading,
}: OpsStatCardProps) {
  const showDelta = delta != null;
  const up = (delta ?? 0) >= 0;
  const good = deltaInverse ? !up : up;

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
        }}
      >
        {label}
      </div>

      {loading ? (
        <div style={{ height: 23, width: '50%', background: 'var(--bg-muted)', borderRadius: 4 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
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
          {showDelta && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: good ? 'var(--success-ink)' : 'var(--destructive-ink)',
                background: good ? 'var(--success-soft)' : 'var(--destructive-soft)',
                padding: '2px 6px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              {formatDeltaPct(delta!)}
            </span>
          )}
        </div>
      )}

      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>{sub}</div>}
    </div>
  );
}
