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

import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Playbook display name — present on /api/care/cases + /vip/:uid responses. */
  playbook_name?: string;
  /** Priority from playbook registry ('cao' | 'tb' | 'thap', or legacy numeric). */
  playbook_priority?: number | string;
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

/** Client default page size; server clamps and echoes the effective value back. */
export const DEFAULT_PAGE_SIZE = 50;

/** Paged response envelopes from the list / by-vip endpoints. */
interface PagedCases {
  cases: CareCase[];
  total?: number;
  page?: number;
  pageSize?: number;
}
interface PagedVips {
  vips: VipCaseRow[];
  total?: number;
  page?: number;
  pageSize?: number;
}

export type CasesLoadStatus = 'idle' | 'loading' | 'success' | 'error';

export interface CareCasesState {
  status: CasesLoadStatus;
  cases: CareCase[];
  error: string | null;
  total: number;
  pageSize: number;
  /** Manually re-run the fetch — call after a PATCH to refresh assignee/status. */
  refetch: () => void;
}

export interface VipQueueState {
  status: CasesLoadStatus;
  vips: VipCaseRow[];
  error: string | null;
  total: number;
  pageSize: number;
  /** Manually re-run the fetch — call after a PATCH to get updated assignee/status. */
  refetch: () => void;
}

export interface VipDetailState {
  status: CasesLoadStatus;
  cases: CareCase[];
  error: string | null;
  /** Manually re-run the fetch — call after a PATCH to get the updated case list. */
  refetch: () => void;
}

// ── Hook: by-playbook list ────────────────────────────────────────────────────

/**
 * Fetches cases for a single playbook (or all playbooks when playbookId is
 * omitted). Filters are passed as query params; status is optional.
 */
