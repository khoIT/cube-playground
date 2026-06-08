/**
 * use-care-cases — dual-lens hook over /api/care/cases endpoints.
 *
 * Lens A (list): GET /api/care/cases?game=&playbook=&status=
 *   Used by the By-Playbook view of the Case Ledger.
 *
 * Lens B (by-vip): GET /api/care/cases/by-vip?game=
 *   Used by the Action Queue / By-VIP view.
 *
 * Lens C (vip-detail): GET /api/care/cases/vip/:uid?game=
 *   Used by the Member-360 Care tab.
 *
 * PATCH /api/care/cases/:id — treatment logging.
 *   Returned from patchCase() helper — callers invalidate / re-fetch manually.
 *
 * All fetch calls mirror the AbortController pattern from use-care-playbooks.ts.
 */

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../api/api-client';

// ── Canonical case shape (server contract) ────────────────────────────────────

/**
 * VIP profile snapshot persisted by the sweep and returned inline on case /
 * by-vip responses — so the queue enriches from SQLite, not a live Cube query.
 * Null/absent when the VIP hasn't been swept yet.
 */
export interface CareVipProfileDto {
  name: string | null;
  ltvVnd: number | null;
  tier: string | null;
  churnPlayDays: number | null;
  churnPayDays: number | null;
}

export interface CareCase {
  id: string;
  game_id: string;
  playbook_id: string;
  /** Playbook display name — present on /vip/:uid responses. */
  playbook_name?: string;
  /** Numeric priority from playbook registry — present on /vip/:uid. */
  playbook_priority?: number;
  uid: string;
  source: 'membership' | 'trigger';
  opened_at: string;
  /** JSON string of deciding stats at match time. Parse on display. */
  stats_snapshot_json: string | null;
  status: 'new' | 'in_review' | 'treated' | 'resolved' | 'dismissed';
  /** 1 = the triggering condition has since lapsed. */
  condition_lapsed: 0 | 1;
  assignee: string | null;
  treated_at: string | null;
  channel_used: string | null;
  action_taken: string | null;
  notes: string | null;
  kpi_target: string | null;
  kpi_eval_at: string | null;
  outcome: string | null;
  // legacy compat aliases from server
  created_at?: string;
  updated_at?: string;
  /** Persisted VIP profile snapshot (name / LTV / tier / churn); null until swept. */
  profile?: CareVipProfileDto | null;
}

// ── By-VIP aggregated shape ───────────────────────────────────────────────────

export interface VipPlaybookRef {
  id: string;
  name: string;
  priority: number;
}

export interface VipCaseRow {
  uid: string;
  caseCount: number;
  playbookIds: string[];
  cases: CareCase[];
  lastTreatedAt: string | null;
  topPriority: number;
  playbooks: VipPlaybookRef[];
  /** Persisted VIP profile snapshot (name / LTV / tier / churn); null until swept. */
  profile?: CareVipProfileDto | null;
}

// ── Patch payload ─────────────────────────────────────────────────────────────

export interface CareCasePatch {
  status?: CareCase['status'];
  assignee?: string;
  channel_used?: string;
  action_taken?: string;
  notes?: string;
  outcome?: string;
  kpi_eval_at?: string;
  condition_lapsed?: 0 | 1;
}

// ── Load states ───────────────────────────────────────────────────────────────

export type CasesLoadStatus = 'idle' | 'loading' | 'success' | 'error';

export interface CareCasesState {
  status: CasesLoadStatus;
  cases: CareCase[];
  error: string | null;
}

export interface VipQueueState {
  status: CasesLoadStatus;
  vips: VipCaseRow[];
  error: string | null;
}

export interface VipDetailState {
  status: CasesLoadStatus;
  cases: CareCase[];
  error: string | null;
}

// ── Hook: by-playbook list ────────────────────────────────────────────────────

/**
 * Fetches cases for a single playbook (or all playbooks when playbookId is
 * omitted). Filters are passed as query params; status is optional.
 */
