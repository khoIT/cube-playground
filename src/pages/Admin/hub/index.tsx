/**
 * AdminHub — /admin tabbed shell for all admin surfaces.
 *
 * Header matches the Dashboards / Access page pattern:
 *   eyebrow "Administration" (11px/600 uppercase) + ShieldCheck icon
 *   + 20px/700 "Sys-admin hub" title + subtitle
 *   padding: 24px 32px, full-width (maxWidth: 100%) — dense audit/ops surface
 *
 * Tabs (via the generic TabShell):
 *   Users & Access → /admin/access
 *   Observability  → /admin/observability  [Soon]
 *   Audit          → /admin/dev   (Chat-Audit / Advisor-Audit / Data coverage)
 *   Feature Atlas  → /admin/atlas (first-class; old /admin/dev/atlas redirects)
 *
 * resolveTab in TabShell ensures /admin/access deep-links land on the
 * correct tab. The CrossUserAuditPanel mounts inside the Audit tab so
 * admins can inspect any user's sessions (cross-user read scope).
 */

import React from 'react';
import { Route, Switch, Redirect } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { TabShell, type TabDef } from '../../../shell/tab-shell';
import { useAdminUsers } from '../access/use-admin-access';
import { UsersAndAccessTab } from './users-and-access-tab';
import { DevHubPanel } from './dev-hub-panel';
import { ObservabilityShell } from './observability-shell';
import { PreaggRunsTab } from './preagg-runs-tab';
import { QueryPerfTab } from './query-perf-tab';
import { SegmentRefreshOpsTab } from './segment-refresh-ops-tab';
import { CarePrecomputePanel } from './care-precompute-panel';
import { ApiKeysTab } from './api-keys-tab';
import { useSegmentRefreshAlertCount } from './segment-refresh-ops-data';
import { AtlasPage } from '../../Atlas/atlas-page';

// ---------------------------------------------------------------------------
// Tab definitions — Observability carries a live "N pending" badge so the
// recurring approval job is visible without opening the tab.
// ---------------------------------------------------------------------------

function buildAdminTabs(pendingCount: number, refreshAlertCount: number): TabDef[] {
  return [
    { key: 'access', label: 'Users & Access', path: '/admin/access' },
    {
      key: 'observability',
      label: 'Observability',
      path: '/admin/observability',
      tag: pendingCount > 0 ? `${pendingCount} pending` : undefined,
    },
    { key: 'dev', label: 'Audit', path: '/admin/dev' },
    { key: 'atlas', label: 'Feature Atlas', path: '/admin/atlas' },
    { key: 'preagg-runs', label: 'Pre-agg Runs', path: '/admin/preagg-runs' },
    { key: 'query-perf', label: 'Query Performance', path: '/admin/query-perf' },
    {
      key: 'segment-refreshes',
      label: 'Segment Refreshes',
      path: '/admin/segment-refreshes',
      // wedged + degraded count — surfaces a stuck/cold-failing cron without
      // opening the tab (mirrors the Observability "N pending" badge).
      tag: refreshAlertCount > 0 ? `${refreshAlertCount} alert` : undefined,
    },
    { key: 'care-precompute', label: 'Care Precompute', path: '/admin/care-precompute' },
    { key: 'api-keys', label: 'API Keys', path: '/admin/api-keys' },
  ];
}

// ---------------------------------------------------------------------------
// AdminHub page
// ---------------------------------------------------------------------------

export function AdminHub() {
  const { users } = useAdminUsers();
  const pendingCount = users.filter((u) => u.status === 'pending').length;
  const refreshAlertCount = useSegmentRefreshAlertCount();
  const adminTabs = buildAdminTabs(pendingCount, refreshAlertCount);

  return (
    <div
      style={{
        padding: '24px 32px',
        // Full-width shell: the admin hub is a dense audit/ops surface (3-pane
        // run inspectors, wide tables) that benefits from the whole viewport,
        // unlike the centered list pages. No max cap — width is the workspace.
        maxWidth: '100%',
        margin: '0 auto',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Page header — mirrors Dashboards/Access pattern exactly */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            marginBottom: 4,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-muted)',
          }}
        >
          Administration
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldCheck size={20} style={{ color: 'var(--brand)' }} />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
            Sys-admin hub
          </h1>
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Manage access, fine-grained per-user controls, observability, and dev tooling.
        </p>
      </div>

      {/* Tab shell — resolveTab handles /admin/access deep-link */}
      <TabShell
        basePath="/admin"
        tabs={adminTabs}
        ariaLabel="Sys-admin hub"
        testIdPrefix="hub-tab"
      >
        {/*
          Panel content switches on the matched sub-route.
          /admin (exact) redirects to /admin/access so there's always
          a valid tab active on first load.
        */}
        <Switch>
          <Route exact path="/admin">
            <Redirect to="/admin/access" />
          </Route>

          <Route path="/admin/access">
            <div
              role="tabpanel"
              id="hub-tab-panel-access"
              aria-labelledby="hub-tab-access"
            >
              <UsersAndAccessTab />
            </div>
          </Route>

          {/* Observability owns its own sub-tabs (Org overview / Users) and the
              per-user drill-in, so it takes the whole /admin/observability/*
              subtree. The shell redirects the bare path to the Org sub-tab.
              resolveTab keeps the main Observability tab highlighted via its
              segment-boundary prefix. */}
          <Route path="/admin/observability">
            <ObservabilityShell />
          </Route>

          <Route exact path="/admin/preagg-runs">
            <PreaggRunsTab />
          </Route>

          <Route exact path="/admin/query-perf">
            <QueryPerfTab />
          </Route>

          <Route exact path="/admin/segment-refreshes">
            <SegmentRefreshOpsTab />
          </Route>

          <Route exact path="/admin/care-precompute">
            <CarePrecomputePanel />
          </Route>

          <Route exact path="/admin/api-keys">
            <ApiKeysTab />
          </Route>

          {/* Feature Atlas — first-class admin surface (promoted out of the Dev
              tab). The old /admin/dev/atlas deep-link redirects here; this route
              must precede the non-exact /admin/dev route so the redirect wins. */}
          <Route exact path="/admin/dev/atlas">
            <Redirect to="/admin/atlas" />
          </Route>

          <Route path="/admin/atlas">
            <div
              role="tabpanel"
              id="hub-tab-panel-atlas"
              aria-labelledby="hub-tab-atlas"
            >
              <AtlasPage />
            </div>
          </Route>

          <Route path="/admin/dev">
            <div
              role="tabpanel"
              id="hub-tab-panel-dev"
              aria-labelledby="hub-tab-dev"
            >
              {/*
                Dev area splits into Chat-Audit (CrossUserAuditPanel — cross-user
                read scope; replaces the legacy self-scoped DevAuditShell, which
                still lives at /dev/chat-audit) and Data coverage (Member 360
                coverage matrix). DevHubPanel owns the sub-routing.
              */}
              <DevHubPanel />
            </div>
          </Route>
        </Switch>
      </TabShell>
    </div>
  );
}
