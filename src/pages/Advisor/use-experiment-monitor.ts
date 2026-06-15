/**
 * Experiment lifecycle behind the live-monitoring board: create a draft
 * experiment from the in-scope segment, freeze the split on the "freeze groups"
 * action, then fetch the real treatment-vs-hold-out scorecard.
 *
 * Degrades to ILLUSTRATIVE (the hardcoded demo bars) when there's no real
 * segment to experiment on, or when `?illustrative=1` forces it, or when a live
 * call fails — so the board always renders. `live` is the single flag the board
 * reads to decide real-vs-demo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createExperiment,
  assignExperiment,
  fetchScorecard,
  listExperiments,
  getExperiment,
  type ScorecardResponse,
  type AssignmentResult,
  type ExperimentSummary,
  type PrimaryMetric,
} from '../../api/experiments';
import type { ExperimentDraft } from '../../api/advisor';

interface MonitorOpts {
  gameId: string;
  segmentId: string | null;
  draft: ExperimentDraft | null;
  /** Treatment share (whole percent) when the draft doesn't specify arms. */
  splitPct: number;
  primaryMetric: PrimaryMetric;
  experimentName: string;
  /** Force the demo bars (URL `?illustrative=1`). */
  forceIllustrative: boolean;
  /** Open a specific existing experiment (from the experiments list) instead of
   *  creating a new draft. Adopts it read-to-monitor. */
  viewExperimentId?: string | null;
}

export interface MonitorState {
  /** True when this board is backed by a real, persisted experiment. */
  live: boolean;
  /** True when an EXISTING experiment was adopted (reuse-on-revisit or explicit
   *  open) rather than a fresh draft created — the board jumps to monitoring. */
  adopted: boolean;
  /** The adopted experiment record (name, hypothesis, cohort) — populated only
   *  when an existing experiment is opened, so the board can show its thesis +
   *  segment instead of the (empty) investigation-derived context. */
  experiment: ExperimentSummary | null;
  experimentId: string | null;
  assignment: AssignmentResult | null;
  scorecard: ScorecardResponse | null;
  busy: boolean;
  error: string | null;
}

export function useExperimentMonitor(opts: MonitorOpts) {
  const {
    gameId,
    segmentId,
    draft,
    splitPct,
    primaryMetric,
    experimentName,
    forceIllustrative,
    viewExperimentId,
  } = opts;
  const canRunReal = !forceIllustrative && (!!segmentId || !!viewExperimentId);

  const [state, setState] = useState<MonitorState>({
    live: false,
    adopted: false,
    experiment: null,
    experimentId: null,
    assignment: null,
    scorecard: null,
    busy: false,
    error: null,
  });
  // Create/adopt the experiment at most once per mount.
  const created = useRef(false);

  useEffect(() => {
    if (!canRunReal || created.current) return;
    created.current = true;
    let alive = true;
    setState((s) => ({ ...s, busy: true }));

    // Adopt an existing experiment: surface it live, and if it's already frozen
    // synthesize the assignment so the scorecard auto-loads and bars render.
    const adopt = (exp: ExperimentSummary) => {
      if (!alive) return;
      // Any assigned experiment (running/completed/archived) has frozen arms and
      // a loadable scorecard; only a draft has none. `assignedAt` is the gate.
      const frozen = !!exp.assignedAt;
      setState((s) => ({
        ...s,
        live: true,
        adopted: true,
        experiment: exp,
        experimentId: exp.id,
        assignment: frozen
          ? {
              experimentId: exp.id,
              treatment: exp.arms.treatment,
              control: exp.arms.control,
              total: exp.arms.treatment + exp.arms.control,
              capped: false,
              assignedAt: exp.assignedAt as string,
            }
          : null,
        busy: false,
      }));
    };

    void (async () => {
      try {
        // 1) Explicit open of a known experiment (from the list page).
        if (viewExperimentId) {
          adopt(await getExperiment(viewExperimentId));
          return;
        }
        // 2) Reuse-on-revisit: adopt this segment's latest running experiment.
        if (segmentId) {
          const existing = await listExperiments(gameId, segmentId);
          const running = existing.find((e) => e.status === 'running' && e.assignedAt);
          if (running) {
            adopt(running);
            return;
          }
        }
        // 3) No existing experiment → create a fresh draft (original behavior).
        const exp = await createExperiment({
          game: gameId,
          name: experimentName.slice(0, 120) || 'Experiment',
          segmentId: segmentId as string,
          hypothesis: draft?.hypothesis ?? '',
          splitPct,
          primaryMetric,
          windowDays: draft?.windowDays ?? 14,
        });
        if (!alive) return;
        setState((s) => ({ ...s, live: true, experimentId: exp.id, busy: false }));
      } catch (e) {
        if (!alive) return;
        // No real experiment → board falls back to illustrative bars.
        setState((s) => ({ ...s, live: false, busy: false, error: errMsg(e) }));
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRunReal, gameId, segmentId, viewExperimentId]);

  /** Freeze the split (draft → running). Returns true on success. */
  const freeze = useCallback(async (): Promise<boolean> => {
    if (!state.experimentId) return true; // illustrative: nothing to freeze
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const assignment = await assignExperiment(state.experimentId);
      setState((s) => ({ ...s, assignment, busy: false }));
      return true;
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: errMsg(e) }));
      return false;
    }
  }, [state.experimentId]);

  /** Load (or refresh) the real scorecard. No-op when not assigned yet. */
  const loadScorecard = useCallback(async (): Promise<void> => {
    if (!state.experimentId || !state.assignment) return;
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const scorecard = await fetchScorecard(state.experimentId);
      setState((s) => ({ ...s, scorecard, busy: false }));
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: errMsg(e) }));
    }
  }, [state.experimentId, state.assignment]);

  return { state, freeze, loadScorecard };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'request failed';
}
