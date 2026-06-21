/**
 * Presentational wrapper for one Movement section. Renders the chart via the
 * shared AssistantChartSection (non-embedded — its built-in view menu is the
 * line↔bar / table / CSV toggle the user asked for). Loading / error / empty
 * fall back to a placeholder card styled to match AssistantChartSection's
 * surface so the layout doesn't jump.
 *
 * Freshness / cadence / carry-forward status is NOT rendered here — it reads
 * once at the tab control bar (the per-chart meta strip was removed so the same
 * note doesn't repeat under every chart). The asOf/stale/cadenceChanges/
 * carryForward props are still accepted (callers pass them) and lifted to the
 * control bar by the membership section's onMeta.
 */

import { ReactElement, ReactNode } from 'react';
import { AssistantChartSection } from '../../../../Chat/components/assistant-chart-section';
import type { ChartArtifact } from '../../../../../api/chat-sse-client';
import type { CadenceChange } from '../../../../../api/segment-movement-client';

interface Props {
  title: string;
  loading: boolean;
  error: Error | null;
  /** Built chart; null when the window has no captured points yet. */
  artifact: ChartArtifact | null;
  /** Accepted for API parity; surfaced at the control bar, not rendered here. */
  asOf?: string | null;
  stale?: boolean;
  cadenceChanges?: CadenceChange[];
  carryForward?: string[];
  /** Optional control row (e.g. distribution dimension selector). */
  control?: ReactNode;
  /**
   * Optional control rendered INSIDE the chart card header, beside the title —
   * e.g. the state-distribution breakdown tabs, so they read as the chart's own
   * selector rather than a pill bar floating above a detached card.
   */
  headerAction?: ReactNode;
  /** Shown when there is no data (loaded but empty). */
  emptyHint?: string;
}

function PlaceholderCard({ title, headerAction, children }: { title: string; headerAction?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <div
      style={{
        width: '100%',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-strong)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', borderBottom: '1px solid var(--border-strong)', fontSize: 14, fontWeight: 600, color: 'var(--shell-text)' }}>
        <span style={{ flex: 1, minWidth: 0 }}>{title}</span>
        {headerAction}
      </div>
      <div style={{ padding: '32px 24px', fontSize: 13, color: 'var(--shell-text-subtle)', textAlign: 'center' }}>
        {children}
      </div>
    </div>
  );
}

export function MovementSection({
  title, loading, error, artifact, control, headerAction, emptyHint,
}: Props): ReactElement {
  let body: ReactElement;
  if (loading) {
    body = <PlaceholderCard title={title} headerAction={headerAction}>Loading…</PlaceholderCard>;
  } else if (error) {
    body = <PlaceholderCard title={title} headerAction={headerAction}><span style={{ color: 'var(--destructive-ink)' }}>{error.message}</span></PlaceholderCard>;
  } else if (!artifact || artifact.spec.data.length === 0) {
    body = (
      <PlaceholderCard title={title} headerAction={headerAction}>
        {emptyHint ?? 'No snapshots captured in this range yet — history accrues as the snapshot job runs.'}
      </PlaceholderCard>
    );
  } else {
    body = <AssistantChartSection artifact={artifact} headerAction={headerAction} defaultView="chart" />;
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {control}
      {body}
    </section>
  );
}
