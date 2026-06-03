/**
 * AdminHub — /admin tabbed shell for all admin surfaces.
 *
 * Header matches the Dashboards / Access page pattern:
 *   eyebrow "Administration" (11px/600 uppercase) + ShieldCheck icon
 *   + 20px/700 "Sys-admin hub" title + subtitle
 *   padding: 24px 32px, maxWidth: 1200, margin: 0 auto
 *
 * Tabs (via the generic TabShell):
 *   Users & Access → /admin/access
 *   Observability  → /admin/observability  [Soon]
 *   Dev / Chat-Audit → /admin/dev          [relocated]
 *
 * resolveTab in TabShell ensures /admin/access deep-links land on the
 * correct tab. The CrossUserAuditPanel mounts inside the Dev tab so
 * admins can inspect any user's sessions (cross-user read scope).
 */

import React from 'react';
import { Route, Switch, Redirect } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { TabShell, type TabDef } from '../../../shell/tab-shell';
import { UsersAndAccessTab } from './users-and-access-tab';
import { CrossUserAuditPanel } from './cross-user-audit-panel';
import { ObservabilityTab } from './observability-tab';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const ADMIN_TABS: TabDef[] = [
  { key: 'access', label: 'Users & Access', path: '/admin/access' },
  { key: 'observability', label: 'Observability', path: '/admin/observability' },
  { key: 'dev', label: 'Dev / Chat-Audit', path: '/admin/dev', tag: 'relocated' },
];

// ---------------------------------------------------------------------------
// AdminHub page
// ---------------------------------------------------------------------------

export function AdminHub() {
  return (
    <div
      style={{
        padding: '24px 32px',
        maxWidth: 1200,
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
        tabs={ADMIN_TABS}
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

          <Route path="/admin/observability">
            <ObservabilityTab />
          </Route>

          <Route path="/admin/dev">
            <div
              role="tabpanel"
              id="hub-tab-panel-dev"
              aria-labelledby="hub-tab-dev"
            >
              {/*
                CrossUserAuditPanel replaces the legacy self-scoped DevAuditShell
                here. Admins need cross-user read access (any user's sessions),
                not just their own. The legacy DevAuditShell remains at its own
                /dev/chat-audit route for self-scoped use — it is NOT deleted.
              */}
              <CrossUserAuditPanel />
            </div>
          </Route>
        </Switch>
      </TabShell>
    </div>
  );
}
