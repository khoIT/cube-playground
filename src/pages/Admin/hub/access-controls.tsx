/**
 * AccessControls — the GOVERN surface: the write-heavy controls for one user.
 *
 * Role & status · Workspace grants · Game grants · Feature access. This is the
 * mutate half of the old PerUserPanel, extracted so the Users & Access tab can
 * render controls WITHOUT pulling the heavy activity rollup (chat-service call
 * + event/segment/audit queries) on every selection. Observe-only data lives in
 * activity-profile.tsx.
 */

import React, { useEffect, useState } from 'react';
import type { AdminUser, AdminRegistry, AdminRole, AdminStatus } from '../access/use-admin-access';
import {
  patchAdminUser,
  putAdminUserWorkspaces,
} from '../access/use-admin-access';
import { GrantMatrix } from '../access/grant-matrix';
import { useGrantSection } from '../access/use-grant-section';
import { WorkspaceGamesSection } from '../access/workspace-games-section';
import { switchability } from './per-user-panel-helpers';
import { card, cardBody, eyebrow, saveBtnStyle } from './per-user-shared';
import { FeatureAccessSection } from './feature-access-section';

const ROLES: AdminRole[] = ['viewer', 'editor', 'admin'];
const STATUSES: AdminStatus[] = ['active', 'pending', 'disabled'];

// ── Role & status ────────────────────────────────────────────────────────────

function RoleStatusEditor({ user, onSaved }: { user: AdminUser; onSaved: (email: string) => void }) {
  const [role, setRole] = useState<AdminRole>(user.role);
  const [status, setStatus] = useState<AdminStatus>(user.status);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setRole(user.role);
    setStatus(user.status);
    setMsg(null);
  }, [user.email, user.role, user.status]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await patchAdminUser(user.email, { role, status });
      setMsg({ ok: true, text: 'Saved.' });
      onSaved(user.email);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const sel: React.CSSProperties = {
    padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font-sans)',
    color: 'var(--text-primary)', background: 'var(--bg-app)',
    border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
  };

  return (
    <section style={card}>
      <div style={cardBody}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 12 }}>
          Role &amp; status
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={eyebrow}>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} style={sel}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={eyebrow}>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as AdminStatus)} style={sel}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{ ...saveBtnStyle(saving), padding: '6px 14px', borderRadius: 'var(--radius-sm)' }}
          >
            {saving ? 'Saving…' : 'Save role & status'}
          </button>
        </div>
        {msg && (
          <div
            style={{
              marginTop: 8, fontSize: 12, fontWeight: 500, padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              background: msg.ok ? 'var(--success-soft)' : 'var(--destructive-soft)',
              color: msg.ok ? 'var(--success-ink)' : 'var(--destructive-ink)',
            }}
          >
            {msg.text}
          </div>
        )}
        <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
          Last active admin can't be demoted or disabled — guarded server-side (409).
        </p>
      </div>
    </section>
  );
}

// ── Workspace grants ──────────────────────────────────────────────────────────

function WorkspaceGrantsSection({ user, registry, onSaved }: { user: AdminUser; registry: AdminRegistry; onSaved: (email: string) => void }) {
  const ws = useGrantSection(user.workspaces, (ids) => putAdminUserWorkspaces(user.email, ids), () => onSaved(user.email));
  const sw = switchability([...ws.selected]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <GrantMatrix
        title="Workspace grants"
        options={registry.workspaces.map((w) => ({ id: w.id, label: w.label }))}
        selected={ws.selected}
        onToggle={ws.toggle}
        onSave={ws.save}
        saving={ws.saving}
        saved={ws.saved}
        error={ws.error}
      />
      <div
        style={{
          padding: '9px 12px', borderRadius: 'var(--radius-md)', fontSize: 12,
          background: sw.canSwitch ? 'var(--success-soft)' : 'var(--bg-muted)',
          color: sw.canSwitch ? 'var(--success-ink)' : 'var(--text-muted)',
          border: '1px solid var(--border-card)',
        }}
      >
        {sw.label}
      </div>
    </div>
  );
}

// ── AccessControls — two-column controls grid ─────────────────────────────────

export interface AccessControlsProps {
  user: AdminUser;
  registry: AdminRegistry;
  onSaved: (email: string) => void;
}

export function AccessControls({ user, registry, onSaved }: AccessControlsProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RoleStatusEditor user={user} onSaved={onSaved} />
        <WorkspaceGrantsSection user={user} registry={registry} onSaved={onSaved} />
        <WorkspaceGamesSection user={user} registry={registry} onSaved={onSaved} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FeatureAccessSection user={user} registry={registry} onSaved={onSaved} />
      </div>
    </div>
  );
}
