/**
 * KpiHeroStrip — horizontal row of 5 live KPI tiles + sparklines.
 *
 * Per-tile error boundary isolates failures: one broken tile renders "—"
 * without blanking the others. Gap-handled tiles (missing cube for game)
 * render with a tooltip explaining unavailability.
 */

import { Component, useState, useEffect, type ReactNode, type ErrorInfo } from 'react';
import { LiveBadge } from '../Segments/visuals/live-badge';
import { useLiveKpis } from './use-live-kpis';
import type { KpiTileData } from './use-live-kpis';
import { useAnomalies } from './anomaly-inbox/use-anomalies';
import { AnomalyTileBadge } from './anomaly-tile-badge';
import { KPI_CONFIG } from './kpi-config';
import { EditorialKpiTile } from './_ui/editorial-kpi-tile';

// ── Per-tile error boundary ───────────────────────────────────────────────

interface TileBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class TileErrorBoundary extends Component<
  { label: string; children: ReactNode },
  TileBoundaryState
> {
  state: TileBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): TileBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[KpiHeroStrip] tile render error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <EditorialKpiTile
          label={this.props.label}
          value={
            <span title={this.state.error?.message ?? 'Render error'} style={{ cursor: 'help' }}>
              —
            </span>
          }
          tone="neutral"
        />
      );
    }
    return this.props.children;
  }
}

// ── Skeleton tile ─────────────────────────────────────────────────────────

function SkeletonTile({ label }: { label: string }) {
  return (
    <div style={{
      padding: '16px 16px 14px',
      borderTop: '1px solid var(--border-card)',
    }}>
      <p style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        fontWeight: 500,
        color: 'var(--text-muted)',
        margin: '0 0 8px',
      }}>
        {label}
      </p>
      <div style={{
        height: 24,
        width: '60%',
        borderRadius: 4,
        background: 'var(--bg-muted)',
      }} />
    </div>
  );
}

// ── Tile → anomaly metric mapping ─────────────────────────────────────────
// Maps KPI tile id to the measure(s) it can match in the anomalies list.
// ARPDAU is derived (numerator + denominator) so both measures are included.

const TILE_MEASURES: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const kpi of KPI_CONFIG) {
    if (kpi.measure) {
      out[kpi.id] = [kpi.measure];
    } else if (kpi.derived) {
      out[kpi.id] = [kpi.derived.numerator, kpi.derived.denominator];
    }
  }
  return out;
})();

// ── Single tile renderer ──────────────────────────────────────────────────

function LiveKpiTile({ tile }: { tile: KpiTileData }) {
  const valueNode =
    tile.unavailable ? (
      <span title={tile.unavailableReason} style={{ cursor: 'help', color: 'var(--text-muted)' }}>
        —
      </span>
    ) : tile.error ? (
      <span title={tile.error.message} style={{ cursor: 'help', color: 'var(--text-muted)' }}>
        —
      </span>
    ) : (
      tile.value
    );

  return (
    <EditorialKpiTile
      label={tile.label}
      value={valueNode}
      delta={tile.delta ?? undefined}
      tone={tile.tone}
      sparkline={tile.sparkline}
    />
  );
}

// ── Relative-time badge label ─────────────────────────────────────────────

function secondsAgo(date: Date): string {
  const diff = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

/** Refreshes its text every 5s without triggering a data refetch. */
function RefreshBadge({ lastRefresh }: { lastRefresh: Date | null }) {
  // Tick counter solely to re-render the relative timestamp every 5s.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const label = lastRefresh ? `Updated ${secondsAgo(lastRefresh)}` : 'Loading…';
  return <LiveBadge label={label} size="sm" />;
}

// ── Strip ─────────────────────────────────────────────────────────────────

const SKELETON_LABELS = ['DAU', 'MAU', 'Revenue (VND)', 'Paying users', 'ARPDAU'];

interface KpiHeroStripProps {
  gameId: string;
}

export function KpiHeroStrip({ gameId }: KpiHeroStripProps) {
  const { tiles, loading, lastRefresh } = useLiveKpis(gameId);
  const { anomalies } = useAnomalies(gameId);

  const showSkeletons = loading && tiles.length === 0;

  // Build a map: metric → highest severity among open anomalies
  const anomalyBySeverity = new Map<string, 'low' | 'med' | 'high'>();
  const severityRank = { high: 2, med: 1, low: 0 } as const;
  for (const a of anomalies) {
    const existing = anomalyBySeverity.get(a.metric);
    if (!existing || severityRank[a.severity] > severityRank[existing]) {
      anomalyBySeverity.set(a.metric, a.severity);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      {/* Section header — sentence case, sans-serif, refresh badge right-aligned */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}>
          Hero metrics
        </div>
        <RefreshBadge lastRefresh={lastRefresh} />
      </div>

      {/* Tile row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 12,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '0 4px',
      }}>
        {showSkeletons
          ? SKELETON_LABELS.map((label) => <SkeletonTile key={label} label={label} />)
          : tiles.map((tile) => {
              // Find highest-severity open anomaly matching any of this tile's measures
              const measures = TILE_MEASURES[tile.id] ?? [];
              let tileSeverity: 'low' | 'med' | 'high' | null = null;
              let tileMetric: string | null = null;
              for (const m of measures) {
                const sev = anomalyBySeverity.get(m);
                if (sev && (!tileSeverity || severityRank[sev] > severityRank[tileSeverity])) {
                  tileSeverity = sev;
                  tileMetric = m;
                }
              }
              return (
                // C3: key includes gameId so boundary resets on game switch —
                // prevents a tile that errored on game A from staying in error
                // state when switching to game B.
                <TileErrorBoundary key={`${gameId}:${tile.id}`} label={tile.label}>
                  <div style={{ position: 'relative' }}>
                    <LiveKpiTile tile={tile} />
                    {/* Surface 3: anomaly dot overlay */}
                    {tileSeverity && tileMetric && (
                      <AnomalyTileBadge severity={tileSeverity} metric={tileMetric} />
                    )}
                  </div>
                </TileErrorBoundary>
              );
            })}
      </div>
    </div>
  );
}
