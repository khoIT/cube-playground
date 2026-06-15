/**
 * Drive panel — the live agent investigation posture. The manager states a goal
 * in plain language and presses Investigate; the agent streams its reasoning and
 * calls provenanced tools, lighting up the experiment-anatomy stage rail as it
 * goes. Numbers from tool results are validated; spoken numbers are exploratory.
 * Steering = a follow-up turn on the same session.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import { Lightbulb, Send, Square, ArrowRight, Target, CheckCircle2, Pencil, Plus } from 'lucide-react';
import { STAGES } from './advisor-stage-config';
import { Btn, CARD_STYLE, Eyebrow, PulsingRow } from './advisor-primitives';
import { NumberBadge } from './number-badge';
import { useDriveSession } from './use-drive-session';
import { AdvisorMarkdown } from './advisor-markdown';
import { fetchDriveArtifact, type DriveArtifact } from './drive-artifact';
import { fetchCohortProposal, type CohortProposal, type AdvisorScope, type AdvisorGoal } from '../../api/advisor';
import { segmentsClient } from '../../api/segments-client';
import type { EditorReturnTo } from '../Segments/editor/editor-route-state';
import type { StageKey } from './advisor-types';

const ERROR_COPY: Record<string, string> = {
  oauth_unavailable:
    'The AI investigator is not configured on this server (no subscription token). Backend smoke test: set CLAUDE_CODE_OAUTH_TOKEN on the API process.',
  timeout: 'The investigation took too long and was stopped. Try a narrower question.',
  budget_exceeded: 'This investigation reached its cost cap. Start a fresh one to continue.',
};

function StageRail({ touched }: { touched: StageKey[] }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 14px' }}>
      {STAGES.map((s) => {
        const lit = touched.includes(s.key);
        return (
          <span
            key={s.key}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 11px',
              borderRadius: 'var(--radius-full)',
              border: `1px solid ${lit ? 'var(--brand)' : 'var(--border-card)'}`,
              background: lit ? 'var(--brand-soft, var(--success-soft))' : 'var(--bg-card)',
              color: lit ? 'var(--brand)' : 'var(--text-muted)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {s.emoji} {s.label}
          </span>
        );
      })}
    </div>
  );
}

export function DrivePanel({
  scope,
  goal,
  goalText,
  seedMessage,
  onSessionComplete,
  onContinue,
  onPickSegment,
  onCohortCreated,
}: {
  scope: AdvisorScope;
  goal: AdvisorGoal;
  goalText: string;
  /** Overrides the seeded message (used when a game-scope drive re-scopes to a segment). */
  seedMessage?: string;
  /** Fired when a turn reaches a terminal state, so the caller can refresh run history. */
  onSessionComplete?: () => void;
  /** Hand the finished investigation's artifact to Decide. */
  onContinue?: (artifact: DriveArtifact) => void;
  /** Game-scope only: ask for a segment to build the experiment for. */
  onPickSegment?: (message: string) => void;
  /** Game-scope only: a cohort proposal was approved → a new segment was created. */
  onCohortCreated?: (segmentId: string, message: string) => void;
}) {
  const { state, run, abort } = useDriveSession(scope, goal);
  const history = useHistory();
  const seed =
    seedMessage?.trim() ||
    goalText.trim() ||
    `Investigate how to ${goal === 'engagement' ? 'grow engagement' : 'grow gross revenue'} here and propose one strong experiment.`;
  const [message, setMessage] = useState(seed);
  const streaming = state.status === 'streaming';
  const hasRun = state.status !== 'idle';

  // Continuation state (segment scope): fetch the agent-scaffolded draft.
  const [continuing, setContinuing] = useState(false);
  const [continueErr, setContinueErr] = useState<string | null>(null);
  const done = state.status === 'done' && !state.error;
  const isSegment = scope.kind === 'segment';
  const scaffolded = state.activity.some((a) => a.tool === 'scaffold_draft' && a.validated);

  // Game-scope hand-off: the agent may have PROPOSED a cohort (propose_cohort) the
  // manager can turn into a Segment in one click. Fetch it once the run settles;
  // null → fall back to picking an existing segment (the hybrid bridge).
  const [proposal, setProposal] = useState<CohortProposal | null>(null);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  useEffect(() => {
    if (!done || isSegment || !state.sessionId) return;
    let alive = true;
    fetchCohortProposal(state.sessionId).then((p) => alive && setProposal(p));
    return () => {
      alive = false;
    };
  }, [done, isSegment, state.sessionId]);

  // Round-trip into the canonical Segments editor so the manager can review /
  // edit the proposed cohort (or build a fresh one) before the experiment is
  // assembled. On save the editor sends them back here scoped to the new
  // segment — the same `driveBoot` path "Approve & create" takes, just with a
  // human-reviewed cohort. Reuses the proven builder (cube picker, live count,
  // predicate validation) instead of an inline mini-editor.
  function buildReturnTo(): EditorReturnTo {
    const base = message.trim();
    const driveSeed = `${base ? `${base}\n\n` : ''}Now scoped to this segment — build the experiment and scaffold the editable draft for it.`;
    return { pathTemplate: '/advisor/:id', state: { driveBoot: true, driveSeed } };
  }

  function reviewProposalInEditor() {
    if (!proposal) return;
    history.push('/segments/new', {
      advisorPrefill: {
        name: proposal.name,
        cube: proposal.primaryCube,
        predicateTree: proposal.predicateTree,
      },
      returnTo: buildReturnTo(),
    });
  }

  function buildNewCohort() {
    history.push('/segments/new', { advisorPrefill: null, returnTo: buildReturnTo() });
  }

  async function handleCreateFromProposal() {
    if (!proposal) return;
    setCreating(true);
    setCreateErr(null);
    try {
      const segment = await segmentsClient.create({
        name: proposal.name,
        type: 'predicate',
        cube: proposal.primaryCube,
        predicate_tree: proposal.predicateTree,
        game_id: proposal.gameId,
      });
      onCohortCreated?.(segment.id, message);
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleContinue() {
    if (scope.kind !== 'segment') return;
    setContinuing(true);
    setContinueErr(null);
    try {
      const artifact = await fetchDriveArtifact({
        segmentId: scope.segmentId,
        gameId: scope.gameId,
        goal,
        sessionId: state.sessionId,
      });
      if (!artifact) {
        setContinueErr('No draft was scaffolded yet — ask the advisor to draft the experiment first.');
        return;
      }
      onContinue?.(artifact);
    } catch (e) {
      setContinueErr(e instanceof Error ? e.message : String(e));
    } finally {
      setContinuing(false);
    }
  }

  // Auto-run once when re-scoped here from a segment pick / cohort create
  // (seedMessage set). Picking a segment used to dead-end on a blank panel; now
  // the scoped investigation kicks off immediately — the click WAS the intent to
  // proceed. Guarded so a re-render never re-fires it.
  const autoRan = useRef(false);
  useEffect(() => {
    if (seedMessage && !autoRan.current && state.status === 'idle') {
      autoRan.current = true;
      run(message.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedMessage, state.status]);

  // Notify the parent once per turn when the stream settles (done/error) — the
  // just-finished run is now persisted and should appear in the history list.
  const prevStatus = useRef(state.status);
  useEffect(() => {
    if (
      prevStatus.current === 'streaming' &&
      (state.status === 'done' || state.status === 'error')
    ) {
      onSessionComplete?.();
    }
    prevStatus.current = state.status;
  }, [state.status, onSessionComplete]);

  return (
    <div style={{ ...CARD_STYLE, padding: 20, marginTop: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Lightbulb size={17} color="var(--brand)" aria-hidden />
        <Eyebrow>Drive · live AI investigation</Eyebrow>
        {state.costUsd != null && (
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
            ~${state.costUsd.toFixed(3)} · {streaming ? 'working…' : (state.stopReason ?? 'done')}
          </span>
        )}
      </header>

      <StageRail touched={state.stagesTouched} />

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        disabled={streaming}
        placeholder="Tell the advisor what to look into…"
        style={{
          width: '100%',
          resize: 'vertical',
          fontFamily: 'var(--font-sans)',
          fontSize: 13.5,
          color: 'var(--text-primary)',
          background: 'var(--bg-input, var(--bg-card))',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 12px',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Btn kind="primary" disabled={streaming || message.trim().length === 0} onClick={() => run(message.trim())}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Send size={14} /> {hasRun ? 'Steer' : 'Investigate'}
          </span>
        </Btn>
        {streaming && (
          <Btn onClick={abort}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Square size={13} /> Stop
            </span>
          </Btn>
        )}
      </div>

      {state.error && (
        <div
          style={{
            marginTop: 14,
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--destructive-soft)',
            color: 'var(--destructive-ink)',
            fontSize: 12.5,
          }}
        >
          {ERROR_COPY[state.error.code] ?? state.error.message}
        </div>
      )}

      {state.narration && (
        <div style={{ marginTop: 14, fontSize: 13.5, color: 'var(--text-primary)' }}>
          <AdvisorMarkdown>{state.narration}</AdvisorMarkdown>
          {streaming && <span style={{ color: 'var(--brand)' }}>▋</span>}
        </div>
      )}

      {state.activity.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Eyebrow style={{ marginBottom: 6 }}>Evidence gathered</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {state.activity.map((a, i) => (
              <div key={`${a.tool}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                {a.state === 'running' ? (
                  <PulsingRow>
                    <span style={{ fontWeight: 600 }}>{a.tool}</span> running…
                  </PulsingRow>
                ) : (
                  <>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.tool}</span>
                    {a.validated ? (
                      <NumberBadge variant="validated" />
                    ) : (
                      <span style={{ color: 'var(--destructive-ink)', fontSize: 11.5 }}>failed / denied</span>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completion hand-off — converge into Decide (both postures share it). */}
      {done && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-card)' }}>
          {isSegment && scaffolded && (
            <>
              <Eyebrow>Your investigation is ready</Eyebrow>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '6px 0 10px', lineHeight: 1.5 }}>
                Review the experiment the advisor assembled — Opportunity → Target → Cause → Lever → Proof — then set it up.
              </p>
              <Btn kind="primary" disabled={continuing} onClick={handleContinue}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {continuing ? 'Loading draft…' : 'Continue to Decide'} <ArrowRight size={14} />
                </span>
              </Btn>
            </>
          )}
          {isSegment && !scaffolded && (
            <>
              <Eyebrow>Turn this into an experiment</Eyebrow>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '6px 0 10px', lineHeight: 1.5 }}>
                The advisor hasn't scaffolded a draft yet. Ask it to build one from what it found.
              </p>
              <Btn onClick={() => run('Scaffold the experiment draft now using scaffold_draft, with the candidate you recommended.')}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Send size={14} /> Draft an experiment from this
                </span>
              </Btn>
            </>
          )}
          {!isSegment && proposal && (
            <>
              <Eyebrow>Create the cohort, then build the experiment</Eyebrow>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '6px 0 4px', lineHeight: 1.5 }}>
                The advisor proposed a target cohort. Create it as a segment and the experiment is
                assembled on it automatically.
              </p>
              <div
                style={{
                  margin: '8px 0 10px',
                  padding: '10px 12px',
                  background: 'var(--bg-muted)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{proposal.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.45 }}>
                  {proposal.rationale}
                  {proposal.addressableN != null && (
                    <> · ≈ {proposal.addressableN.toLocaleString()} players</>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn kind="primary" disabled={creating} onClick={handleCreateFromProposal}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Target size={14} /> {creating ? 'Creating segment…' : `Approve & create “${proposal.name}”`}
                  </span>
                </Btn>
                <Btn disabled={creating} onClick={reviewProposalInEditor}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Pencil size={13} /> Review / edit cohort first
                  </span>
                </Btn>
                <Btn disabled={creating} onClick={() => onPickSegment?.(message)}>
                  Pick an existing segment instead
                </Btn>
                <Btn disabled={creating} onClick={buildNewCohort}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Plus size={13} /> Build a new cohort
                  </span>
                </Btn>
              </div>
              {createErr && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--destructive-ink)' }}>
                  Couldn't create the segment: {createErr}
                </div>
              )}
            </>
          )}
          {!isSegment && !proposal && (
            <>
              <Eyebrow>Build the experiment</Eyebrow>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '6px 0 10px', lineHeight: 1.5 }}>
                An experiment runs on a segment cohort. Pick the target segment to assemble it.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn kind="primary" onClick={() => onPickSegment?.(message)}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Target size={14} /> Pick a segment to build the experiment
                  </span>
                </Btn>
                <Btn onClick={buildNewCohort}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Plus size={13} /> Build a new cohort
                  </span>
                </Btn>
              </div>
            </>
          )}
          {continueErr && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--destructive-ink)' }}>{continueErr}</div>
          )}
          <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <CheckCircle2 size={13} color="var(--positive, var(--success-ink))" /> Saved to your investigations below.
          </div>
        </div>
      )}

      <p style={{ marginTop: 16, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Numbers from a tool show <NumberBadge variant="validated" /> and are safe to act on. The advisor never launches
        anything — its output is an editable draft you review and set up. Hand-off stays disabled until the
        draft's numbers are validated.
      </p>
    </div>
  );
}
