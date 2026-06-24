/**
 * CoverageCadenceBar — a compact, at-a-glance status strip for the LiveOps
 * transition surfaces (lifecycle Sankey + tier-migration card).
 *
 * The transition matrices are fed by daily member-state snapshots of a hidden
 * system "all-users" segment (see server lifecycle-tracking-segment). This bar
 * makes the otherwise-implicit tracking state legible without leaving the card:
 * whether tracking is active, the compared snapshot window, the covered user
 * count, and an admin deep-link to manage snapshot cadence/coverage. It does NOT
 * repeat the full disclosure prose (the card already shows that) — it's the
 * structured glance + the convenience link.
 *
 * Design tokens only; mirrors the semantic status-pill palette used elsewhere.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowUpRight } from 'lucide-react';
import { useAuthUser } from '../../../auth/auth-context';

export interface CoverageCadenceMeta {
  available: boolean;
  prevDate: string | null;
  currDate: string | null;
  capturedDays: number;
  coverageUsers: number;
}

type Tone = 'positive' | 'warning' | 'muted';

function statusOf(meta: CoverageCadenceMeta): { label: string; tone: Tone } {
  if (meta.available) return { label: 'Tracking active', tone: 'positive' };
  if (meta.capturedDays >= 1) return { label: `Accumulating · ${meta.capturedDays}/2 days`, tone: 'warning' };
  return { label: 'Not tracking here', tone: 'muted' };
}

const TONE: Record<Tone, { bg: string; ink: string }> = {
  positive: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
  warning: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
  muted: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
};

export function CoverageCadenceBar({ meta }: { meta: CoverageCadenceMeta }) {
  const user = useAuthUser();
  const isAdmin = user?.role === 'admin';
  const status = statusOf(meta);
  const tone = TONE[status.tone];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '6px 10px',
        background: 'var(--bg-surface, rgba(0,0,0,0.02))',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-sans)',
        fontSize: 11,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          background: tone.bg,
          color: tone.ink,
          borderRadius: 'var(--radius-sm)',
          padding: '2px 8px',
          fontWeight: 600,
        }}
      >
        <Activity size={11} />
        {status.label}
      </span>

      {meta.available && meta.prevDate && meta.currDate && (
        <span style={{ color: 'var(--text-muted)' }}>
          {meta.coverageUsers.toLocaleString()} users · {meta.prevDate} → {meta.currDate}
        </span>
      )}

      {isAdmin && (
        <Link
          to="/admin/segment-refreshes"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            color: 'var(--brand)',
            textDecoration: 'none',
            fontWeight: 600,
          }}
          title="Manage snapshot cadence & coverage"
        >
          Manage coverage
          <ArrowUpRight size={12} />
        </Link>
      )}
    </div>
  );
}
