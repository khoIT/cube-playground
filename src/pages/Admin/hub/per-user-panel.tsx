/**
 * PerUserPanel — two-column per-user control panel.
 *
 * Two-column layout: identity + grants on the left, capabilities + activity on the right.
 *   Full-width ExperienceSummary header (initials, email, role, status, last-login,
 *   3-stat row: Workspaces · Games · Segments)
 *   Two-column grid:
 *     LEFT:  Role & Status editor + Workspace grants + Game grants
 *     RIGHT: Feature access toggles + Activity snapshot
 *
 * Activity data fetched from GET /api/admin/activity/users/:email.
 * Fetch failure degrades gracefully to empty snapshot.
 *
 * Re-exports pure helpers so tests can import them from this file directly.
 */

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../api/api-client';
import type { AdminUser, AdminRegistry, AdminRole, AdminStatus } from '../access/use-admin-access';
import {
  patchAdminUser,
  putAdminUserWorkspaces,
  putAdminUserGames,
  putAdminUserFeatures,
} from '../access/use-admin-access';
import { GrantMatrix } from '../access/grant-matrix';
import { useGrantSection } from '../access/use-grant-section';
import {
  switchability,
  groupFeatures,
  relativeTime,
  formatQueryShape,
  FEATURE_LABEL,
} from './per-user-panel-helpers';

// Re-export pure helpers so test imports stay at this single entry point.
export {
  switchability,
  groupFeatures,
  relativeTime,
  type SwitchabilityResult,
  type FeatureGroup,
  type FeatureEntry,
} from './per-user-panel-helpers';

// ---------------------------------------------------------------------------
// Activity shape (from activity-aggregator.ts)
// ---------------------------------------------------------------------------

interface ChatStats {
  turns: number;
}

interface QueryShape {
  cubes: string[];
  measures: string[];
  dimensions: string[];
}

interface UserActivity {
  email: string;
  sub: string | null;
  status: string;
  role: string;
  lastLogin: string | null;
  inactive: boolean;
  segmentCount: number;
  recentFeatures: string[];
  recentQueryShapes: QueryShape[];
  chatStats: ChatStats | null;
}

// ---------------------------------------------------------------------------
// Shared style primitives (tokens.css only — no hex literals, no T.*)
// ---------------------------------------------------------------------------

const card: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  overflow: 'hidden',
};

const cardBody: React.CSSProperties = { padding: '14px 16px' };

const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
};

// ---------------------------------------------------------------------------
// StatusBadge / RoleChip — local small primitives (mirrors user-list.tsx tokens)
// ---------------------------------------------------------------------------

const STATUS_TOKENS: Record<AdminStatus, { bg: string; ink: string; label: string }> = {
  active: { bg: 'var(--success-soft)', ink: 'var(--success-ink)', label: 'Active' },
  pending: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)', label: 'Pending' },
  disabled: { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'Disabled' },
};

function StatusBadge({ status }: { status: AdminStatus }) {
  const t = STATUS_TOKENS[status] ?? STATUS_TOKENS.pending;
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
        fontSize: 11, fontWeight: 600, padding: '2px 8px',
        borderRadius: 'var(--radius-full)', background: 'var(--muted-soft)',
        color: 'var(--muted-ink)', textTransform: 'capitalize',
      }}
    >
      {role}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Initials avatar
// ---------------------------------------------------------------------------

