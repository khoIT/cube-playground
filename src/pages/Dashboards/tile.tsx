/**
 * Dashboard tile shell — reads its data from the server-side tile cache.
 *
 * Tiles render from the cached result the refresh cron stores; they do not fire
 * their own Cube query. When the cache carries the full Cube load response, the
 * tile rebuilds a real ResultSet and renders through the SAME chart engine as
 * the playground (chart type + pivot + series parity), plus a chart-type toggle
 * that persists. Legacy tiles (rows-only cache) fall back to the lightweight
 * rows-based renderer.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResultSet, type ChartType, type PivotConfig } from '@cubejs-client/core';
import { TileVizBody } from './tile-viz-renderers';
import { PlaygroundChartRenderer } from '../../QueryBuilderV2/components/ChartRenderer';
import { ChartTypeToggle } from '../../QueryBuilderV2/components/chart-type-toggle';
import { TileChartBoundary } from './tile-chart-boundary';
import { dashboardsClient } from '../../api/dashboards-client';
import type { DashboardTile as TileModel, TileCacheView, VizType } from '../../api/dashboards-client';

interface TileProps {
  tile: TileModel;
  slug: string;
  gameId: string;
  onDelete?: (tileId: number) => void;
  onTitleChange?: (tileId: number, title: string) => void;
}

const tileStyle: React.CSSProperties = {
  background: 'var(--bg-card, #fff)',
  borderRadius: 10,
  border: '1px solid var(--border-card, #e5e7eb)',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
  position: 'relative',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
  gap: 8,
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary, #111)',
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  cursor: 'text',
};

/** Coarse stored viz_type → a Cube chart type for legacy tiles missing chart_type. */
function vizToChartType(viz: VizType): ChartType {
  switch (viz) {
    case 'kpi':
      return 'number';
    case 'bar':
      return 'bar';
    case 'table':
      return 'table';
    default:
      return 'line';
  }
}

/**
 * Normalize a persisted Cube `/load` response into the wrapper shape the chart
 * engine requires: `{ queryType, results: [{ data, annotation, query }], pivotQuery }`.
 *
 * `ChartRenderer` reads `resultSet.loadResponse.results[0].data`/`.annotation`
 * directly, so a bare ResultSet built from the legacy single-result shape
 * (`{ data, annotation, query }` at top level — what some Cube backends return)
 * would throw at render time. We accept BOTH shapes and lift the legacy one into
 * the wrapper so old cached tiles render without a re-pin/refresh. Returns null
 * when the response can't drive the engine → caller takes the legacy rows path.
 */
export function normalizeLoadResponse(resp: unknown): Record<string, unknown> | null {
  const r = resp as
    | { data?: unknown; results?: Array<{ data?: unknown }>; query?: Record<string, unknown> }
    | null
    | undefined;
  if (!r || typeof r !== 'object') return null;
  // Already the wrapper shape.
  if (Array.isArray(r.results) && r.results.length > 0 && Array.isArray(r.results[0]?.data)) {
    return r as Record<string, unknown>;
  }
  // Legacy single-result shape → lift into a single-result wrapper.
  if (Array.isArray(r.data)) {
    return {
      queryType: 'regularQuery',
      results: [r],
      pivotQuery: { ...(r.query ?? {}), queryType: 'regularQuery' },
    };
  }
  return null;
}

/** Synthesize a minimal ResultSet-like object from cached rows (legacy path). */
function cacheToResultSet(rows: unknown[]): ResultSet {
  return {
    rawData: () => rows as Array<Record<string, unknown>>,
    tablePivot: () => rows as Array<Record<string, string | number | boolean | null>>,
  } as unknown as ResultSet;
}

/** Observe an element's height so the chart engine (needs a numeric height) fills the tile. */
function useElementHeight<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(200);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h && h > 0) setHeight(Math.floor(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, height];
}

