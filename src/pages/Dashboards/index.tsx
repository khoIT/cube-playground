/**
 * /dashboards — list of dashboards for the active game.
 * Scoped by game via useActiveGameId(); re-renders on game switch.
 * Create form is extracted to dashboard-create-inline-form.tsx.
 */

import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { dashboardsClient } from '../../api/dashboards-client';
import { SegmentApiError } from '../../api/api-client';
import { useDashboards } from './use-dashboards';
import { DashboardCreateInlineForm } from './dashboard-create-inline-form';

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 800,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

const headStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 24,
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card, #fff)',
  border: '1px solid var(--border-card, #e5e7eb)',
  borderRadius: 10,
  padding: '16px 20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  cursor: 'pointer',
  transition: 'box-shadow 0.15s',
};

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'var(--brand, #6366f1)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

export function DashboardsListPage() {
  const gameId = useActiveGameId();
  const history = useHistory();
  const { dashboards, loading, error, refetch } = useDashboards(gameId);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);

  async function handleCreate(title: string, slug: string) {
    if (!title.trim()) { setCreateError('Title is required'); return; }
    if (!slug) { setCreateError('Slug is required'); return; }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setCreateError('Slug must be lowercase letters, digits and hyphens only');
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      await dashboardsClient.create({ game: gameId, slug, title: title.trim() });
      setCreating(false);
      refetch();
    } catch (err) {
      if (err instanceof SegmentApiError && err.status === 409) {
        setCreateError('A dashboard with this slug already exists.');
      } else {
        setCreateError((err as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancelCreate() {
    setCreating(false);
    setCreateError(null);
  }

  async function handleDelete(slug: string) {
    if (!confirm('Delete this dashboard and all its tiles?')) return;
    setDeletingSlug(slug);
    try {
      await dashboardsClient.delete(slug, gameId);
      refetch();
    } catch {
      /* best-effort — refetch shows current state */
    } finally {
      setDeletingSlug(null);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={headStyle}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 700 }}>
          <LayoutGrid size={22} />
          Dashboards
        </span>
        <button style={btnPrimary} onClick={() => setCreating(true)}>
          <Plus size={14} />
          New dashboard
        </button>
      </div>

      {creating && (
        <DashboardCreateInlineForm
          submitting={submitting}
          error={createError}
          onSubmit={handleCreate}
          onCancel={handleCancelCreate}
        />
      )}

      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}
      {error && <div style={{ color: 'var(--danger,#dc2626)', fontSize: 13 }}>{error}</div>}

      {!loading && dashboards.length === 0 && !creating && (
        <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', marginTop: 48 }}>
          No dashboards yet. Create one and pin queries from the Playground.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {dashboards.map((d) => (
          <div
            key={d.slug}
            style={cardStyle}
            onClick={() => history.push(`/dashboards/${d.slug}?game=${gameId}`)}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{d.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>/{d.slug}</div>
            </div>
            <button
              aria-label={`Delete ${d.title}`}
              disabled={deletingSlug === d.slug}
              onClick={(e) => { e.stopPropagation(); handleDelete(d.slug); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', opacity: deletingSlug === d.slug ? 0.4 : 1 }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
