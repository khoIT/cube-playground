/**
 * Ranked contributor list for the Delta view — the design's "Top contributors"
 * panel. Each row: rank badge · segment name · divergent center-anchored bar
 * (red left = negative swing, green right = positive) · Δ · % of swing · hover
 * Explore→ deep-link into Playground. Bars share one scale (max |Δ|) so
 * magnitudes read comparably.
 *
 * The decompose-by dimension is NOT repeated per row — it's stated once in the
 * card header, so a per-row pill would be redundant noise. Only the rolled-up
 * tail carries a "Bucketed" chip, which is genuinely distinguishing. Tokens only.
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
  maxAbs,
  fmt,
  measureId,
  dimensionId,
  periodB,
}: {
  rank: number;
  c: DeltaContributor;
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
  const canExplore = !c.isOther && !!c.value;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 4px',
        borderBottom: '1px solid var(--border-card)',
        background: hover ? 'var(--bg-muted)' : 'transparent',
      }}
    >
      {/* rank badge — fixed square so names left-align regardless of 1 vs 2 digits */}
      <span
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-muted)',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--text-muted)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {rank}
      </span>

      {/* segment name owns its line; only the rolled-up tail gets a chip */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.value || '∅'}
        </span>
        {c.isOther && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 7px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--muted-soft)',
              color: 'var(--muted-ink)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Bucketed
          </span>
        )}
      </div>

      {/* Divergent bar */}
      <div style={{ flexShrink: 0, width: 132, height: 8, background: 'var(--surface-inset-strong)', borderRadius: 'var(--radius-full)', position: 'relative', overflow: 'hidden' }}>
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

      <span style={{ flexShrink: 0, width: 92, textAlign: 'right', fontSize: 13, fontWeight: 700, color: ink, fontVariantNumeric: 'tabular-nums' }}>
        {up ? '+' : ''}{fmt(c.delta)}
      </span>
      <span style={{ flexShrink: 0, width: 40, textAlign: 'right', fontSize: 11.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
        {c.pctOfSwing != null ? formatPct(c.pctOfSwing, 0) : '—'}
      </span>
      {/* Explore — reserves width so columns never reflow on hover */}
      <span style={{ flexShrink: 0, width: 58, textAlign: 'right' }}>
        {canExplore && (
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
        )}
      </span>
    </div>
  );
}

export function ContributorRankedList({
  contributors,
  measureId,
  dimensionId,
  periodB,
  fmt,
}: {
  contributors: DeltaContributor[];
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
