/**
 * Admin Access — right pane editor for the selected user.
 * Role/status PATCH + three grant matrices (Workspaces / Games / Features).
 * Each save calls its endpoint then refetches the edited row. Server error
 * messages are surfaced verbatim (e.g. last-active-admin 409). No fake success.
 */

import React, { useEffect, useState } from 'react';
import {
  type AdminUser, type AdminRegistry, type AdminRole, type AdminStatus,
  patchAdminUser, putAdminUserWorkspaces, putAdminUserFeatures,
} from './use-admin-access';
import { GrantMatrix } from './grant-matrix';
import { useGrantSection } from './use-grant-section';
import { WorkspaceGamesSection } from './workspace-games-section';

const ROLES: AdminRole[] = ['viewer', 'editor', 'admin'];
const STATUSES: AdminStatus[] = ['active', 'pending', 'disabled'];

interface AccessEditorProps {
  user: AdminUser;
  registry: AdminRegistry | null;
  onSaved: (email: string) => void;
}

export function AccessEditor({ user, registry, onSaved }: AccessEditorProps) {
  const [role, setRole] = useState<AdminRole>(user.role);
  const [status, setStatus] = useState<AdminStatus>(user.status);
  const [savingRole, setSavingRole] = useState(false);
  const [roleMsg, setRoleMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setRole(user.role); setStatus(user.status); setRoleMsg(null);
  }, [user.email, user.role, user.status]);

  const ws = useGrantSection(user.workspaces, (ids) => putAdminUserWorkspaces(user.email, ids), () => onSaved(user.email));
  const featSel = Object.entries(user.features).filter(([, v]) => v).map(([k]) => k);
  const feats = useGrantSection(featSel, (ids) => {
    const next: Record<string, boolean> = {};
    for (const key of registry?.featureKeys ?? []) next[key] = ids.includes(key);
    return putAdminUserFeatures(user.email, next);
  }, () => onSaved(user.email));

  async function saveRoleStatus() {
    setSavingRole(true);
    setRoleMsg(null);
    try {
      await patchAdminUser(user.email, { role, status });
      setRoleMsg({ ok: true, text: 'Saved.' });
      onSaved(user.email);
    } catch (err) {
      setRoleMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSavingRole(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <section style={panel}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{user.email}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          Last login: {user.lastLogin ?? 'never'}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} style={select}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as AdminStatus)} style={select}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" onClick={saveRoleStatus} disabled={savingRole} style={primaryBtn(savingRole)}>
              {savingRole ? 'Saving…' : 'Save role & status'}
            </button>
          </div>
        </div>
        {roleMsg && (
          <div
            style={{
              marginTop: 10, fontSize: 12, fontWeight: 500,
              padding: '6px 10px', borderRadius: 'var(--radius-sm)',
              background: roleMsg.ok ? 'var(--success-soft)' : 'var(--destructive-soft)',
              color: roleMsg.ok ? 'var(--success-ink)' : 'var(--destructive-ink)',
            }}
          >
            {roleMsg.text}
          </div>
        )}
      </section>

      <GrantMatrix
        title="Workspaces"
        options={(registry?.workspaces ?? []).map((w) => ({ id: w.id, label: w.label }))}
        selected={ws.selected} onToggle={ws.toggle} onSave={ws.save}
        saving={ws.saving} saved={ws.saved} error={ws.error}
      />
      <WorkspaceGamesSection user={user} registry={registry} onSaved={onSaved} />
      <GrantMatrix
        title="Features"
        options={(registry?.featureKeys ?? []).map((k) => ({ id: k, label: k }))}
        selected={feats.selected} onToggle={feats.toggle} onSave={feats.save}
        saving={feats.saving} saved={feats.saved} error={feats.error}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}

const panel: React.CSSProperties = {
  border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)', padding: '14px 16px',
};

const select: React.CSSProperties = {
  padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font-sans)',
  color: 'var(--text-primary)', background: 'var(--bg-app)',
  border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)',
  textTransform: 'capitalize', cursor: 'pointer', minWidth: 120,
};

function primaryBtn(busy: boolean): React.CSSProperties {
  return {
    background: 'var(--brand)', color: 'var(--text-on-brand)', border: 'none',
    borderRadius: 'var(--radius-sm)', padding: '7px 16px',
    fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.6 : 1, fontFamily: 'var(--font-sans)',
  };
}
