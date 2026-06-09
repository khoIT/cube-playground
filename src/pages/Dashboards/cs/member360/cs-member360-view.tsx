/**
 * CS care-first Member-360 — the layout used when the 360 is reached from the CS
 * care queue (segment-less). The care timeline is the central action; everything
 * else (monetization, profile, journey, detail tabs) folds into collapsed
 * reference panels so the agent can act first and refer second.
 *
 * Data flow:
 *   useVipCaseHistory(game, uid) → cases[]
 *     ├ casesToTimeline(cases)       → timeline events (real)
 *     ├ pickTopOpenCase(cases)       → topOpen case (null when all closed)
 *     └ caseToRecommendedAction(...) → action rail content
 *
 * When the VIP has 0 cases (status=success AND empty array), the view falls
 * back to the illustrative sample so the page is never blank in a demo.
 * While loading, a skeleton message is shown instead of sample data.
 *
 * "Mark treated" submits via patchCareCase then calls refetch so the local
 * case list re-syncs with the ledger immediately.
 */

import { ReactElement, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, HeartHandshake } from 'lucide-react';
import { useAuthUser } from '../../../../auth/auth-context';
import { DashboardHero } from '../../../Segments/member360/sections/dashboard-hero';
import type { sectionsForGame } from '../../../Segments/member360/member360-sections';
import { useVipCaseHistory, patchCareCase } from '../use-care-cases';
import { claimCase, dismissCase, closeCaseWithOutcome } from '../cs-case-actions';
import type { DismissReasonCode, CloseOutcome } from '../cs-case-actions';
import { CsCareHistoryTimeline } from './cs-care-history-timeline';
import { CsRecommendedActionRail } from './cs-recommended-action-rail';
import type { TreatmentPayload } from './cs-recommended-action-rail';
import { CsOwnerChip } from './cs-owner-chip';
import { CsReferencePanels } from './cs-reference-panels';
import {
  SAMPLE_CARE_TIMELINE,
  SAMPLE_RECOMMENDED_ACTION,
} from './cs-member360-mock';
import {
  casesToTimeline,
  pickTopOpenCase,
  caseToRecommendedAction,
  defaultGuidance,
  normalisePriority,
} from './cs-member360-derive';

type Sections = NonNullable<ReturnType<typeof sectionsForGame>>;

interface CsMember360ViewProps {
  gameId: string;
  uid: string;
  sections: Sections;
  row: Record<string, unknown> | null;
  profileLoading: boolean;
  cachedSource: React.ComponentProps<typeof CsReferencePanels>['cachedSource'];
}

