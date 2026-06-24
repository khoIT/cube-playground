/**
 * PerUserPanel — the Users & Access (GOVERN) per-user panel.
 *
 * Identity header + a cheap one-line vitals strip (last login · status · 30-day
 * session count) + a "View full activity →" deep-link, above the write controls
 * (role/status, workspace/game/feature grants). The heavy activity rollup
 * (chat-service call + segment/feature/audit queries) is NO LONGER fetched here
 * — it lives in ActivityProfile and loads only when an admin opens the
 * Observability drill-in. This panel makes ONE light, cancellable call to the
 * derived-sessions endpoint just for the session count in the strip.
 *
 * Re-exports the pure helpers so existing test imports stay at this entry point.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../../api/api-client';
import type { AdminUser, AdminRegistry } from '../access/use-admin-access';
import { relativeTime } from './per-user-panel-helpers';
import { card, cardBody, Initials, RoleChip, StatusBadge } from './per-user-shared';
import { AccessControls } from './access-controls';

// Re-export pure helpers so test imports stay at this single entry point.
export {
  switchability,
  groupFeatures,
  relativeTime,
  type SwitchabilityResult,
  type FeatureGroup,
  type FeatureEntry,
} from './per-user-panel-helpers';

// ── Identity header + cheap vitals strip ──────────────────────────────────────

function IdentityHeader({ user }: { user: AdminUser }) {
  const [sessions30, setSessions30] = useState<number | null>(null);

  // One light call (no chat-service) just for the session count. Cancellable so
  // rapidly switching users doesn't race a stale count onto the strip.
  useEffect(() => {
    let stale = false;
    setSessions30(null);
    apiFetch<{ sessions30: number }>(`/api/admin/activity/users/${encodeURIComponent(user.email)}/sessions?limit=1`)
      .then((d) => { if (!stale) setSessions30(d.sessions30 ?? 0); })
      .catch(() => { if (!stale) setSessions30(null); });
    return () => { stale = true; };
  }, [user.email]);

  return (
    <div style={{ ...card, ...cardBody }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Initials email={user.email} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.email}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5, alignItems: 'center', flexWrap: 'wrap' }}>
            <RoleChip role={user.role} />
            <StatusBadge status={user.status} />
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              · last login {relativeTime(user.lastLogin)}
              {' · '}
              {sessions30 == null ? '… sessions' : `${sessions30} session${sessions30 === 1 ? '' : 's'} · 30d`}
            </span>
          </div>
        </div>
        <Link
          to={`/admin/observability/users/${encodeURIComponent(user.email)}`}
          style={{
            fontSize: 12, fontWeight: 600, color: 'var(--brand)', textDecoration: 'none',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          View full activity →
        </Link>
      </div>
    </div>
  );
}

// ── PerUserPanel ──────────────────────────────────────────────────────────────

export interface PerUserPanelProps {
  user: AdminUser;
  registry: AdminRegistry;
  onSaved: (email: string) => void;
}

export function PerUserPanel({ user, registry, onSaved }: PerUserPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <IdentityHeader user={user} />
      <AccessControls user={user} registry={registry} onSaved={onSaved} />
    </div>
  );
}
