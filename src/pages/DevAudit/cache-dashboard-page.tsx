/**
 * CacheDashboardPage — /dev/chat-audit/cache tab content.
 *
 * Orchestrates: FilterBar (game + days + topN + refresh) → Hero grid →
 * Top queries table. Handles loading skeleton, error, and empty states.
 *
 * Mounts inside DevAuditShell; the shell owns the tab bar + banner.
 */

import React, { useCallback, useState } from 'react';
import { T } from '../../shell/theme';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { getOwnerId } from '../../api/chat-owner-id';
import { useCacheEffectiveness } from './use-cache-effectiveness';
import { CacheDashboardHero } from './cache-dashboard-hero';
import { CacheDashboardTopQueries } from './cache-dashboard-top-queries';
import { CacheStaleBanner } from './cache-stale-banner';

const DAY_OPTIONS = [7, 30, 90] as const;
const TOP_N_OPTIONS = [10, 20, 50] as const;
type DayOption = (typeof DAY_OPTIONS)[number];
type TopNOption = (typeof TOP_N_OPTIONS)[number];

// ── styles ────────────────────────────────────────────────────────────────────

const S = {
  root: {
    flex: 1,
    overflow: 'auto',
    padding: '20px 16px',
    fontFamily: T.fSans,
    background: T.surface,
  } as React.CSSProperties,
  filterBar: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    marginBottom: 16,
    fontSize: 11,
    color: T.n500,
  } as React.CSSProperties,
  select: {
    padding: '3px 8px',
    border: `1px solid ${T.n300}`,
    borderRadius: 4,
    fontSize: 12,
    background: T.surface,
    color: T.n800,
    cursor: 'pointer',
    fontFamily: T.fSans,
  } as React.CSSProperties,
  refreshBtn: {
    marginLeft: 'auto',
    padding: '3px 10px',
    border: `1px solid ${T.n300}`,
    background: T.surface,
    borderRadius: 4,
    fontSize: 11,
    fontFamily: T.fMono,
    color: T.n700,
    cursor: 'pointer',
  } as React.CSSProperties,
  skeleton: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
    marginBottom: 16,
  } as React.CSSProperties,
  skeletonCard: {
    height: 96,
    background: T.surfaceSubtle,
    borderRadius: 8,
    border: `1px solid ${T.n200}`,
  } as React.CSSProperties,
  skeletonTable: {
    height: 200,
    background: T.surfaceSubtle,
    borderRadius: 8,
    border: `1px solid ${T.n200}`,
    marginTop: 40,
  } as React.CSSProperties,
  error: {
    padding: 16,
    color: T.red500,
    fontSize: 13,
    fontFamily: T.fMono,
  } as React.CSSProperties,
  empty: {
    padding: '48px 16px',
    textAlign: 'center' as const,
    color: T.n500,
    fontSize: 13,
  } as React.CSSProperties,
  emptyHint: {
    display: 'block',
    marginTop: 8,
    fontSize: 11,
    color: T.n400,
    fontFamily: T.fMono,
  } as React.CSSProperties,
};

// ── skeleton shown while loading ──────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <>
      <div style={S.skeleton} data-testid="cache-loading-skeleton">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={S.skeletonCard} />
        ))}
      </div>
      <div style={S.skeletonTable} />
    </>
  );
}

// ── empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={S.empty} data-testid="cache-empty-state">
      No cache activity yet — first cached response will appear here.
      <span style={S.emptyHint}>
        Enable RESPONSE_CACHE_ENABLED=true and reuse turns to populate.
      </span>
    </div>
  );
}

// ── page component ────────────────────────────────────────────────────────────

export function CacheDashboardPage() {
  const activeGameId = useActiveGameId();
  const [days, setDays] = useState<DayOption>(30);
  const [topN, setTopN] = useState<TopNOption>(20);

  const { data, isLoading, error, refresh } = useCacheEffectiveness({
    gameId: activeGameId || undefined,
    days,
    topN,
  });

  /** Clear cache via DELETE /api/chat/debug/cache — banner passes this down. */
  const handleClearCache = useCallback(async () => {
    const qs = activeGameId
      ? `?game=${encodeURIComponent(activeGameId)}`
      : '';
    try {
      await fetch(`/api/chat/debug/cache${qs}`, {
        method: 'DELETE',
        headers: { 'X-Owner-Id': getOwnerId() },
      });
    } catch (err) {
      console.error('[CacheDashboardPage] clear cache failed:', err);
    }
    // Refresh stats after clear regardless of response
    refresh();
  }, [activeGameId, refresh]);

  const isEmpty =
    !isLoading &&
    !error &&
    data != null &&
    (data.summary.hitRate == null || data.summary.hitRate === 0) &&
    data.topQueries.length === 0;

  return (
    <div style={S.root} data-testid="cache-dashboard-page">
      {/* Filter bar */}
      <div style={S.filterBar}>
        <label htmlFor="cache-days-select">Window:</label>
        <select
          id="cache-days-select"
          value={days}
          onChange={(e) => setDays(Number(e.target.value) as DayOption)}
          style={S.select}
          aria-label="Days window"
          data-testid="cache-days-select"
        >
          {DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>{d}d</option>
          ))}
        </select>

        <label htmlFor="cache-topn-select" style={{ marginLeft: 12 }}>Top:</label>
        <select
          id="cache-topn-select"
          value={topN}
          onChange={(e) => setTopN(Number(e.target.value) as TopNOption)}
          style={S.select}
          aria-label="Top N queries"
          data-testid="cache-topn-select"
        >
          {TOP_N_OPTIONS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>

        <button
          onClick={refresh}
          style={S.refreshBtn}
          aria-label="Refresh cache data"
          data-testid="cache-refresh-btn"
        >
          refresh
        </button>
      </div>

      {/* Loading */}
      {isLoading && <LoadingSkeleton />}

      {/* Error */}
      {error && !isLoading && (
        <div style={S.error} data-testid="cache-error">
          Error: {error}
        </div>
      )}

      {/* Empty */}
      {isEmpty && <EmptyState />}

      {/* Data */}
      {!isLoading && !error && data != null && !isEmpty && (
        <>
          <CacheStaleBanner
            data={data}
            onClearCache={handleClearCache}
            gameId={activeGameId || undefined}
          />
          <CacheDashboardHero data={data} days={days} />
          <CacheDashboardTopQueries rows={data.topQueries} topN={topN} />
        </>
      )}
    </div>
  );
}
