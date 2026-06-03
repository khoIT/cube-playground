/**
 * PendingApprovalQueue — promotes the #1 recurring admin job (approving
 * auto-created `pending` users from default-deny login) to a first-class card
 * on the Observability overview.
 *
 * Each row: email + a role select + Approve / Deny. Approve sets status=active
 * and the chosen role in ONE PATCH — the default-on analyst feature surfaces
 * derive from active status, so no separate grant call is needed; workspace/game
 * grants stay empty until an admin assigns them on the Access tab. Deny sets
 * status=disabled (reversible). tokens.css only.
 */

import React, { useState } from 'react';
import { patchAdminUser, type AdminRole } from '../access/use-admin-access';
import { relativeTime } from './per-user-panel-helpers';
import { card, saveBtnStyle } from './per-user-shared';

export interface PendingUser {
  email: string;
  lastLogin: string | null;
}

const ROLES: AdminRole[] = ['viewer', 'editor', 'admin'];

function PendingRow({ user, onChanged }: { user: PendingUser; onChanged: () => void }) {
  const [role, setRole] = useState<AdminRole>('viewer');
  const [busy, setBusy] = useState<null | 'approve' | 'deny'>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(kind: 'approve' | 'deny') {
    setBusy(kind);
    setErr(null);
    try {
      await patchAdminUser(user.email, kind === 'approve' ? { status: 'active', role } : { status: 'disabled' });
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  }

  const sel: React.CSSProperties = {
    padding: '5px 8px', fontSize: 12, fontFamily: 'var(--font-sans)',
    color: 'var(--text-primary)', background: 'var(--bg-app)',
    border: '1px solid var(--border-card)', borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
  };

  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid var(--border-card)', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.email}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          first seen {relativeTime(user.lastLogin)}
        </div>
        {err && <div style={{ fontSize: 11.5, color: 'var(--destructive-ink)' }}>{err}</div>}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-muted)' }}>
        as
        <select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} style={sel} disabled={busy !== null} aria-label={`Role for ${user.email}`}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <button type="button" onClick={() => act('approve')} disabled={busy !== null} style={saveBtnStyle(busy !== null)}>
        {busy === 'approve' ? 'Approving…' : 'Approve'}
      </button>
      <button
        type="button"
        onClick={() => act('deny')}
        disabled={busy !== null}
        style={{
          background: 'var(--bg-app)', color: 'var(--text-secondary)',
          border: '1px solid var(--border-card)', borderRadius: 'var(--radius-sm)',
          padding: '5px 12px', fontSize: 12, fontWeight: 600,
          cursor: busy !== null ? 'default' : 'pointer', opacity: busy !== null ? 0.6 : 1,
          fontFamily: 'var(--font-sans)',
        }}
      >
        {busy === 'deny' ? 'Denying…' : 'Deny'}
      </button>
    </li>
  );
}

export function PendingApprovalQueue({ users, onChanged }: { users: PendingUser[]; onChanged: () => void }) {
  if (users.length === 0) return null; // no card when the queue is empty

  return (
    <section style={{ ...card, padding: 0, overflow: 'hidden', marginTop: 12 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Pending approval</span>
        <span
          style={{
            fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 'var(--radius-full)',
            background: 'var(--warning-soft)', color: 'var(--warning-ink)',
          }}
        >
          {users.length}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>logged in but not yet activated</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {users.map((u) => <PendingRow key={u.email} user={u} onChanged={onChanged} />)}
      </ul>
    </section>
  );
}
