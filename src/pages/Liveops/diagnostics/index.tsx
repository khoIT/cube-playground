/**
 * DiagnosticsPage — /liveops/diagnostics
 *
 * The "why did it move?" sub-hub: Delta decomposition, Event timeline, Lifecycle
 * flow. This file owns the hub chrome (header + query-synced tabs); each tab body
 * is filled by its own build step. Page-header pattern mirrors Dashboards / Cohort
 * (24/32 padding, icon + 20/700 title, uppercase eyebrow).
 */
import React from 'react';
import { Stethoscope, TrendingDown, CalendarClock, Workflow } from 'lucide-react';
import { useGameContext } from '../../../components/Header/use-game-context';
import { LiveopsTabs, type LiveopsHubTab } from '../_hub/liveops-tabs';
import { useLiveopsTab } from '../_hub/use-liveops-tab';
import { HubSectionPlaceholder } from '../_hub/hub-section-placeholder';
import { DeltaDecompositionView } from './delta/delta-decomposition-view';
import { EventTimelineView } from './timeline/event-timeline-view';

type DiagnosticsTab = 'delta' | 'timeline' | 'lifecycle';

const TABS: LiveopsHubTab<DiagnosticsTab>[] = [
  { id: 'delta', label: 'Delta decomposition', icon: TrendingDown },
  { id: 'timeline', label: 'Event timeline', icon: CalendarClock },
  { id: 'lifecycle', label: 'Lifecycle flow', icon: Workflow },
];
const TAB_IDS: readonly DiagnosticsTab[] = ['delta', 'timeline', 'lifecycle'];

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1200,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

export function DiagnosticsPage() {
  const { gameId } = useGameContext();
  const [active, setActive] = useLiveopsTab(TAB_IDS, 'delta');

  return (
    <div style={pageStyle}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 6,
        }}
      >
        Live operations · {gameId}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <Stethoscope size={20} style={{ color: 'var(--brand)' }} />
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.005em',
          }}
        >
          Diagnostics
        </h1>
      </div>

      <LiveopsTabs tabs={TABS} active={active} onChange={setActive} ariaLabel="Diagnostics sections" />

      {active === 'delta' && <DeltaDecompositionView />}
      {active === 'timeline' && <EventTimelineView />}
      {active === 'lifecycle' && (
        <HubSectionPlaceholder
          icon={Workflow}
          title="Lifecycle flow"
          note="Watch players move between New, Core, Lapsing, Reactivated, and Churned week over week. Arriving in a later build step."
        />
      )}
    </div>
  );
}