export function useCareCases(
  gameId: string,
  opts: {
    /** Single playbook (deep-link / back-compat). */
    playbookId?: string;
    /** Multi-select playbooks → comma param. Takes precedence over playbookId. */
    playbookIds?: string[];
    /** Single status (back-compat). */
    status?: string;
    /** Multi-select statuses → comma param. Takes precedence over status. */
    statuses?: string[];
    page?: number;
    pageSize?: number;
  } = {},
): CareCasesState {
  const [state, setState] = useState<Omit<CareCasesState, 'refetch'>>({
    status: 'idle',
    cases: [],
    error: null,
    total: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const abortRef = useRef<AbortController | null>(null);
  const { playbookId, playbookIds, status: filterStatus, statuses, page = 1, pageSize = DEFAULT_PAGE_SIZE } = opts;
  // Stable comma keys so the effect re-runs on selection change (arrays are new
  // refs each render; the joined string is the real dependency).
  const playbookParam = (playbookIds && playbookIds.length ? playbookIds.join(',') : playbookId) ?? '';
  const statusParam = (statuses && statuses.length ? statuses.join(',') : filterStatus) ?? '';
  // Increment to trigger a manual re-fetch after a PATCH without changing filters.
  const [fetchTick, setFetchTick] = useState(0);

  useEffect(() => {
    if (!gameId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    async function load() {
      try {
        const query: Record<string, string> = {
          game: gameId,
          page: String(page),
          pageSize: String(pageSize),
        };
        if (playbookParam) query.playbook = playbookParam;
        if (statusParam) query.status = statusParam;

        const data = await apiFetch<PagedCases>('/api/care/cases', {
          query,
          signal: controller.signal,
        });

        setState({
          status: 'success',
          cases: data.cases ?? [],
          error: null,
          total: data.total ?? (data.cases?.length ?? 0),
          pageSize: data.pageSize ?? pageSize,
        });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState((prev) => ({ ...prev, status: 'error', error: message }));
      }
    }

    load();
    return () => controller.abort();
  // fetchTick is intentionally included so refetch() below re-runs this effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, playbookParam, statusParam, page, pageSize, fetchTick]);

  /** Call after a successful PATCH to synchronise the local case list. */
  const refetch = useCallback(() => setFetchTick((n) => n + 1), []);

  return { ...state, refetch };
}

// ── Hook: by-vip action queue ─────────────────────────────────────────────────

/**
 * Fetches the deduplicated, priority-ranked VIP queue from /api/care/cases/by-vip.
 * A VIP appearing in N playbooks produces exactly ONE row with N case chips.
 */
export function useVipQueue(
  gameId: string,
  opts: { page?: number; pageSize?: number; q?: string } = {},
): VipQueueState {
  const [state, setState] = useState<Omit<VipQueueState, 'refetch'>>({
    status: 'idle',
    vips: [],
    error: null,
    total: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const abortRef = useRef<AbortController | null>(null);
  const { page = 1, pageSize = DEFAULT_PAGE_SIZE, q } = opts;
  const query = (q ?? '').trim();
  // Increment to trigger a manual re-fetch after a PATCH (e.g. claim) without
  // changing the external opts, so the caller doesn't need to manage extra state.
  const [fetchTick, setFetchTick] = useState(0);

  useEffect(() => {
    if (!gameId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    async function load() {
      try {
        const params: Record<string, string> = { game: gameId, page: String(page), pageSize: String(pageSize) };
        if (query) params.q = query;
        const data = await apiFetch<PagedVips>('/api/care/cases/by-vip', {
          query: params,
          signal: controller.signal,
        });
        setState({
          status: 'success',
          vips: data.vips ?? [],
          error: null,
          total: data.total ?? (data.vips?.length ?? 0),
          pageSize: data.pageSize ?? pageSize,
        });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState((prev) => ({ ...prev, status: 'error', error: message }));
      }
    }

    load();
    return () => controller.abort();
  // fetchTick is intentionally included so refetch() below re-runs this effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, page, pageSize, query, fetchTick]);

  /** Call after a successful PATCH to synchronise the queue with the ledger. */
  const refetch = useCallback(() => setFetchTick((n) => n + 1), []);

  return { ...state, refetch };
}

// ── Hook: single-VIP cross-playbook history ───────────────────────────────────

/**
 * Fetches all cases across playbooks for a single UID.
 * Used by the Member-360 Care tab.
 */
export function useVipCaseHistory(gameId: string | null, uid: string): VipDetailState {
  const [state, setState] = useState<Omit<VipDetailState, 'refetch'>>({
    status: 'idle',
    cases: [],
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  // Increment this counter to trigger a manual re-fetch without changing gameId/uid.
  const [fetchTick, setFetchTick] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    if (!gameId || !uid) return;
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const data = await apiFetch<{ uid: string; cases: CareCase[] }>(
        `/api/care/cases/vip/${encodeURIComponent(uid)}`,
        { query: { game: gameId }, signal },
      );
      setState({ status: 'success', cases: data.cases ?? [], error: null });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Unknown error';
      setState((prev) => ({ ...prev, status: 'error', error: message }));
    }
  }, [gameId, uid]);

  useEffect(() => {
    if (!gameId || !uid) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    load(controller.signal);
    return () => controller.abort();
  // fetchTick is intentionally included so the manual refetch() below re-runs this effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, uid, load, fetchTick]);

  /** Call after a successful PATCH to synchronise the local case list with the ledger. */
  const refetch = useCallback(() => setFetchTick((n) => n + 1), []);

  return { ...state, refetch };
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

// ── Activity aggregate (24h rolling strip) ────────────────────────────────────

export interface ActivityEvent {
  uid: string;
  kind: 'treated' | 'resolved' | 'dismissed';
  playbookId: string;
  at: string;
}

export interface CareActivityState {
  status: CasesLoadStatus;
  treated24h: number;
  dismissed24h: number;
  resolved24h: number;
  recent: ActivityEvent[];
  error: string | null;
  /** Re-fetch manually (e.g. after a patch to see the updated counts). */
  refetch: () => void;
}

/** Heartbeat cadence for the activity strip — slow poll, not real-time. */
const ACTIVITY_POLL_MS = 30_000;

/**
 * Polls GET /api/care/activity for the rolling 24h treated / dismissed /
 * resolved counts and a short list of recent events. Self-heals on transient
 * errors; call refetch() after a case patch for an immediate update.
 */
export function useCareActivity(gameId: string): CareActivityState {
  const [state, setState] = useState<Omit<CareActivityState, 'refetch'>>({
    status: 'idle',
    treated24h: 0,
    dismissed24h: 0,
    resolved24h: 0,
    recent: [],
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const [fetchTick, setFetchTick] = useState(0);

  useEffect(() => {
    if (!gameId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((prev) => ({ ...prev, status: 'loading', error: null }));
      try {
        const data = await apiFetch<{
          treated24h: number;
          dismissed24h: number;
          resolved24h: number;
          recent: ActivityEvent[];
        }>('/api/care/activity', {
          query: { game: gameId },
          signal: controller.signal,
        });

        if (cancelled) return;
        setState({
          status: 'success',
          treated24h: data.treated24h ?? 0,
          dismissed24h: data.dismissed24h ?? 0,
          resolved24h: data.resolved24h ?? 0,
          recent: data.recent ?? [],
          error: null,
        });
      } catch (err: unknown) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState((prev) => ({ ...prev, status: 'error', error: message }));
      }
      // Schedule next heartbeat even on error so the strip self-heals.
      if (!cancelled) {
        timer = setTimeout(load, ACTIVITY_POLL_MS);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      abortRef.current?.abort();
    };
  // fetchTick drives manual refetch; gameId drives re-init on game switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, fetchTick]);

  const refetch = useCallback(() => setFetchTick((n) => n + 1), []);

  return { ...state, refetch };
}

// ── Full-queue export fetch (un-paginated, for CSV download) ──────────────────

/**
 * Fetches the complete un-paginated VIP queue for CSV export.
 * Omitting page/pageSize causes the server to return the full set
 * (pagination is opt-in on the by-vip endpoint).
 */
export async function fetchFullVipQueue(gameId: string): Promise<VipCaseRow[]> {
  const data = await apiFetch<{ vips: VipCaseRow[] }>('/api/care/cases/by-vip', {
    query: { game: gameId },
  });
  return data.vips ?? [];
}

// ── Demo reset ──────────────────────────────────────────────────────────────

export interface ResetResult {
  game: string;
  deleted: number;
  reswept?: { opened: number; lapsed: number; summaries: SweepPlaybookSummary[] };
}

/**
 * Wipes all cases for `game` in the current workspace. Editor/admin only —
 * the server enforces the write gate; the caller must show a confirm dialog
 * before invoking this. `resweep: true` triggers a full cohort sweep after
 * the wipe so the demo can be restarted in one request.
 */
export async function resetCareCases(
  game: string,
  opts: { resweep?: boolean } = {},
): Promise<ResetResult> {
  const url = `/api/care/cases/reset?game=${encodeURIComponent(game)}${opts.resweep ? '&resweep=true' : ''}`;
  return apiFetch<ResetResult>(url, { method: 'POST' });
}

// ── On-demand sweep ─────────────────────────────────────────────────────────

export interface SweepPlaybookSummary {
  playbookId: string;
  cohortSize: number;
  opened: number;
  lapsed: number;
  alreadyOpen: number;
  skipped?: 'trigger-eval-pending' | 'unavailable' | 'disabled' | 'no-predicate' | 'query-failed';
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

// ── Live sweep status (reconnect to an in-flight sweep) ──────────────────────

export interface SweepStatus {
  inFlight: boolean;
  game: string;
  /** Who launched the running sweep — 'manual' (a Run sweep click) or 'cron'. */
  source: 'manual' | 'cron' | null;
  /** ISO start time of the running sweep; null when idle. Anchors elapsed time. */
  startedAt: string | null;
}

export async function fetchSweepStatus(game: string, signal?: AbortSignal): Promise<SweepStatus> {
  return apiFetch<SweepStatus>(`/api/care/cases/sweep/status?game=${encodeURIComponent(game)}`, { signal });
}

const SWEEP_POLL_ACTIVE_MS = 2000; // fast cadence while a sweep is running
const SWEEP_POLL_IDLE_MS = 15000; // slow heartbeat so a sweep started elsewhere still surfaces

/**
 * Polls sweep status so the queue can reconnect to a sweep already running — one
 * started here then navigated away from (the "Sweeping…" button state is
 * component-local and lost on unmount), by the auto-sweep cron, or by another tab.
 * Polls fast while in flight, slow when idle. Calls `onSettled` once on each
 * in-flight → idle transition so the caller can refresh the ledger.
 * Single-instance / in-process on the server side.
 */
export function useSweepStatus(
  game: string,
  onSettled?: () => void,
): { inFlight: boolean; source: 'manual' | 'cron' | null; startedAt: string | null } {
  const [status, setStatus] = useState<{ inFlight: boolean; source: 'manual' | 'cron' | null; startedAt: string | null }>({
    inFlight: false,
    source: null,
    startedAt: null,
  });
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const wasInFlight = useRef(false);

  useEffect(() => {
    if (!game) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;

    const tick = async () => {
      controller = new AbortController();
      try {
        const s = await fetchSweepStatus(game, controller.signal);
        if (cancelled) return;
        setStatus({ inFlight: s.inFlight, source: s.source, startedAt: s.startedAt });
        if (wasInFlight.current && !s.inFlight) onSettledRef.current?.();
        wasInFlight.current = s.inFlight;
        timer = setTimeout(tick, s.inFlight ? SWEEP_POLL_ACTIVE_MS : SWEEP_POLL_IDLE_MS);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        // Transient error — keep the heartbeat alive on the idle cadence.
        timer = setTimeout(tick, SWEEP_POLL_IDLE_MS);
      }
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  return status;
}
