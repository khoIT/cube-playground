/**
 * /dashboards — curated dashboard previews + the user's own dashboards.
 * Scoped by game via useActiveGameId(); re-renders on game switch.
 * The page title now lives in the topbar breadcrumb (see breadcrumb.tsx);
 * this panel opens straight into the curated previews. Create form is
 * extracted to dashboard-create-inline-form.tsx.
 */

import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Plus, Trash2, Heart, Gauge, ArrowRight, type LucideIcon } from 'lucide-react';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { isOpsGame } from '../OpsConsole/ops-games';
import { dashboardsClient } from '../../api/dashboards-client';
import { SegmentApiError } from '../../api/api-client';
import { useDashboards } from './use-dashboards';
import { DashboardCreateInlineForm } from './dashboard-create-inline-form';

// Server-seeded starter-pack slugs. These are deprecated in favour of the two
// curated previews below, so they are hidden from the "Your dashboards" list
// (the seeder still runs server-side but its output no longer surfaces here).
const STARTER_PACK_SLUGS = new Set([
  'daily-health',
  'economy-and-gacha',
  'monetization',
  'onboarding-funnel',
  'retention-deep-dive',
]);

interface CuratedPreview {
  key: string;
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
  available: boolean;
}

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 800,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  margin: '4px 0 12px',
};

const previewCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  background: 'var(--bg-card)',
  border: '1px solid var(--border-strong)',
  borderRadius: 12,
  padding: '18px 20px',
  boxShadow: 'var(--shadow-sm)',
  cursor: 'pointer',
  transition: 'box-shadow 0.15s',
  flex: '1 1 280px',
  minWidth: 0,
};

const iconChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 34,
  height: 34,
  borderRadius: 'var(--radius-md)',
  background: 'var(--brand-soft)',
  color: 'var(--brand)',
  flexShrink: 0,
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
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
  background: 'var(--brand)',
  color: 'var(--text-on-brand)',
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

  // Custom dashboards = everything except the deprecated starter pack.
  const customDashboards = dashboards.filter((d) => !STARTER_PACK_SLUGS.has(d.slug));

  const previews: CuratedPreview[] = [
    {
      key: 'cs',
      to: '/dashboards/cs',
      icon: Heart,
      title: 'CS · VIP Care',
      description:
        'High-value player care — risk scores, ticket history, sentiment and win-back for VIP cohorts.',
      available: true,
    },
    {
      key: 'ops',
      to: '/ops',
      icon: Gauge,
      title: 'Ops Console',
      description:
        'Live operational health — revenue, payment delivery, server and recharge performance.',
      available: isOpsGame(gameId),
    },
  ].filter((p) => p.available);

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
      {/* Title lives in the topbar; this row carries only the create action. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <button style={btnPrimary} onClick={() => setCreating(true)}>
          <Plus size={14} />
          New dashboard
        </button>
      </div>

      {/* Curated previews — the canonical dashboards for this game. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 28 }}>
        {previews.map((p) => (
          <div
            key={p.key}
            style={previewCardStyle}
            onClick={() => history.push(p.to)}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-md)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-sm)'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={iconChipStyle}><p.icon size={18} /></span>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{p.title}</span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              {p.description}
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 600, color: 'var(--brand)' }}>
              Open <ArrowRight size={13} />
            </span>
          </div>
        ))}
      </div>

      {creating && (
        <DashboardCreateInlineForm
          submitting={submitting}
          error={createError}
          onSubmit={handleCreate}
          onCancel={handleCancelCreate}
        />
      )}

      <div style={sectionLabelStyle}>Your dashboards</div>

      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}
      {error && <div style={{ color: 'var(--destructive-ink)', fontSize: 13 }}>{error}</div>}

      {!loading && customDashboards.length === 0 && !creating && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13.5, padding: '8px 0 4px' }}>
          No custom dashboards yet — create one with “New dashboard”.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {customDashboards.map((d) => (
          <div
            key={d.slug}
            style={cardStyle}
            onClick={() => history.push(`/dashboards/${d.slug}?game=${gameId}`)}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-sm)'; }}
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