export function Tile({ tile, slug, gameId, onDelete, onTitleChange }: TileProps) {
  const [cache, setCache] = useState<TileCacheView | null>(tile.cache ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(tile.title);
  // Local chart type — seeded from the persisted spec, toggled live, PATCHed back.
  const [chartType, setChartType] = useState<ChartType>(
    () => (tile.chart_type as ChartType | undefined) ?? vizToChartType(tile.viz_type),
  );
  const [bodyRef, bodyHeight] = useElementHeight<HTMLDivElement>();

  // Re-sync when the parent re-fetches the dashboard.
  useEffect(() => { setCache(tile.cache ?? null); }, [tile.cache]);
  useEffect(() => {
    setChartType((tile.chart_type as ChartType | undefined) ?? vizToChartType(tile.viz_type));
  }, [tile.chart_type, tile.viz_type]);

  // A real ResultSet (engine parity) when the cache carries the full load
  // response; null for legacy rows-only entries → lightweight fallback.
  const liveResultSet = useMemo(() => {
    const normalized = normalizeLoadResponse(cache?.loadResponse);
    if (!normalized) return null;
    try {
      return new ResultSet(normalized as ConstructorParameters<typeof ResultSet>[0]);
    } catch {
      return null;
    }
  }, [cache]);

  const fallbackResultSet = useMemo(
    () => (cache ? cacheToResultSet(cache.rows) : null),
    [cache],
  );

  const pivotConfig = useMemo<PivotConfig | undefined>(() => {
    if (!tile.pivot_config) return undefined;
    try {
      return JSON.parse(tile.pivot_config) as PivotConfig;
    } catch {
      return undefined;
    }
  }, [tile.pivot_config]);

  const refreshNow = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await dashboardsClient.refreshTile(slug, gameId, tile.id);
      setCache(next);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[tile] manual refresh failed:', (err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [slug, gameId, tile.id]);

  // Toggle chart type live + persist so it sticks on reload and for other viewers.
  const onChartTypeChange = useCallback(
    (next: ChartType) => {
      setChartType(next);
      dashboardsClient
        .patchTile(slug, gameId, tile.id, { chart_type: next })
        .catch(() => {});
    },
    [slug, gameId, tile.id],
  );

  const handleTitleCommit = useCallback(() => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim() || tile.title;
    setTitleDraft(trimmed);
    if (trimmed !== tile.title) {
      onTitleChange?.(tile.id, trimmed);
      dashboardsClient.patchTile(slug, gameId, tile.id, { title: trimmed }).catch(() => {});
    }
  }, [titleDraft, tile.title, tile.id, slug, gameId, onTitleChange]);

  const isWarming = !cache || (cache.status === 'refreshing' && cache.rows.length === 0);
  const isBroken = cache?.status === 'broken' && (!cache.rows || cache.rows.length === 0);

  return (
    <div style={tileStyle}>
      <div style={headerStyle}>
        {editingTitle ? (
          <input
            autoFocus
            style={{ ...titleStyle, border: '1px solid var(--brand)', borderRadius: 4, padding: '1px 4px' }}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={handleTitleCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTitleCommit();
              if (e.key === 'Escape') { setTitleDraft(tile.title); setEditingTitle(false); }
            }}
          />
        ) : (
          <span style={titleStyle} onDoubleClick={() => setEditingTitle(true)} title="Double-click to rename">
            {titleDraft}
          </span>
        )}
        <button
          aria-label="Refresh tile"
          title="Refresh now"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: '0 4px' }}
          onClick={refreshNow}
          disabled={refreshing}
        >
          ⟳
        </button>
        {onDelete && (
          <button
            aria-label="Delete tile"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
            onClick={() => onDelete(tile.id)}
          >
            ×
          </button>
        )}
      </div>

      {/* Chart-type toggle — only on the engine path (real ResultSet available). */}
      {!isWarming && !isBroken && liveResultSet && (
        <div style={{ marginBottom: 6 }}>
          <ChartTypeToggle value={chartType} onChange={onChartTypeChange} />
        </div>
      )}

      <div
        ref={bodyRef}
        style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
      >
        {isWarming && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Refreshing…</div>}
        {!isWarming && isBroken && (
          <div style={{ color: 'var(--danger, #dc2626)', fontSize: 11 }}>
            {cache?.error_msg ?? 'Tile data unavailable.'}
          </div>
        )}
        {!isWarming && !isBroken && liveResultSet && (
          <TileChartBoundary
            key={cache?.fetched_at}
            fallback={
              fallbackResultSet ? (
                <TileVizBody vizType={tile.viz_type} title={titleDraft} resultSet={fallbackResultSet} />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Chart unavailable.</div>
              )
            }
          >
            <PlaygroundChartRenderer
              chartType={chartType}
              resultSet={liveResultSet}
              pivotConfig={pivotConfig}
              chartHeight={Math.max(bodyHeight - 4, 80)}
            />
          </TileChartBoundary>
        )}
        {!isWarming && !isBroken && !liveResultSet && fallbackResultSet && (
          <TileVizBody vizType={tile.viz_type} title={titleDraft} resultSet={fallbackResultSet} />
        )}
      </div>

      {cache?.status === 'refreshing' && cache.rows.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
          Refreshing…
        </div>
      )}
    </div>
  );
}
