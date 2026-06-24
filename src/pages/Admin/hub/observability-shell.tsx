/**
 * ObservabilityShell — owns the /admin/observability/* subtree and splits it
 * into two sub-tabs for clarity:
 *
 *   Org overview → /admin/observability/org    — the org-wide rollup
 *                  (KPIs, LLM lane, Cost, inactive, top features, audit).
 *   Users        → /admin/observability/users       — the searchable roster.
 *                  /admin/observability/users/:email — one user's profile, with
 *                  a persistent rail on the left for fast lateral switching.
 *
 * The bare path redirects to the Org sub-tab. The sub-tab control is a
 * segmented pill group — visually subordinate to the main underline tab bar
 * (which AdminHub renders and which stays the only nav header; no breadcrumb).
 * tokens.css only.
 */

import React from 'react';
import { Link, Route, Switch, Redirect, useLocation, useParams } from 'react-router-dom';
import { useAdminUsers } from '../access/use-admin-access';
import { ObservabilityRosterRail } from './observability-roster-rail';
import { ObservabilityTab } from './observability-tab';
import { ObservabilityUsersTable } from './observability-users-table';
import { UserActivityProfile } from './user-activity-profile';

const ORG_PATH = '/admin/observability/org';
const USERS_PATH = '/admin/observability/users';

// ── Sub-tab control (segmented pill group) ───────────────────────────────────

function SubTab({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      style={{
        padding: '6px 16px', fontSize: 12.5, fontWeight: 600, textDecoration: 'none',
        borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-sans)',
        background: active ? 'var(--bg-card)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
      }}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}

function ObservabilitySubTabs() {
  const { pathname } = useLocation();
  const onUsers = pathname.startsWith(USERS_PATH);
  return (
    <div
      role="tablist"
      aria-label="Observability views"
      style={{
        display: 'inline-flex', gap: 2, padding: 3, margin: '16px 0',
        borderRadius: 'var(--radius-md)', background: 'var(--bg-muted)',
        border: '1px solid var(--border-card)',
      }}
    >
      <SubTab to={ORG_PATH} active={!onUsers}>Org overview</SubTab>
      <SubTab to={USERS_PATH} active={onUsers}>Users</SubTab>
    </div>
  );
}

// ── Users sub-tab: roster table, or rail + profile when a user is selected ────

function UsersView() {
  const params = useParams<{ email?: string }>();
  const email = params.email ? decodeURIComponent(params.email) : null;
  const { users } = useAdminUsers();

  if (!email) return <ObservabilityUsersTable users={users} />;

  return (
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
        <UserActivityProfile email={email} />
      </div>
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export function ObservabilityShell() {
  return (
    <div role="tabpanel" id="hub-tab-panel-observability" aria-labelledby="hub-tab-observability">
      <ObservabilitySubTabs />
      <Switch>
        <Route path={ORG_PATH}>
          <ObservabilityTab />
        </Route>
        <Route path={`${USERS_PATH}/:email`}>
          <UsersView />
        </Route>
        <Route path={USERS_PATH}>
          <UsersView />
        </Route>
        <Route>
          <Redirect to={ORG_PATH} />
        </Route>
      </Switch>
    </div>
  );
}
