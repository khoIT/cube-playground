/**
 * Dashboard tile shell — loads its Cube query via tile-fetch-queue (max 3 concurrent),
 * detects schema drift, and dispatches rendering to tile-viz-renderers.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ResultSet } from '@cubejs-client/core';
import { useAppContext } from '../../hooks';
import { useSecurityContext } from '../../hooks/security-context';
import { useCubejsApi } from '../../hooks/cubejs-api';
import { enqueueTileFetch } from './tile-fetch-queue';
import { TileVizBody } from './tile-viz-renderers';
import { dashboardsClient } from '../../api/dashboards-client';
import type { DashboardTile as TileModel } from '../../api/dashboards-client';

interface TileProps {
  tile: TileModel;
  slug: string;
  gameId: string;
  onDelete?: (tileId: number) => void;
  onTitleChange?: (tileId: number, title: string) => void;
}

function safeParseQuery(json: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(json);
    return typeof v === 'object' && v !== null ? v : null;
  } catch {
    return null;
  }
}

// ── Styles ─────────────────────────────────────────────────────────────────

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

// ── Component ───────────────────────────────────────────────────────────────

export function Tile({ tile, slug, gameId, onDelete, onTitleChange }: TileProps) {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();
  const cubeApi = useCubejsApi(apiUrl ?? null, currentToken ?? null);

  const [resultSet, setResultSet] = useState<ResultSet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [driftWarning, setDriftWarning] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(tile.title);
  const abortRef = useRef<AbortController | null>(null);

  const runLoad = useCallback(() => {
    if (!cubeApi) return;
    const query = safeParseQuery(tile.query_json);
    if (!query) { setLoadError('Invalid query JSON stored in tile.'); return; }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setLoadError(null);
    setDriftWarning(null);

    type CubeApiCompat = {
      load: (q: unknown) => Promise<ResultSet>;
      meta: () => Promise<{ cubes: Array<{ measures: Array<{ name: string }>; dimensions: Array<{ name: string }> }> }>;
    };

    enqueueTileFetch(() => (cubeApi as unknown as CubeApiCompat).load(query))
      .then((rs) => {
        if (ctrl.signal.aborted) return;
        setResultSet(rs);
        // Schema-drift check: warn if any referenced member is absent from meta.
        (cubeApi as unknown as CubeApiCompat).meta().then((meta) => {
          if (ctrl.signal.aborted) return;
          const available = new Set<string>();
          meta.cubes.forEach((c) => {
            c.measures.forEach((m) => available.add(m.name));
            c.dimensions.forEach((d) => available.add(d.name));
          });
          const measures: string[] = (query.measures as string[] | undefined) ?? [];
          const dimensions: string[] = (query.dimensions as string[] | undefined) ?? [];
          const missing = [...measures, ...dimensions].filter((m) => !available.has(m));
          if (missing.length) setDriftWarning(`Schema drift: ${missing.join(', ')} no longer in meta`);
        }).catch(() => {/* meta unavailable — skip drift check */});
      })
      .catch((err: Error) => { if (!ctrl.signal.aborted) setLoadError(err.message); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
  }, [cubeApi, tile.query_json]);

  useEffect(() => { runLoad(); return () => abortRef.current?.abort(); }, [runLoad]);

  const handleTitleCommit = useCallback(() => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim() || tile.title;
    setTitleDraft(trimmed);
    if (trimmed !== tile.title) {
      onTitleChange?.(tile.id, trimmed);
      dashboardsClient.patchTile(slug, gameId, tile.id, { title: trimmed }).catch(() => {});
    }
  }, [titleDraft, tile.title, tile.id, slug, gameId, onTitleChange]);

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
        {loading && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>}
        {!loading && loadError && <div style={{ color: 'var(--danger, #dc2626)', fontSize: 11 }}>{loadError}</div>}
        {!loading && !loadError && resultSet && (
          <TileVizBody vizType={tile.viz_type} title={titleDraft} resultSet={resultSet} />
        )}
      </div>

      {driftWarning && (
        <div style={{ fontSize: 11, color: 'var(--text-warning,#b45309)', background: 'var(--bg-warning,#fffbeb)', border: '1px solid var(--border-warning,#fde68a)', borderRadius: 6, padding: '4px 8px', marginTop: 4 }}>
          {driftWarning}
        </div>
      )}
    </div>
  );
}
