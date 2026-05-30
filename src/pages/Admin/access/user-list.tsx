/**
 * Admin Access — left pane.
 * Search box + "pending only" filter toggle + selectable rows.
 * Each row: email, role chip, status badge (semantic tokens).
 */

import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { AdminUser, AdminRole, AdminStatus } from './use-admin-access';

const STATUS_TOKENS: Record<AdminStatus, { bg: string; ink: string; label: string }> = {
  active: { bg: 'var(--success-soft)', ink: 'var(--success-ink)', label: 'Active' },
  pending: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)', label: 'Pending' },
  disabled: { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'Disabled' },
};

function StatusBadge({ status }: { status: AdminStatus }) {
  const t = STATUS_TOKENS[status];
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 600, padding: '2px 8px',
        borderRadius: 'var(--radius-full)', background: t.bg, color: t.ink,
        whiteSpace: 'nowrap',
      }}
    >
      {t.label}
    </span>
  );
}

function RoleChip({ role }: { role: AdminRole }) {
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 500, padding: '2px 8px',
        borderRadius: 'var(--radius-sm)', background: 'var(--muted-soft)',
        color: 'var(--muted-ink)', textTransform: 'capitalize',
      }}
    >
      {role}
    </span>
  );
}

interface UserListProps {
  users: AdminUser[];
  loading: boolean;
  error: string | null;
  selectedEmail: string | null;
  onSelect: (email: string) => void;
}

export function UserList({ users, loading, error, selectedEmail, onSelect }: UserListProps) {
  const [query, setQuery] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (pendingOnly && u.status !== 'pending') return false;
      if (q && !u.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [users, query, pendingOnly]);

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', minWidth: 0,
        border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-card)', overflow: 'hidden',
      }}
    >
      <div style={{ padding: 12, borderBottom: '1px solid var(--border-card)' }}>
        <div style={{ position: 'relative' }}>
          <Search
            size={14}
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '8px 10px 8px 30px', fontSize: 13,
              fontFamily: 'var(--font-sans)', color: 'var(--text-primary)',
              background: 'var(--bg-app)', border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-md)', outline: 'none',
            }}
          />
        </div>
        <label
          style={{
            display: 'flex', alignItems: 'center', gap: 6, marginTop: 10,
            fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => setPendingOnly(e.target.checked)}
            style={{ accentColor: 'var(--brand)', cursor: 'pointer' }}
          />
          Pending only
        </label>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', maxHeight: '70vh' }}>
        {loading && <div style={emptyStyle}>Loading…</div>}
        {error && <div style={{ ...emptyStyle, color: 'var(--destructive-ink)' }}>{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div style={emptyStyle}>No users match.</div>
        )}
        {filtered.map((u) => {
          const active = u.email === selectedEmail;
          return (
            <button
              key={u.email}
              type="button"
              onClick={() => onSelect(u.email)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
                padding: '10px 12px', border: 'none',
                borderBottom: '1px solid var(--border-card)',
                background: active ? 'var(--bg-muted)' : 'transparent',
                fontFamily: 'var(--font-sans)',
                borderLeft: active ? '3px solid var(--brand)' : '3px solid transparent',
              }}
              onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-muted)'; }}
              onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {u.email}
                </div>
                <div style={{ marginTop: 4 }}><RoleChip role={u.role} /></div>
              </div>
              <StatusBadge status={u.status} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  padding: '16px 12px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center',
};