export function CsMember360View({
  gameId,
  uid,
  sections,
  row,
  profileLoading,
  cachedSource,
}: CsMember360ViewProps): ReactElement {
  const user = useAuthUser();
  const canWrite = user?.role === 'editor' || user?.role === 'admin';
  // Stable identity string used as the assignee value in PATCH calls.
  const me = user ? (user.username ?? user.email ?? null) : null;

  const { status, cases, refetch } = useVipCaseHistory(gameId, uid);

  // Determine whether we have real data to show.
  // Fall back to sample ONLY when the load has completed and returned 0 cases.
  const hasRealCases = status === 'success' && cases.length > 0;
  const isLoading = status === 'idle' || status === 'loading';

  const openCases = useMemo(
    () => cases.filter((c) => c.status !== 'resolved' && c.status !== 'dismissed'),
    [cases],
  );
  const openCount = status === 'success' ? openCases.length : null;

  // Derive timeline events from real cases; fall back to sample when 0 cases.
  const timelineEvents = useMemo(
    () => (hasRealCases ? casesToTimeline(cases) : SAMPLE_CARE_TIMELINE),
    [hasRealCases, cases],
  );

  // Pick highest-priority open case for the action rail.
  const topOpen = useMemo(() => (hasRealCases ? pickTopOpenCase(cases) : null), [hasRealCases, cases]);

  // When there are no open cases but a treated case exists, surface the treated
  // case on the rail so the CS agent can close it with a KPI outcome.
  const topTreated = useMemo(
    () => (hasRealCases && !topOpen
      ? cases.find((c) => c.status === 'treated') ?? null
      : null),
    [hasRealCases, topOpen, cases],
  );

  // The "active" case driving the rail — open case takes precedence; treated case
  // is the fallback so the close-loop is reachable.
  const activeCase = topOpen ?? topTreated;

  // Derive the recommended action from the active case, or fall back to sample.
  const recommendedAction = useMemo(() => {
    if (!activeCase) return SAMPLE_RECOMMENDED_ACTION;
    const priority = normalisePriority(activeCase.playbook_priority);
    const guidance = defaultGuidance(activeCase.playbook_name ?? activeCase.playbook_id, priority);
    return caseToRecommendedAction(activeCase, guidance);
  }, [activeCase]);

  // PATCH the top open case then immediately re-sync the case list.
  async function handleSubmitTreatment(payload: TreatmentPayload) {
    if (!topOpen) throw new Error('No open case to treat');
    await patchCareCase(topOpen.id, {
      status: 'treated',
      channel_used: payload.channel_used,
      action_taken: payload.action_taken,
      notes: payload.notes,
    });
    refetch();
  }

  // Claim the top open case, assigning it to the current agent.
  async function handleClaim() {
    if (!topOpen || !me) throw new Error('Cannot claim: no open case or identity');
    await claimCase(topOpen.id, me);
    refetch();
  }

  // Dismiss the top open case with a structured reason code; removes it from queue.
  async function handleDismiss(reasonCode: DismissReasonCode) {
    if (!topOpen) throw new Error('No open case to dismiss');
    await dismissCase(topOpen.id, reasonCode);
    refetch();
  }

  // Close a treated case with a human-assigned KPI outcome; stamps resolved + outcome.
  async function handleCloseWithOutcome(outcome: CloseOutcome) {
    const target = topTreated ?? topOpen;
    if (!target) throw new Error('No treated case to close');
    await closeCaseWithOutcome(target.id, outcome);
    refetch();
  }

  return (
    <>
      {/* Page header — icon + 20px title on the left, game badge on the right. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <Link
            to={`/dashboards/cs/queue?game=${encodeURIComponent(gameId)}`}
            style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)', marginRight: 4 }}
            title="Back to action queue"
          >
            <ChevronLeft size={16} />
          </Link>
          <HeartHandshake size={24} color="var(--brand)" />
          <h1
            style={{
              margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em',
              color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
            }}
          >
            Member-360 Care
          </h1>
        </div>

        {/* Game badge */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600,
            color: 'var(--text-secondary)', background: 'var(--bg-muted)',
            padding: '5px 11px', borderRadius: 'var(--radius-full)',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
          {gameId}
        </div>
      </div>

      {/* Sub-heading */}
      <p style={{ margin: '2px 0 20px', fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
        Care-first member profile — treat from the recommended-action rail, then refer to the folded reference panels.
      </p>

      <DashboardHero uid={uid} sections={sections} row={row} />

      {profileLoading && row == null && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 16px' }}>Loading…</div>
      )}

      {/* Loading skeleton — shown while the first case fetch is in flight. */}
      {isLoading && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 16px' }}>
          Loading care history…
        </div>
      )}

      {/* Owner chip — shows who claimed the top open case, if anyone. */}
      {!isLoading && topOpen?.assignee && (
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>Assigned to</span>
          <CsOwnerChip assignee={topOpen.assignee} me={me} />
          {/* Allow the current owner or any editor/admin to unclaim. */}
          {canWrite && (
            <button
              type="button"
              onClick={() => claimCase(topOpen.id, me ?? 'me').then(refetch).catch(() => {})}
              title="Re-assign to yourself"
              style={{
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-sans)',
                padding: '2px 8px', borderRadius: 'var(--radius-md)',
                background: 'transparent', border: '1px solid var(--border-card)',
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              Claim
            </button>
          )}
        </div>
      )}

      {/* Claim button when no owner yet. */}
      {!isLoading && topOpen && !topOpen.assignee && canWrite && me && (
        <div style={{ marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => claimCase(topOpen.id, me).then(refetch).catch(() => {})}
            title="Assign this case to yourself"
            style={{
              fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
              padding: '5px 12px', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-muted)', border: '1px solid var(--border-card)',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            Claim case
          </button>
        </div>
      )}

      {/* Central action: care timeline + recommended-action rail */}
      {!isLoading && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 340px',
            gap: 20,
            alignItems: 'start',
            margin: '16px 0 20px',
          }}
        >
          <CsCareHistoryTimeline
            events={timelineEvents}
            openCount={openCount}
            live={hasRealCases}
          />
          <CsRecommendedActionRail
            action={recommendedAction}
            caseStatus={activeCase?.status}
            canWrite={canWrite && activeCase != null}
            onSubmitTreatment={handleSubmitTreatment}
            onDismiss={topOpen != null ? handleDismiss : undefined}
            onCloseWithOutcome={topTreated != null ? handleCloseWithOutcome : undefined}
          />
        </div>
      )}

      {/* Everything else: collapsed reference panels */}
      <CsReferencePanels gameId={gameId} uid={uid} sections={sections} row={row} cachedSource={cachedSource} />
    </>
  );
}
