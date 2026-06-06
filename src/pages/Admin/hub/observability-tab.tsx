/**
 * ObservabilityTab — org-wide activity triage for the sys-admin hub.
 *
 * Consumes GET /api/admin/activity/summary (the org rollup):
 *   - status rollup cards (users by status, active 7/30 d, total chat turns)
 *   - pending-approval queue (auto-created pending logins awaiting activation)
 *   - inactive list (>30 d since last login) with a quick-disable triage action
 *   - top features used + per-user drill-in links
 *   - the audit log viewer (recent access-management activity feed + CSV export)
 *
 * chat-down degrades to "—" (the aggregator returns null chat counts, never a
 * 500). tokens.css only.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { patchAdminUser, useAdminUsers } from '../access/use-admin-access';
import { useActivitySummary, type InactiveUser } from './observability-data';
import { AuditLogViewer } from './audit-log-viewer';
import { CostBreakdownSection } from './cost-breakdown-section';
import { LlmAuthModeControl } from './llm-auth-mode-control';
import { PendingApprovalQueue } from './pending-approval-queue';
import { relativeTime, FEATURE_LABEL } from './per-user-panel-helpers';

const card: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
  padding: '14px 16px',
};

const eyebrow: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', color: 'var(--text-muted)',
};

function KpiCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div style={card}>
      <div style={eyebrow}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2, marginTop: 4, color: 'var(--text-primary)' }}>
        {value}
      </div>
      {note && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{note}</div>}
    </div>
  );
}

export function ObservabilityTab() {
  const { summary, loading, error, refetch } = useActivitySummary();
  const { users, refetch: refetchUsers } = useAdminUsers();

  const pending = users
    .filter((u) => u.status === 'pending')
    .map((u) => ({ email: u.email, lastLogin: u.lastLogin }));

  // Approve/deny mutates status → refresh both the user list and the org rollup.
  const onQueueChanged = () => { refetchUsers(); refetch(); };

  if (error) {
    return (
      <div
        role="tabpanel"
        id="hub-tab-panel-observability"
        aria-labelledby="hub-tab-observability"
        style={{ ...card, marginTop: 16, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)' }}
      >
        Couldn't load observability data: {error}
      </div>
    );
  }

  return (
    <div role="tabpanel" id="hub-tab-panel-observability" aria-labelledby="hub-tab-observability">
      {loading && !summary ? (
        <div style={{ ...card, marginTop: 16, color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {/* KPI cards */}
          <div
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 12, marginTop: 16,
            }}
          >
            <KpiCard label="Active" value={summary?.usersByStatus.active ?? 0} note="users" />
            <KpiCard label="Pending" value={summary?.usersByStatus.pending ?? 0} note="invited" />
            <KpiCard label="Disabled" value={summary?.usersByStatus.disabled ?? 0} note="users" />
            <KpiCard label="Active · 7d" value={summary?.activeLast7d ?? 0} note="had activity" />
            <KpiCard label="Active · 30d" value={summary?.activeLast30d ?? 0} note="had activity" />
            <KpiCard
              label="Chat turns"
              value={summary?.totalChatTurns == null ? '—' : summary.totalChatTurns}
              note={summary?.totalChatTurns == null ? 'chat-service unreachable' : 'last 30d'}
            />
          </div>

          {/* Pending-approval queue — the #1 recurring admin job, promoted up top */}
          <PendingApprovalQueue users={pending} onChanged={onQueueChanged} />

          {/* Credential lane toggle: gateway keys vs subscription OAuth */}
          <LlmAuthModeControl />

          {/* Org-wide LLM spend: total + by user / session / game / workspace */}
          <CostBreakdownSection />

          {/* Two-column: inactive triage + top features */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, marginTop: 12, alignItems: 'start' }}>
            <InactiveList users={summary?.inactive ?? []} onDisabled={refetch} />
            <TopFeatures features={summary?.topFeatures ?? []} />
          </div>

          {/* Recent access-management activity + CSV export */}
          <AuditLogViewer />
        </>
      )}
    </div>
  );
}

// ── Inactive list with quick-disable triage ──────────────────────────────────

function InactiveList({ users, onDisabled }: { users: InactiveUser[]; onDisabled: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function disable(email: string) {
    setBusy(email);
    setErr(null);
    try {
      await patchAdminUser(email, { status: 'disabled' });
      onDisabled();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Inactive</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>no login in 30+ days</span>
      </div>
      {err && (
        <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)' }}>{err}</div>
      )}
      {users.length === 0 ? (
        <div style={{ padding: '14px', fontSize: 13, color: 'var(--text-muted)' }}>Everyone has logged in recently.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {users.map((u) => (
            <li
              key={u.email}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                borderBottom: '1px solid var(--border-card)',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link
                  to={`/admin/observability/${encodeURIComponent(u.email)}`}
                  style={{
                    fontSize: 13, color: 'var(--text-primary)', textDecoration: 'none',
                    display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                  title="View activity"
                >
                  {u.email}
                </Link>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  last login {relativeTime(u.lastLogin)} · {u.status}
                </div>
              </div>
              {u.status !== 'disabled' && (
                <button
                  type="button"
                  onClick={() => disable(u.email)}
                  disabled={busy === u.email}
                  style={{
                    background: 'var(--destructive-soft)', color: 'var(--destructive-ink)',
                    border: '1px solid var(--border-card)', borderRadius: 'var(--radius-sm)',
                    padding: '4px 10px', fontSize: 11.5, fontWeight: 600,
                    cursor: busy === u.email ? 'default' : 'pointer', opacity: busy === u.email ? 0.6 : 1,
                    fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
                  }}
                >
                  {busy === u.email ? 'Disabling…' : 'Disable'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Top features ──────────────────────────────────────────────────────────────

function TopFeatures({ features }: { features: Array<{ feature: string; count: number }> }) {
  const max = features.reduce((m, f) => Math.max(m, f.count), 0) || 1;
  return (
    <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-card)', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
        Top features
        <span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>last 30d</span>
      </div>
      {features.length === 0 ? (
        <div style={{ padding: '14px', fontSize: 13, color: 'var(--text-muted)' }}>No feature activity recorded.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {features.map((f) => (
            <li key={f.feature} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', width: 110, flexShrink: 0 }}>
                {FEATURE_LABEL[f.feature] ?? f.feature}
              </span>
              <span style={{ flex: 1, height: 8, background: 'var(--bg-muted)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${(f.count / max) * 100}%`, background: 'var(--brand)' }} />
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 28, textAlign: 'right' }}>{f.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
