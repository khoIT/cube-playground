/**
 * CS care-first Member-360 — the layout used when the 360 is reached from the CS
 * care queue (segment-less). The care timeline is the central action; everything
 * else (monetization, profile, journey, detail tabs) folds into collapsed
 * reference panels so the agent can act first and refer second.
 *
 * Identity + live metrics reuse the shared DashboardHero (real Cube data). The
 * care timeline + recommended-action rail are an illustrative sample (see
 * cs-member360-mock) — treatment outcomes aren't persisted yet. The real open-case
 * count from the ledger anchors the sample. The Segments 360 layout is untouched.
 */

import { ReactElement, useMemo, useState } from 'react';
import type { Query } from '@cubejs-client/core';
import { useAuthUser } from '../../../../auth/auth-context';
import { DashboardHero } from '../../../Segments/member360/sections/dashboard-hero';
import type { sectionsForGame } from '../../../Segments/member360/member360-sections';
import { useVipCaseHistory } from '../use-care-cases';
import { CsCareHistoryTimeline } from './cs-care-history-timeline';
import { CsRecommendedActionRail } from './cs-recommended-action-rail';
import { CsReferencePanels } from './cs-reference-panels';
import {
  SAMPLE_CARE_TIMELINE,
  SAMPLE_RECOMMENDED_ACTION,
  type CareTimelineEvent,
} from './cs-member360-mock';

type Sections = NonNullable<ReturnType<typeof sectionsForGame>>;

interface CsMember360ViewProps {
  gameId: string;
  uid: string;
  sections: Sections;
  row: Record<string, unknown> | null;
  profileLoading: boolean;
  cachedSource: React.ComponentProps<typeof CsReferencePanels>['cachedSource'];
  /** The shared back-link element from the parent view. */
  back: ReactElement;
}

export function CsMember360View({
  gameId,
  uid,
  sections,
  row,
  profileLoading,
  cachedSource,
  back,
}: CsMember360ViewProps): ReactElement {
  const user = useAuthUser();
  const canWrite = user?.role === 'editor' || user?.role === 'admin';

  // Real open-case count for this VIP from the ledger — anchors the sample timeline.
  const { cases } = useVipCaseHistory(gameId, uid);
  const openCount = useMemo(
    () => cases.filter((c) => c.status !== 'resolved' && c.status !== 'dismissed').length,
    [cases],
  );

  // "Mark treated" is a visual stub: optimistically prepend a sample treatment to
  // the timeline client-side (clearly labelled) — it does not persist this round.
  const [treated, setTreated] = useState(false);
  const events: CareTimelineEvent[] = useMemo(() => {
    if (!treated) return SAMPLE_CARE_TIMELINE;
    const a = SAMPLE_RECOMMENDED_ACTION;
    const justTreated: CareTimelineEvent = {
      id: 'evt-just-treated',
      kind: 'treated',
      playbookId: a.playbookId,
      playbookName: a.playbookName,
      priority: a.priority,
      daysAgo: 0,
      channel: a.channels[0],
      agent: user?.username ?? user?.email ?? 'you',
      outcome: 'pending',
      note: 'Treatment logged from the recommended-action rail (sample — not persisted).',
    };
    return [justTreated, ...SAMPLE_CARE_TIMELINE];
  }, [treated, user]);

  return (
    <>
      {back}
      <div
        style={{
          fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6,
          color: 'var(--text-tertiary)', marginBottom: 8,
        }}
      >
        {gameId} · care
      </div>

      <DashboardHero uid={uid} sections={sections} row={row} />

      {profileLoading && row == null && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 16px' }}>Loading…</div>
      )}

      {/* Central action: care timeline + recommended-action rail */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 340px',
          gap: 20,
          alignItems: 'start',
          margin: '16px 0 20px',
        }}
      >
        <CsCareHistoryTimeline events={events} openCount={openCount} />
        <CsRecommendedActionRail
          action={SAMPLE_RECOMMENDED_ACTION}
          treated={treated}
          onMarkTreated={() => setTreated(true)}
          canWrite={canWrite}
        />
      </div>

      {/* Everything else: collapsed reference panels */}
      <CsReferencePanels gameId={gameId} uid={uid} sections={sections} row={row} cachedSource={cachedSource} />
    </>
  );
}
