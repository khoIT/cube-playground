/**
 * Model Audit tab bar — declares the 4 tabs and delegates ARIA/keyboard/styling
 * to the generic TabShell (same pattern as DevAudit's AuditTabs).
 */
import React from 'react';
import { TabShell } from '../../shell/tab-shell';
import type { TabDef } from '../../shell/tab-shell';

export const MODEL_AUDIT_TABS: TabDef[] = [
  { key: 'findings', label: 'Findings', path: '/model-audit/findings' },
  { key: 'diffs', label: 'Diffs', path: '/model-audit/diffs' },
  { key: 'upstream', label: 'Upstream', path: '/model-audit/upstream' },
  { key: 'trend', label: 'Trend', path: '/model-audit/trend' },
];

export function ModelAuditTabs() {
  return (
    <TabShell
      basePath="/model-audit"
      tabs={MODEL_AUDIT_TABS}
      ariaLabel="Model Audit"
      testIdPrefix="model-audit-tab"
    />
  );
}