export function useCareCases(
  gameId: string,
  opts: { playbookId?: string; status?: string } = {},
): CareCasesState {
  const [state, setState] = useState<CareCasesState>({
    status: 'idle',
    cases: [],
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const { playbookId, status: filterStatus } = opts;

  useEffect(() => {
    if (!gameId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    async function load() {
      try {
        const query: Record<string, string> = { game: gameId };
        if (playbookId) query.playbook = playbookId;
        if (filterStatus) query.status = filterStatus;

        const data = await apiFetch<{ cases: CareCase[] }>('/api/care/cases', {
          query,
          signal: controller.signal,
        });

        setState({ status: 'success', cases: data.cases ?? [], error: null });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState((prev) => ({ ...prev, status: 'error', error: message }));
      }
    }

    load();
    return () => controller.abort();
  }, [gameId, playbookId, filterStatus]);

  return state;
}

// ── Hook: by-vip action queue ─────────────────────────────────────────────────

/**
 * Fetches the deduplicated, priority-ranked VIP queue from /api/care/cases/by-vip.
 * A VIP appearing in N playbooks produces exactly ONE row with N case chips.
 */
export function useVipQueue(gameId: string): VipQueueState {
  const [state, setState] = useState<VipQueueState>({
    status: 'idle',
    vips: [],
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!gameId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    async function load() {
      try {
        const data = await apiFetch<{ vips: VipCaseRow[] }>('/api/care/cases/by-vip', {
          query: { game: gameId },
          signal: controller.signal,
        });
        setState({ status: 'success', vips: data.vips ?? [], error: null });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState((prev) => ({ ...prev, status: 'error', error: message }));
      }
    }

    load();
    return () => controller.abort();
  }, [gameId]);

  return state;
}

// ── Hook: single-VIP cross-playbook history ───────────────────────────────────

/**
 * Fetches all cases across playbooks for a single UID.
 * Used by the Member-360 Care tab.
 */
export function useVipCaseHistory(gameId: string | null, uid: string): VipDetailState {
  const [state, setState] = useState<VipDetailState>({
    status: 'idle',
    cases: [],
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!gameId || !uid) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    async function load() {
      try {
        const data = await apiFetch<{ uid: string; cases: CareCase[] }>(
          `/api/care/cases/vip/${encodeURIComponent(uid)}`,
          { query: { game: gameId as string }, signal: controller.signal },
        );
        setState({ status: 'success', cases: data.cases ?? [], error: null });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState((prev) => ({ ...prev, status: 'error', error: message }));
      }
    }

    load();
    return () => controller.abort();
  }, [gameId, uid]);

  return state;
}

// ── PATCH helper ──────────────────────────────────────────────────────────────

/**
 * Patches a case. Returns the updated CareCase or throws on network/API error.
 * Callers should await this and then trigger a re-fetch of their hook.
 */
export async function patchCareCase(id: string, patch: CareCasePatch): Promise<CareCase> {
  return apiFetch<CareCase>(`/api/care/cases/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  });
}

// ── On-demand sweep ─────────────────────────────────────────────────────────

export interface SweepPlaybookSummary {
  playbookId: string;
  cohortSize: number;
  opened: number;
  lapsed: number;
  alreadyOpen: number;
  skipped?: 'trigger-eval-pending' | 'unavailable' | 'disabled' | 'no-predicate';
}

export interface SweepResult {
  game: string;
  opened: number;
  lapsed: number;
  /** VIP profile snapshots refreshed for the queue (persisted to SQLite). */
  profilesRefreshed?: number;
  summaries: SweepPlaybookSummary[];
}

/**
 * Triggers a cohort sweep for a game against the live Cube (editor/admin).
 * Populates the ledger; throws on a Cube/API error so callers can surface it.
 */
export async function runCareSweep(game: string): Promise<SweepResult> {
  return apiFetch<SweepResult>(`/api/care/cases/sweep?game=${encodeURIComponent(game)}`, {
    method: 'POST',
  });
}
