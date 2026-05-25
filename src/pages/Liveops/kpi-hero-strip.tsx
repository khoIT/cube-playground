/**
 * KpiHeroStrip — horizontal row of 5 live KPI tiles + sparklines.
 *
 * Per-tile error boundary isolates failures: one broken tile renders "—"
 * without blanking the others. Gap-handled tiles (missing cube for game)
 * render with a tooltip explaining unavailability.
 */

import { Component, useState, useEffect, type ReactNode, type ErrorInfo } from 'react';
import { KpiTile } from '../Segments/visuals/kpi-tile';
import { Sparkline } from '../Segments/visuals/sparkline';
import { LiveBadge } from '../Segments/visuals/live-badge';
import { useLiveKpis } from './use-live-kpis';
import type { KpiTileData } from './use-live-kpis';

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
        <KpiTile
          label={this.props.label}
          value="—"
          tone="neutral"
          footer={
            <span title={this.state.error?.message ?? 'Render error'} style={{ cursor: 'help' }}>
              error
            </span>
          }
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
      padding: '14px 16px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-card)',
      borderRadius: 'var(--radius-lg)',
      minWidth: 140,
      flex: '1 1 0',
    }}>
      <p style={{
        fontSize: 11.5,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--text-muted)',
        margin: '0 0 6px',
        fontWeight: 500,
      }}>
        {label}
      </p>
      <div style={{
        height: 28,
        width: '60%',
        borderRadius: 4,
        background: 'var(--neutral-100)',
        opacity: 0.6,
      }} />
    </div>
  );
}

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

  // KpiTile wraps footer in <p> so block elements (Sparkline's div) can't go
  // there. Render sparkline as a sibling below the tile instead.
  return (
    <div>
      <KpiTile
        label={tile.label}
        value={valueNode}
        delta={tile.delta ?? undefined}
        tone={tile.tone}
      />
      {tile.sparkline.length > 0 && (
        <div style={{ padding: '0 16px 10px', marginTop: -4 }}>
          <Sparkline data={tile.sparkline} height={28} />
        </div>
      )}
    </div>
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

  const showSkeletons = loading && tiles.length === 0;

  return (
    <div style={{ padding: '16px 20px 0' }}>
      {/* Strip header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.005em',
        }}>
          Live KPIs
        </span>
        <RefreshBadge lastRefresh={lastRefresh} />
      </div>

      {/* Tile row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 12,
      }}>
        {showSkeletons
          ? SKELETON_LABELS.map((label) => <SkeletonTile key={label} label={label} />)
          : tiles.map((tile) => (
              // C3: key includes gameId so boundary resets on game switch —
              // prevents a tile that errored on game A from staying in error
              // state when switching to game B.
              <TileErrorBoundary key={`${gameId}:${tile.id}`} label={tile.label}>
                <LiveKpiTile tile={tile} />
              </TileErrorBoundary>
            ))}
      </div>
    </div>
  );
}
