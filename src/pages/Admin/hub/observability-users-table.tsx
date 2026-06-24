/**
 * ObservabilityUsersTable — the org-overview roster as a searchable table.
 *
 * On the no-user observability view the org rollup is the top section; this is
 * the SEPARATE "Users" section beneath it (not a left rail, not buried inside
 * the rollup). Each row links to that user's per-user profile, where the rail
 * takes over for fast lateral switching. Columns stick to fields the admin
 * users endpoint actually returns — no fabricated activity counts. tokens.css
 * only.
 */

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { AdminUser, AdminStatus } from '../access/use-admin-access';
import { relativeTime } from './per-user-panel-helpers';

/** Status → dot color (semantic tokens; mirrors the rail + StatusBadge). */
const DOT_TONE: Record<AdminStatus, string> = {
  active: 'var(--success-ink)',
  pending: 'var(--warning-ink)',
  disabled: 'var(--text-muted)',
};

const PILL_TONE: Record<AdminStatus, { bg: string; fg: string }> = {
  active: { bg: 'var(--success-soft)', fg: 'var(--success-ink)' },
  pending: { bg: 'var(--warning-soft)', fg: 'var(--warning-ink)' },
  disabled: { bg: 'var(--muted-soft)', fg: 'var(--muted-ink)' },
};

function initials(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.slice(0, 2).toUpperCase();
}

const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '9px 14px',
  background: 'var(--bg-muted)', borderBottom: '1px solid var(--border-card)', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  fontSize: 13, color: 'var(--text-secondary)', padding: '10px 14px',
  borderBottom: '1px solid var(--border-card)', whiteSpace: 'nowrap',
};

export function ObservabilityUsersTable({ users }: { users: AdminUser[] }) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? users.filter((u) => u.email.toLowerCase().includes(needle)) : users;
    // Most-recent login first; never-logged-in last.
    return [...list].sort((a, b) => (b.lastLogin ?? '').localeCompare(a.lastLogin ?? ''));
  }, [users, q]);

  return (
    <section style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Users</h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {users.length} · click a row to view activity &amp; access
        </span>
      </div>

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, maxWidth: 320, marginBottom: 10,
          background: 'var(--bg-card)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)', padding: '7px 11px',
        }}
      >
        <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search users…"
          aria-label="Search users"
          style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', minWidth: 0, fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--text-primary)' }}
        />
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>User</th>
              <th style={th}>Role</th>
              <th style={th}>Status</th>
              <th style={th}>Workspaces</th>
              <th style={th}>Last login</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td style={{ ...td, color: 'var(--text-muted)' }} colSpan={5}>No matching users.</td></tr>
            ) : (
              filtered.map((u) => (
                <UserRow key={u.email} user={u} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UserRow({ user }: { user: AdminUser }) {
  const [hover, setHover] = useState(false);
  const pill = PILL_TONE[user.status] ?? PILL_TONE.disabled;
  return (
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ background: hover ? 'var(--surface-inset)' : 'transparent' }}
    >
      <td style={{ ...td, borderBottom: '1px solid var(--border-card)' }}>
        <Link
          to={`/admin/observability/users/${encodeURIComponent(user.email)}`}
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'var(--text-primary)' }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 'var(--radius-full)', background: DOT_TONE[user.status] ?? 'var(--text-muted)', flexShrink: 0 }} aria-hidden />
          <span
            style={{
              width: 28, height: 28, borderRadius: 'var(--radius-full)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10.5, fontWeight: 700, background: 'var(--bg-muted)', color: 'var(--text-secondary)',
            }}
            aria-hidden
          >
            {initials(user.email)}
          </span>
          {user.email}
        </Link>
      </td>
      <td style={td}>{user.role}</td>
      <td style={td}>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: pill.bg, color: pill.fg }}>
          {user.status}
        </span>
      </td>
      <td style={td}>{user.workspaces.length || '—'}</td>
      <td style={{ ...td, color: 'var(--text-muted)' }}>
        {user.lastLogin ? relativeTime(user.lastLogin) : 'never'}
      </td>
    </tr>
  );
}
