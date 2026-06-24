/**
 * Ranked contributor list for the Delta view — the design's "Top contributors"
 * panel. Each row: rank · segment name + slice chip · divergent center-anchored
 * bar (red left = negative swing, green right = positive) · Δ · % of swing ·
 * hover Explore→ deep-link into Playground. Bars share one scale (max |Δ|) so
 * magnitudes read comparably. Tokens only.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { formatPct } from '../../../OpsConsole/ops-format';
import { DELTA_TIME_DIMENSION } from './delta-config';
import type { DeltaContributor } from './decompose-api';

function exploreUrl(measure: string, dimension: string, value: string, periodB: [string, string]): string {
  const query = {
    measures: [measure],
    dimensions: [dimension],
    timeDimensions: [{ dimension: DELTA_TIME_DIMENSION, granularity: 'day', dateRange: periodB }],
    filters: [{ member: dimension, operator: 'equals', values: [value] }],
  };
  return `/build?query=${encodeURIComponent(JSON.stringify(query))}`;
}

function ContributorRow({
  rank,
  c,
  dimensionLabel,
  maxAbs,
  fmt,
  measureId,
  dimensionId,
  periodB,
}: {
  rank: number;
  c: DeltaContributor;
  dimensionLabel: string;
  maxAbs: number;
  fmt: (n: number) => string;
  measureId: string;
  dimensionId: string;
  periodB: [string, string];
}) {
  const [hover, setHover] = React.useState(false);
  const up = c.delta >= 0;
  const ink = up ? 'var(--success-ink)' : 'var(--destructive-ink)';
  const halfWidth = maxAbs > 0 ? (Math.abs(c.delta) / maxAbs) * 50 : 0; // % of the half-track

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 4px',
        borderBottom: '1px solid var(--border-card)',
        background: hover ? 'var(--bg-muted)' : 'transparent',
      }}
    >
      <span style={{ width: 16, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'right' }}>
        {rank}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.value || '∅'}
        </div>
        <span
          style={{
            display: 'inline-block',
            marginTop: 4,
            fontSize: 10.5,
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: 'var(--radius-full)',
            background: c.isOther ? 'var(--muted-soft)' : 'var(--info-soft)',
            color: c.isOther ? 'var(--muted-ink)' : 'var(--info-ink)',
          }}
        >
          {c.isOther ? 'Bucketed' : dimensionLabel}
        </span>
      </div>

      {/* Divergent bar */}
      <div style={{ width: 160, height: 8, background: 'var(--surface-inset-strong)', borderRadius: 'var(--radius-full)', position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            ...(up ? { left: '50%' } : { right: '50%' }),
            width: `${halfWidth}%`,
            background: ink,
            borderRadius: 'var(--radius-full)',
          }}
        />
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--border-strong)' }} />
      </div>

      <span style={{ width: 96, textAlign: 'right', fontSize: 13, fontWeight: 700, color: ink, fontVariantNumeric: 'tabular-nums' }}>
        {up ? '+' : ''}{fmt(c.delta)}
      </span>
      <span style={{ width: 52, textAlign: 'right', fontSize: 11.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
        {c.pctOfSwing != null ? formatPct(c.pctOfSwing, 0) : '—'}
      </span>
      <span style={{ width: 60, textAlign: 'right' }}>
        {!c.isOther && c.value ? (
          <Link
            to={exploreUrl(measureId, dimensionId, c.value, periodB)}
            title={`Explore ${c.value} in Playground`}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--brand)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              opacity: hover ? 1 : 0,
              transition: 'opacity 0.1s',
            }}
          >
            Explore <ArrowUpRight size={12} />
          </Link>
        ) : null}
      </span>
    </div>
  );
}

export function ContributorRankedList({
  contributors,
  dimensionLabel,
  measureId,
  dimensionId,
  periodB,
  fmt,
}: {
  contributors: DeltaContributor[];
  dimensionLabel: string;
  measureId: string;
  dimensionId: string;
  periodB: [string, string];
  fmt: (n: number) => string;
}) {
  const maxAbs = contributors.reduce((m, c) => Math.max(m, Math.abs(c.delta)), 0);
  return (
    <div>
      {contributors.map((c, i) => (
        <ContributorRow
          key={c.value || `row-${i}`}
          rank={i + 1}
          c={c}
          dimensionLabel={dimensionLabel}
          maxAbs={maxAbs}
          fmt={fmt}
          measureId={measureId}
          dimensionId={dimensionId}
          periodB={periodB}
        />
      ))}
    </div>
  );
}
