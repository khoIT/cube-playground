/**
 * Dashboard tile shell — reads its data from the server-side tile cache.
 *
 * Phase-3 caching change: tiles no longer fire their own Cube query. The
 * GET /api/dashboards/:slug response embeds a `cache` object per tile; this
 * component renders straight from those rows. A kebab "Refresh now" path
 * (handled by the parent) bypasses the cron interval when needed.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ResultSet } from '@cubejs-client/core';
import { TileVizBody } from './tile-viz-renderers';
import { dashboardsClient } from '../../api/dashboards-client';
import type { DashboardTile as TileModel, TileCacheView } from '../../api/dashboards-client';

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

/** Synthesize a minimal ResultSet-like object from cached rows. */
function cacheToResultSet(rows: unknown[]): ResultSet {
  return {
    rawData: () => rows as Array<Record<string, unknown>>,
    tablePivot: () => rows as Array<Record<string, string | number | boolean | null>>,
  } as unknown as ResultSet;
}

export function Tile({ tile, slug, gameId, onDelete, onTitleChange }: TileProps) {
  const [cache, setCache] = useState<TileCacheView | null>(tile.cache ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(tile.title);

  // Re-sync when the parent re-fetches the dashboard.
  useEffect(() => { setCache(tile.cache ?? null); }, [tile.cache]);

  const resultSet = useMemo(
    () => (cache ? cacheToResultSet(cache.rows) : null),
    [cache],
  );

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

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {isWarming && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Refreshing…</div>}
        {!isWarming && isBroken && (
          <div style={{ color: 'var(--danger, #dc2626)', fontSize: 11 }}>
            {cache?.error_msg ?? 'Tile data unavailable.'}
          </div>
        )}
        {!isWarming && !isBroken && resultSet && (
          <TileVizBody vizType={tile.viz_type} title={titleDraft} resultSet={resultSet} />
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
