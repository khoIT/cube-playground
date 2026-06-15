/**
 * PermissionDecisionsSection — renders a table of permission denial records
 * captured from the SDK result message permission_denials[].
 *
 * Only rendered when permissionDecisions.length > 0 (caller guards).
 * In bypassPermissions mode this section is always empty.
 */
import React from 'react';
import { T } from '../../shell/theme';
import type { PermissionDecision } from './use-debug-api';

const th: React.CSSProperties = {
  textAlign: 'left', padding: '3px 6px',
  borderBottom: `1px solid var(--shell-border)`, color: 'var(--shell-text-subtle)', fontWeight: 600,
};
const td: React.CSSProperties = {
  padding: '3px 6px', borderBottom: `1px solid var(--shell-bg-subtle)`, verticalAlign: 'top',
};
const decisionPill = (decision: string): React.CSSProperties => ({
  display: 'inline-block', padding: '1px 7px', borderRadius: 10,
  fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
  background: decision === 'denied' ? '#fee2e2' : '#dcfce7',
  color: decision === 'denied' ? '#991b1b' : '#166534',
  border: `1px solid ${decision === 'denied' ? '#fca5a5' : '#86efac'}`,
});

interface PermissionDecisionsSectionProps {
  decisions: PermissionDecision[];
}

export function PermissionDecisionsSection({ decisions }: PermissionDecisionsSectionProps) {
  if (decisions.length === 0) return null;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
      <thead>
        <tr>
          {['Tool', 'Decision', 'Reason', 'At'].map((h) => (
            <th key={h} style={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {decisions.map((d) => (
          <tr key={d.id}>
            <td style={{ ...td, fontFamily: T.fMono }}>{d.tool_name}</td>
            <td style={td}>
              <span style={decisionPill(d.decision)}>{d.decision}</span>
            </td>
            <td style={{ ...td, color: 'var(--shell-text-subtle)' }}>{d.reason ?? '—'}</td>
            <td style={{ ...td, fontFamily: T.fMono, color: 'var(--shell-text-faint)' }}>
              {new Date(d.at).toLocaleTimeString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
