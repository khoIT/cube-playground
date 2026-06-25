/**
 * DevHubPanel — the inner shell for the Sys-admin hub "Dev" tab.
 *
 * Splits the Dev area into two sub-tabs (deep-linkable):
 *   Chat-Audit    → /admin/dev/chat-audit    (full DevAuditShell, default)
 *   Advisor-Audit → /admin/dev/advisor-audit (AdvisorAuditPanel)
 *   Data coverage → /admin/dev/data-coverage (Member360CoveragePanel)
 *
 * Chat-Audit mounts the full standalone audit shell rooted at the admin base
 * path (4 tabs — Sessions/Search/Leaderboard/Cache, Starters dropped). It runs
 * scope=all over /api/chat/debug/* for the admin identity.
 *
 * Distinct sub-paths (neither prefixes the other) so TabShell's resolveTab +
 * navigate guard work correctly when nested under the outer /admin/dev tab.
 * Exact /admin/dev redirects to the chat-audit default.
 */

import { ReactElement } from 'react';
import { Route, Switch, Redirect } from 'react-router-dom';

import { TabShell, type TabDef } from '../../../shell/tab-shell';
import { DevAuditShell } from '../../DevAudit/dev-audit-shell';
import { buildAuditTabs } from '../../DevAudit/audit-tabs';
import { AdvisorAuditPanel } from './advisor-audit-panel';
import { Member360CoveragePanel } from './member360-coverage-panel';
import { useOwnerEmailResolver } from './use-owner-email-resolver';
import { AtlasPage } from '../../Atlas/atlas-page';

const CHAT_AUDIT_BASE_PATH = '/admin/dev/chat-audit';
// Admin port drops Starters (global dev QA viewer, not a cross-user concern).
const ADMIN_AUDIT_TABS = buildAuditTabs(CHAT_AUDIT_BASE_PATH, { includeStarters: false });

const DEV_TABS: TabDef[] = [
  { key: 'chat-audit', label: 'Chat-Audit', path: '/admin/dev/chat-audit' },
  { key: 'advisor-audit', label: 'Advisor-Audit', path: '/admin/dev/advisor-audit' },
  { key: 'data-coverage', label: 'Data coverage', path: '/admin/dev/data-coverage' },
  { key: 'atlas', label: 'Feature Atlas', path: '/admin/dev/atlas' },
];

export function DevHubPanel(): ReactElement {
  // Resolves session owner_id (Keycloak sub) → email for the audit owner filter.
  const resolveOwner = useOwnerEmailResolver();
  return (
    <TabShell
      basePath="/admin/dev"
      tabs={DEV_TABS}
      ariaLabel="Dev tools"
      testIdPrefix="dev-tab"
    >
      <Switch>
        <Route exact path="/admin/dev">
          <Redirect to="/admin/dev/chat-audit" />
        </Route>
        <Route path="/admin/dev/chat-audit">
          <DevAuditShell basePath={CHAT_AUDIT_BASE_PATH} tabs={ADMIN_AUDIT_TABS} resolveOwner={resolveOwner} />
        </Route>
        <Route path="/admin/dev/advisor-audit">
          <AdvisorAuditPanel />
        </Route>
        <Route path="/admin/dev/data-coverage">
          <Member360CoveragePanel />
        </Route>
        <Route path="/admin/dev/atlas">
          <AtlasPage />
        </Route>
      </Switch>
    </TabShell>
  );
}

export default DevHubPanel;