function Initials({ email }: { email: string }) {
  const init = email.slice(0, 2).toUpperCase();
  return (
    <div
      style={{
        width: 36, height: 36, borderRadius: 'var(--radius-full)',
        background: 'var(--bg-muted)', border: '1px solid var(--border-card)',
        display: 'grid', placeItems: 'center',
        fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)',
        flexShrink: 0,
      }}
    >
      {init}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat cell — used in the 3-stat summary row
// ---------------------------------------------------------------------------

interface StatProps {
  label: string;
  value: number | string;
  note?: string;
  noteTone?: string;
}

function Stat({ label, value, note, noteTone }: StatProps) {
  return (
    <div
      style={{
        background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)', padding: '10px 12px',
      }}
    >
      <div style={eyebrow}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, marginTop: 2, color: 'var(--text-primary)' }}>
        {value}
      </div>
      {note && (
        <div style={{ fontSize: 11, color: noteTone ?? 'var(--text-muted)', marginTop: 2 }}>
          {note}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExperienceSummary — full-width header card
// ---------------------------------------------------------------------------

interface ExperienceSummaryProps {
  user: AdminUser;
  registry: AdminRegistry;
  /** segmentCount comes from the activity endpoint; 0 when not yet loaded. */
  segmentCount: number;
}

function ExperienceSummary({ user, registry, segmentCount }: ExperienceSummaryProps) {
  const sw = switchability(user.workspaces);
  const gameTotal = registry.games.length;
  const gameCount = user.games.length;

  return (
    <div style={{ ...card, ...cardBody }}>
      {/* Identity row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <Initials email={user.email} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 15, fontWeight: 700, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {user.email}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5, alignItems: 'center', flexWrap: 'wrap' }}>
            <RoleChip role={user.role} />
            <StatusBadge status={user.status} />
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              · last login {relativeTime(user.lastLogin)}
            </span>
          </div>
        </div>
      </div>

      {/* 3-stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Stat
          label="Workspaces"
          value={user.workspaces.length}
          note={sw.label}
          noteTone={sw.canSwitch ? 'var(--success-ink)' : undefined}
        />
        <Stat
          label="Games"
          value={gameCount}
          note={gameCount > 0 ? `${gameCount} of ${gameTotal}` : 'none'}
        />
        <Stat
          label="Segments"
          value={segmentCount}
          note="owned"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoleStatusEditor
// ---------------------------------------------------------------------------

const ROLES: AdminRole[] = ['viewer', 'editor', 'admin'];
const STATUSES: AdminStatus[] = ['active', 'pending', 'disabled'];

interface RoleStatusEditorProps {
  user: AdminUser;
  onSaved: (email: string) => void;
}

function RoleStatusEditor({ user, onSaved }: RoleStatusEditorProps) {
  const [role, setRole] = useState<AdminRole>(user.role);
  const [status, setStatus] = useState<AdminStatus>(user.status);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Resync when user prop changes (parent refetches)
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
    border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
  };

  return (
    <section style={card}>
      <div style={{ ...cardBody }}>
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
            style={{
              background: 'var(--brand)', color: '#fff', border: 'none',
              borderRadius: 'var(--radius-sm)', padding: '6px 14px',
              fontSize: 12, fontWeight: 600, cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.6 : 1, fontFamily: 'var(--font-sans)',
            }}
          >
            {saving ? 'Saving…' : 'Save role & status'}
          </button>
        </div>
        {msg && (
          <div
            style={{
              marginTop: 8, fontSize: 12, fontWeight: 500,
              padding: '6px 10px', borderRadius: 'var(--radius-sm)',
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

// ---------------------------------------------------------------------------
// WorkspaceGrantsSection — GrantMatrix + can-switch callout
// ---------------------------------------------------------------------------

interface WorkspaceGrantsSectionProps {
  user: AdminUser;
  registry: AdminRegistry;
  onSaved: (email: string) => void;
}

function WorkspaceGrantsSection({ user, registry, onSaved }: WorkspaceGrantsSectionProps) {
  const ws = useGrantSection(
    user.workspaces,
    (ids) => putAdminUserWorkspaces(user.email, ids),
    () => onSaved(user.email),
  );

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
      {/* Switchability callout below the matrix */}
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

// ---------------------------------------------------------------------------
// GameGrantsSection — GrantMatrix with live "N of M" count in header area
// ---------------------------------------------------------------------------

interface GameGrantsSectionProps {
  user: AdminUser;
  registry: AdminRegistry;
  onSaved: (email: string) => void;
}

function GameGrantsSection({ user, registry, onSaved }: GameGrantsSectionProps) {
  const games = useGrantSection(
    user.games,
    (ids) => putAdminUserGames(user.email, ids),
    () => onSaved(user.email),
  );

  const total = registry.games.length;
  const count = games.selected.size;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Live count badge above the matrix */}
      <div
        style={{
          display: 'flex', justifyContent: 'flex-end', marginBottom: 4,
          fontSize: 11.5, color: 'var(--text-muted)',
        }}
      >
        {count} of {total}
      </div>
      <GrantMatrix
        title="Game grants"
        options={registry.games.map((g) => ({ id: g.id, label: g.name }))}
        selected={games.selected}
        onToggle={games.toggle}
        onSave={games.save}
        saving={games.saving}
        saved={games.saved}
        error={games.error}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FeatureAccessSection — grouped toggles with override pills
// ---------------------------------------------------------------------------

interface FeatureAccessSectionProps {
  user: AdminUser;
  registry: AdminRegistry;
  onSaved: (email: string) => void;
}

function FeatureAccessSection({ user, registry, onSaved }: FeatureAccessSectionProps) {
  const groups = groupFeatures(registry, user);

  // Build initial selected set from resolved active entries
  const initSelected = registry.featureKeys.filter((k) => {
    const allEntries = groups.flatMap((g) => g.entries);
    return allEntries.find((e) => e.key === k)?.active ?? false;
  });

  const feats = useGrantSection(
    initSelected,
    (ids) => {
      const next: Record<string, boolean> = {};
      for (const key of registry.featureKeys) next[key] = ids.includes(key);
      return putAdminUserFeatures(user.email, next);
    },
    () => onSaved(user.email),
  );

  return (
    <section style={card}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Feature access</span>
        <button type="button" onClick={feats.save} disabled={feats.saving} style={saveBtnStyle(feats.saving)}>
          {feats.saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {groups.map((group) => (
          <div key={group.area}>
            {/* Group heading row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <span style={eyebrow}>{group.area}</span>
              <span
                style={{
                  fontSize: 10.5, padding: '1px 7px', borderRadius: 'var(--radius-full)',
                  background: group.defaultOn ? 'var(--success-soft)' : 'var(--warning-soft)',
                  color: group.defaultOn ? 'var(--success-ink)' : 'var(--warning-ink)',
                  fontWeight: 600,
                }}
              >
                {group.defaultOn ? 'default on' : 'default off'}
              </span>
            </div>

            {/* Toggle grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {group.entries.map((entry) => {
                const checked = feats.selected.has(entry.key);
                return (
                  <label
                    key={entry.key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)', fontSize: 13,
                      background: checked ? 'var(--bg-muted)' : 'transparent',
                      cursor: 'pointer', userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => feats.toggle(entry.key, e.target.checked)}
                      style={{ accentColor: 'var(--brand)', cursor: 'pointer' }}
                    />
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {FEATURE_LABEL[entry.key] ?? entry.key}
                    </span>
                    {entry.override && (
                      <span
                        style={{
                          fontSize: 10, color: 'var(--info-ink)', background: 'var(--info-soft)',
                          padding: '0 6px', borderRadius: 'var(--radius-full)', fontWeight: 600,
                        }}
                      >
                        override
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {(feats.saved || feats.error) && (
        <div
          style={{
            padding: '8px 14px', fontSize: 12, fontWeight: 500,
            borderTop: '1px solid var(--border-card)',
            background: feats.error ? 'var(--destructive-soft)' : 'var(--success-soft)',
            color: feats.error ? 'var(--destructive-ink)' : 'var(--success-ink)',
          }}
        >
          {feats.error ?? 'Saved.'}
        </div>
      )}
    </section>
  );
}

function saveBtnStyle(busy: boolean): React.CSSProperties {
  return {
    background: 'var(--brand)', color: '#fff', border: 'none',
    borderRadius: 'var(--radius-sm)', padding: '5px 14px',
    fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.6 : 1, fontFamily: 'var(--font-sans)',
  };
}

// ---------------------------------------------------------------------------
// ActivitySnapshot — read-only; fetches GET /api/admin/activity/users/:email
// ---------------------------------------------------------------------------

interface ActivitySnapshotProps {
  email: string;
  /** Called with segmentCount once loaded so summary header can show it. */
  onSegmentCount: (n: number) => void;
}

function ActivitySnapshot({ email, onSegmentCount }: ActivitySnapshotProps) {
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setActivity(null);
    setFailed(false);

    // apiFetch attaches the Bearer JWT automatically — required by the
    // requireRole('admin') guard on this route in real-auth (prod) mode.
    apiFetch<UserActivity>(`/api/admin/activity/users/${encodeURIComponent(email)}`)
      .then((data) => {
        setActivity(data);
        onSegmentCount(data.segmentCount ?? 0);
      })
      .catch(() => {
        setFailed(true);
      });
    // onSegmentCount is intentionally stable (defined inline in parent with useCallback
    // or passed as a setter — either way we only want this to rerun on email change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  return (
    <section style={{ ...card, position: 'relative' }}>
      <div style={{ ...cardBody }}>
        {/* Section heading */}
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
          Activity snapshot
        </div>

        {/* Stats mini-grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <Stat
            label="Chat turns"
            value={activity?.chatStats != null ? activity.chatStats.turns : '—'}
            note={
              activity == null && !failed ? 'loading…' :
              activity?.chatStats == null ? 'chat-service unreachable' :
              'last 30d'
            }
          />
          <Stat
            label="Status"
            value={activity == null ? '—' : activity.inactive ? 'Inactive' : 'Active'}
            note={
              activity == null ? undefined :
              activity.inactive ? 'last login >30d' : 'within 30d'
            }
            noteTone={
              activity == null ? undefined :
              activity.inactive ? 'var(--destructive-ink)' : 'var(--success-ink)'
            }
          />
        </div>

        {/* Recent features */}
        <div style={{ ...eyebrow, marginBottom: 6 }}>Recent features</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {activity == null || activity.recentFeatures.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>none recorded</span>
          ) : (
            activity.recentFeatures.map((f, i) => (
              <span
                key={i}
                style={{
                  fontSize: 12, background: 'var(--bg-muted)', padding: '3px 9px',
                  borderRadius: 'var(--radius-full)', color: 'var(--text-secondary)',
                }}
              >
                {FEATURE_LABEL[f] ?? f}
              </span>
            ))
          )}
        </div>

        {/* Recent query shapes */}
        <div style={{ ...eyebrow, marginBottom: 6 }}>Recent query shapes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {activity == null || activity.recentQueryShapes.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>none recorded</span>
          ) : (
            activity.recentQueryShapes.map((s, i) => (
              <div
                key={i}
                style={{
                  fontSize: 11.5,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: 'var(--text-secondary)', background: 'var(--bg-muted)',
                  padding: '6px 9px', borderRadius: 'var(--radius-sm)',
                }}
              >
                {formatQueryShape(s)}
              </div>
            ))
          )}
        </div>

        {/* Privacy note */}
        <p style={{ margin: '12px 0 0', fontSize: 10.5, color: 'var(--text-muted)' }}>
          Query shapes are member NAMES only — no filter values or UIDs (privacy allowlist).
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PerUserPanel — two-column layout: identity + grants left, capabilities + activity right.
// ---------------------------------------------------------------------------

export interface PerUserPanelProps {
  user: AdminUser;
  registry: AdminRegistry;
  onSaved: (email: string) => void;
}

export function PerUserPanel({ user, registry, onSaved }: PerUserPanelProps) {
  const [segmentCount, setSegmentCount] = useState(0);

  // Reset segment count when user changes so summary doesn't flash stale value.
  useEffect(() => { setSegmentCount(0); }, [user.email]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {/* Full-width summary header */}
      <ExperienceSummary user={user} registry={registry} segmentCount={segmentCount} />

      {/* Two-column grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          alignItems: 'start',
        }}
      >
        {/* LEFT: role/status + workspace grants + game grants */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <RoleStatusEditor user={user} onSaved={onSaved} />
          <WorkspaceGrantsSection user={user} registry={registry} onSaved={onSaved} />
          <GameGrantsSection user={user} registry={registry} onSaved={onSaved} />
        </div>

        {/* RIGHT: feature access + activity snapshot */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FeatureAccessSection user={user} registry={registry} onSaved={onSaved} />
          <ActivitySnapshot email={user.email} onSegmentCount={setSegmentCount} />
        </div>
      </div>
    </div>
  );
}
