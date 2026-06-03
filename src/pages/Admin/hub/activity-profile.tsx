/**
 * ActivityProfile — the OBSERVE surface: read-only per-user activity.
 *
 * Self-sufficient given an email: fetches the activity rollup (GET
 * /api/admin/activity/users/:email) and the derived session timeline (GET
 * .../sessions) and renders identity vitals + session history + recent query
 * shapes + last access change. This is the heavy half that used to live inside
 * PerUserPanel; it now loads only when an admin opens the profile, not on every
 * govern-tab selection. tokens.css only.
 */

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../api/api-client';
import type { AdminRole, AdminStatus } from '../access/use-admin-access';
import { relativeTime, FEATURE_LABEL, type QueryShape } from './per-user-panel-helpers';
import { card, cardBody, eyebrow, Stat, Initials, RoleChip, StatusBadge } from './per-user-shared';
import { SessionTimeline, type UserSessions } from './session-timeline';
import { QueryShapeDetail } from './query-shape-detail';

interface ChatStats { turns: number }

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
  lastChange: { actor: string; action: string; ts: string } | null;
}

export function ActivityProfile({ email }: { email: string }) {
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [sessions, setSessions] = useState<UserSessions | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stale = false;
    setActivity(null);
    setSessions(null);
    setFailed(false);

    // apiFetch attaches the Bearer JWT — required by requireRole('admin').
    apiFetch<UserActivity>(`/api/admin/activity/users/${encodeURIComponent(email)}`)
      .then((d) => { if (!stale) setActivity(d); })
      .catch(() => { if (!stale) setFailed(true); });

    apiFetch<UserSessions>(`/api/admin/activity/users/${encodeURIComponent(email)}/sessions`)
      .then((d) => { if (!stale) setSessions(d); })
      .catch(() => { /* timeline degrades to empty; activity error is the surfaced one */ });

    return () => { stale = true; };
  }, [email]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {/* Identity + vitals header */}
      <div style={{ ...card, ...cardBody }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
          <Initials email={email} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {email}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 5, alignItems: 'center', flexWrap: 'wrap' }}>
              {activity && <RoleChip role={activity.role as AdminRole} />}
              {activity && <StatusBadge status={activity.status as AdminStatus} />}
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                · last login {relativeTime(activity?.lastLogin ?? null)}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <Stat
            label="Chat turns"
            value={activity?.chatStats != null ? activity.chatStats.turns : '—'}
            note={
              activity == null && !failed ? 'loading…' :
              activity?.chatStats == null ? 'chat-service unreachable' : 'last 30d'
            }
          />
          <Stat
            label="Status"
            value={activity == null ? '—' : activity.inactive ? 'Inactive' : 'Active'}
            note={activity == null ? undefined : activity.inactive ? 'last login >30d' : 'within 30d'}
            noteTone={activity == null ? undefined : activity.inactive ? 'var(--destructive-ink)' : 'var(--success-ink)'}
          />
          <Stat label="Segments" value={activity?.segmentCount ?? '—'} note="owned" />
        </div>
      </div>

      {/* Derived session history */}
      <SessionTimeline data={sessions} loading={sessions == null && !failed} />

      {/* Recent query shapes (most-recent overall, privacy-safe) */}
      <section style={{ ...card, ...cardBody }}>
        <div style={{ ...eyebrow, marginBottom: 6 }}>Recent query shapes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {activity == null || activity.recentQueryShapes.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>none recorded</span>
          ) : (
            activity.recentQueryShapes.map((s, i) => <QueryShapeDetail key={i} shape={s} />)
          )}
        </div>

        {activity && activity.recentFeatures.length > 0 && (
          <>
            <div style={{ ...eyebrow, margin: '14px 0 6px' }}>Recent features</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {activity.recentFeatures.map((f, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 12, background: 'var(--bg-muted)', padding: '3px 9px',
                    borderRadius: 'var(--radius-full)', color: 'var(--text-secondary)',
                  }}
                >
                  {FEATURE_LABEL[f] ?? f}
                </span>
              ))}
            </div>
          </>
        )}

        <div style={{ ...eyebrow, margin: '14px 0 6px' }}>Last changed</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {activity?.lastChange == null ? (
            <span style={{ color: 'var(--text-muted)' }}>no recorded changes</span>
          ) : (
            <>
              <span style={{ fontWeight: 600 }}>{activity.lastChange.action}</span>
              {' by '}{activity.lastChange.actor}{' · '}{relativeTime(activity.lastChange.ts)}
            </>
          )}
        </div>

        <p style={{ margin: '12px 0 0', fontSize: 10.5, color: 'var(--text-muted)' }}>
          Query shapes are member NAMES only — no filter values or UIDs (privacy allowlist).
        </p>
      </section>
    </div>
  );
}
