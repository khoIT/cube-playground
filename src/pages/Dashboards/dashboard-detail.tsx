/**
 * /dashboards/:slug — grid view of a single dashboard.
 * Tiles render from cache rows embedded in the dashboard payload
 * (server-side refresh cron keeps them warm). Inline title editing via PATCH.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useLocation, useHistory } from 'react-router-dom';
import { ArrowLeft, LayoutGrid } from 'lucide-react';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { dashboardsClient } from '../../api/dashboards-client';
import { useDashboardDetail } from './use-dashboard-detail';
import { DashboardGrid } from './dashboard-grid';

function useGameFromQuery(): string {
  const location = useLocation();
  // Hash-router: query string is after '?' in the hash fragment
  const hash = location.search || '';
  const params = new URLSearchParams(hash.replace(/^\?/, ''));
  return params.get('game') ?? '';
}

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1400,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
  height: '100%',
  boxSizing: 'border-box',
};

const headStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 24,
};

const titleInputStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  cursor: 'text',
  padding: '0 2px',
  color: 'var(--text-primary)',
  minWidth: 120,
};

export function DashboardDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const history = useHistory();
  const activeGameId = useActiveGameId();
  const gameFromQuery = useGameFromQuery();
  // Prefer the explicit ?game= param so deep-linked URLs keep their game.
  // Falls back to the current active game for nav from the list page.
  const gameId = gameFromQuery || activeGameId;

  const { dashboard, loading, error, refetch } = useDashboardDetail(slug, gameId);

  // Phase-3: ping view so the server cron prioritizes this dashboard's tiles.
  // Fire-and-forget; we never block render on this.
  useEffect(() => {
    if (!slug || !gameId) return;
    void dashboardsClient.pingView(slug, gameId).catch(() => {});
  }, [slug, gameId]);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  function startEditTitle() {
    setTitleDraft(dashboard?.title ?? '');
    setEditingTitle(true);
  }

  const commitTitle = useCallback(async () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === dashboard?.title) return;
    try {
      await dashboardsClient.patch(slug, gameId, { title: trimmed });
      refetch();
    } catch {
      /* non-critical */
    }
  }, [titleDraft, dashboard?.title, slug, gameId, refetch]);

  const handleTileDeleted = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleTitleChange = useCallback(
    (tileId: number, newTitle: string) => {
      // Optimistically update is handled inside Tile; refetch syncs server state
      void dashboardsClient
        .patchTile(slug, gameId, tileId, { title: newTitle })
        .then(() => refetch());
    },
    [slug, gameId, refetch],
  );

  if (loading) {
    return (
      <div style={{ ...pageStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading dashboard…</span>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div style={{ ...pageStyle }}>
        <button
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, marginBottom: 16 }}
          onClick={() => history.push('/dashboards')}
        >
          <ArrowLeft size={14} /> Back to dashboards
        </button>
        <div style={{ color: 'var(--danger)', fontSize: 14 }}>
          {error ?? 'Dashboard not found.'}
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={headStyle}>
        <button
          aria-label="Back to dashboards"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: 0 }}
          onClick={() => history.push('/dashboards')}
        >
          <ArrowLeft size={18} />
        </button>

        <LayoutGrid size={20} style={{ color: 'var(--brand)', flexShrink: 0 }} />

        {editingTitle ? (
          <input
            autoFocus
            style={{ ...titleInputStyle, border: '1px solid var(--brand)', borderRadius: 4, padding: '0 6px' }}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') setEditingTitle(false);
            }}
          />
        ) : (
          <span
            style={{ ...titleInputStyle, cursor: 'text' }}
            onDoubleClick={startEditTitle}
            title="Double-click to rename"
          >
            {dashboard.title}
          </span>
        )}

        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
          {dashboard.tiles.length}/8 tiles
        </span>
      </div>

      <DashboardGrid
        tiles={dashboard.tiles}
        slug={slug}
        gameId={gameId}
        onTileDeleted={handleTileDeleted}
        onTitleChange={handleTitleChange}
      />
    </div>
  );
}
