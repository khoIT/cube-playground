/**
 * ObservabilityRosterRail — the persistent left rail of the master-detail
 * observability surface. A searchable user roster that is ALWAYS present, so
 * switching subjects = clicking a row and "back to the list" is never a
 * dead-end (the old flow bounced through the org rollup or the Access tab).
 *
 * The top "Org overview" row routes to /admin/observability (no :email) → the
 * right pane shows the org rollup; every other row routes to the per-user
 * profile. Selection is driven by the URL, not local state, so deep-links and
 * the browser back-button keep working. tokens.css only.
 */

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, BarChart3 } from 'lucide-react';
import type { AdminUser, AdminStatus } from '../access/use-admin-access';
import { relativeTime } from './per-user-panel-helpers';

/** Status → dot color. Mirrors the StatusBadge palette (semantic tokens). */
const DOT_TONE: Record<AdminStatus, string> = {
  active: 'var(--success-ink)',
  pending: 'var(--warning-ink)',
  disabled: 'var(--text-muted)',
};

function initials(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.slice(0, 2).toUpperCase();
}

function Row({
  to, selected, dot, avatar, title, meta,
}: {
  to: string; selected: boolean; dot: string; avatar: React.ReactNode; title: string; meta: string;
}) {
  return (
    <Link
      to={to}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px',
        borderRadius: 'var(--radius-md)', textDecoration: 'none',
        background: selected ? 'var(--bg-card)' : 'transparent',
        boxShadow: selected ? 'inset 3px 0 0 var(--brand)' : 'none',
        outline: selected ? '1px solid var(--border-card)' : 'none',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 'var(--radius-full)', background: dot, flexShrink: 0 }} aria-hidden />
      <span
        style={{
          width: 26, height: 26, borderRadius: 'var(--radius-full)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700,
          background: selected ? 'var(--brand-soft)' : 'var(--bg-muted)',
          color: selected ? 'var(--brand-ink)' : 'var(--text-secondary)',
        }}
        aria-hidden
      >
        {avatar}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-muted)' }}>{meta}</span>
      </span>
    </Link>
  );
}

export function ObservabilityRosterRail({
  users, selectedEmail,
}: {
  users: AdminUser[];
  /** The user whose profile is shown, or null on the org-overview view. */
  selectedEmail: string | null;
}) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? users.filter((u) => u.email.toLowerCase().includes(needle)) : users;
    // Stable, useful order: most-recent login first, never-logged-in last.
    return [...list].sort((a, b) => (b.lastLogin ?? '').localeCompare(a.lastLogin ?? ''));
  }, [users, q]);

  return (
    <div style={{ borderRight: '1px solid var(--border-card)', background: 'var(--surface-inset)', display: 'flex', flexDirection: 'column', minHeight: 480 }}>
      <div style={{ padding: '11px 12px', borderBottom: '1px solid var(--border-card)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
          Users · {users.length}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', padding: '6px 9px' }}>
          <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search users…"
            aria-label="Search users"
            style={{ flex: 1, border: 'none', background: 'transparent', fontFamily: 'var(--font-sans)', fontSize: 12.5, color: 'var(--text-primary)', outline: 'none', minWidth: 0 }}
          />
        </div>
      </div>

      <div style={{ overflowY: 'auto', padding: 6, flex: 1, maxHeight: 'calc(100vh - 260px)' }}>
        {/* Org overview pseudo-row — the "no user selected" destination. */}
        <Row
          to="/admin/observability"
          selected={selectedEmail === null}
          dot="var(--info-ink)"
          avatar={<BarChart3 size={13} />}
          title="Org overview"
          meta="KPIs · cost · audit"
        />
        <div style={{ height: 1, background: 'var(--border-card)', margin: '6px 4px' }} />
        {filtered.length === 0 ? (
          <div style={{ padding: '12px 9px', fontSize: 12, color: 'var(--text-muted)' }}>No matching users.</div>
        ) : (
          filtered.map((u) => (
            <Row
              key={u.email}
              to={`/admin/observability/${encodeURIComponent(u.email)}`}
              selected={selectedEmail?.toLowerCase() === u.email.toLowerCase()}
              dot={DOT_TONE[u.status] ?? 'var(--text-muted)'}
              avatar={initials(u.email)}
              title={u.email}
              meta={`${u.status} · ${u.lastLogin ? `login ${relativeTime(u.lastLogin)}` : 'never logged in'}`}
            />
          ))
        )}
      </div>
    </div>
  );
}
