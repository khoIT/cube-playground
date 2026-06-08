/**
 * DevHubPanel — the inner shell for the Sys-admin hub "Dev" tab.
 *
 * Splits the Dev area into two sub-tabs (deep-linkable):
 *   Chat-Audit    → /admin/dev/chat-audit   (CrossUserAuditPanel, default)
 *   Data coverage → /admin/dev/data-coverage (Member360CoveragePanel)
 *
 * Distinct sub-paths (neither prefixes the other) so TabShell's resolveTab +
 * navigate guard work correctly when nested under the outer /admin/dev tab.
 * Exact /admin/dev redirects to the chat-audit default.
 */

import { ReactElement } from 'react';
import { Route, Switch, Redirect } from 'react-router-dom';

import { TabShell, type TabDef } from '../../../shell/tab-shell';
import { CrossUserAuditPanel } from './cross-user-audit-panel';
import { Member360CoveragePanel } from './member360-coverage-panel';

const DEV_TABS: TabDef[] = [
  { key: 'chat-audit', label: 'Chat-Audit', path: '/admin/dev/chat-audit' },
  { key: 'data-coverage', label: 'Data coverage', path: '/admin/dev/data-coverage' },
];

export function DevHubPanel(): ReactElement {
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
          <CrossUserAuditPanel />
        </Route>
        <Route path="/admin/dev/data-coverage">
          <Member360CoveragePanel />
        </Route>
      </Switch>
    </TabShell>
  );
}

export default DevHubPanel;
