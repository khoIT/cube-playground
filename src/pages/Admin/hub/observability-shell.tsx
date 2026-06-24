/**
 * ObservabilityShell — the master-detail surface for /admin/observability.
 *
 * Left: a persistent searchable user roster (ObservabilityRosterRail).
 * Right: the org rollup (ObservabilityTab) when no user is selected, or the
 * per-user profile (UserActivityProfile) when the URL carries an :email.
 *
 * Both /admin/observability and /admin/observability/:email render this shell;
 * the right pane is chosen from the route param, so deep-links + back-button
 * keep working and switching users is just a rail click. A breadcrumb names
 * BOTH escape hatches explicitly — "Users & Access" (the roster/govern tab) and
 * "Observability" (the org rollup) — since they're genuinely different places.
 * tokens.css only.
 */

import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAdminUsers } from '../access/use-admin-access';
import { ObservabilityRosterRail } from './observability-roster-rail';
import { ObservabilityTab } from './observability-tab';
import { UserActivityProfile } from './user-activity-profile';

const crumbLink: React.CSSProperties = {
  color: 'var(--text-secondary)', textDecoration: 'none', fontWeight: 600,
};

function Breadcrumb({ email }: { email: string | null }) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text-muted)', margin: '16px 0 12px', flexWrap: 'wrap' }}
    >
      <Link to="/admin/access" style={crumbLink}>Users &amp; Access</Link>
      <ChevronRight size={13} style={{ color: 'var(--border-strong)' }} aria-hidden />
      {email ? (
        <>
          <Link to="/admin/observability" style={crumbLink}>Observability</Link>
          <ChevronRight size={13} style={{ color: 'var(--border-strong)' }} aria-hidden />
          <span style={{ color: 'var(--text-primary)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '40ch' }}>
            {email}
          </span>
        </>
      ) : (
        <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Observability</span>
      )}
    </nav>
  );
}

export function ObservabilityShell() {
  const params = useParams<{ email?: string }>();
  const email = params.email ? decodeURIComponent(params.email) : null;
  const { users } = useAdminUsers();

  return (
    <div role="tabpanel" id="hub-tab-panel-observability" aria-labelledby="hub-tab-observability">
      <Breadcrumb email={email} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(240px, 288px) 1fr',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          background: 'var(--bg-card)',
        }}
      >
        <ObservabilityRosterRail users={users} selectedEmail={email} />
        <div style={{ padding: '16px 18px', minWidth: 0 }}>
          {email ? <UserActivityProfile email={email} /> : <ObservabilityTab />}
        </div>
      </div>
    </div>
  );
}
