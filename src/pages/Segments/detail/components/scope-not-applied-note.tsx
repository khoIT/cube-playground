/**
 * Interim honesty note for tabs the paying sub-scope does not yet cover
 * (Members tiers + Care read refresh-time snapshots that have no per-uid LTV;
 * scoping them is a follow-up). Without this, toggling "Paying" and landing on
 * Members/Care would silently show the full segment — the note makes the gap
 * explicit. Renders nothing unless the paying sub-scope is active.
 */

import { ReactElement } from 'react';
import { Info } from 'lucide-react';
import { useSegmentScope } from '../segment-scope-context';

export function ScopeNotAppliedNote({ surface }: { surface: string }): ReactElement | null {
  const { scope } = useSegmentScope();
  if (scope !== 'paying') return null;
  return (
    <div
      role="note"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '0 0 14px',
        padding: '8px 12px',
        fontSize: 12.5,
        color: 'var(--text-secondary)',
        background: 'var(--bg-muted)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <Info size={14} aria-hidden style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
      <span>
        Paying-only scope applies to KPIs, Insights &amp; Monitor. {surface} still shows the
        full segment — paying-scoped {surface.toLowerCase()} is coming next.
      </span>
    </div>
  );
}
