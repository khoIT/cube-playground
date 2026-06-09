/**
 * use-care-playbooks — fetches the resolved playbook registry + case aggregates
 * for the active game. Drives the CS Monitor portfolio strip and playbook grid.
 *
 * CRITICAL: unavailable playbooks are flagged in the returned data but NO cohort
 * query is fired for them — this hook only calls /api/care/playbooks (registry)
 * and /api/care/cases (aggregate counts). The grid component is responsible for
 * skipping per-row queries on unavailable rows (which this hook does not issue
 * at all — cohort counts come from the server registry, not a client Cube call).
 *
 * Re-fetches automatically when gameId changes (game switcher re-grades the grid).
 */

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../api/api-client';
import type { PredicateNode } from '../../../types/segment-api';

// ── Types ───────────────────────────────────────────────────────────────────

export type PlaybookAvailability = 'available' | 'partial' | 'unavailable';
export type PlaybookPriority = 'cao' | 'tb' | 'thap';
export type PlaybookGroup = 'payment' | 'ingame' | 'churn' | 'event';
export type PlaybookNhom = 1 | 2 | 3 | 4;
export type PlaybookEvalMode = 'membership' | 'trigger';
export type PlaybookSource = 'seed' | 'override' | 'custom';

export interface WatchedMetric {
  member: string;
  label: string;
  kpiTarget?: string;
}

export interface PlaybookAction {
  text: string;
  channels: string[];
  slaMinutes?: number;
}

export interface ResolvedPlaybook {
  id: string;
  nhom: PlaybookNhom;
  group: PlaybookGroup;
  name: string;
  priority: PlaybookPriority;
  dataRequirements: string[];
  condition: unknown;
  watchedMetric: WatchedMetric;
  action: PlaybookAction;
  source: PlaybookSource;
  /**
   * DB row id of the backing override/custom row (uuid). Present for
   * source 'override' and 'custom'; absent for pure 'seed'. This — NOT `id`,
   * which equals the seed base-id for overrides — is what PATCH/DELETE target.
   */
  overrideId?: string;
  /** Optional AND/OR filter layered on the threshold condition (for the Builder to re-edit). */
  supplementalPredicate?: PredicateNode;
  enabled: boolean;
  availability: PlaybookAvailability;
  evalMode: PlaybookEvalMode;
  predicate: unknown;
  calibrated: boolean;
}

export interface RegistryCounts {
  total: number;
  available: number;
  partial: number;
  unavailable: number;
}

export interface PlaybooksResponse {
  game: string;
  meta_members: number;
  counts: RegistryCounts;
  playbooks: ResolvedPlaybook[];
}

export interface CareCase {
  id: string;
  game_id: string;
  playbook_id: string;
  uid: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CasesResponse {
  cases: CareCase[];
}

/** Count-only aggregate from /api/care/cases/aggregate — drives the monitor
 *  without shipping the full (potentially tens-of-thousands) case list. */
export interface CaseAggregateResponse {
  byPlaybook: { playbookId: string; open: number; treated: number; slaBreached: number }[];
  openCases: number;
  treatedCases: number;
  vipsTriggered: number;
}

// Aggregated case metrics per playbook, derived client-side from the flat list.
export interface PlaybookCaseAgg {
  playbookId: string;
  open: number;
  treated: number;
  slaBreached: number;
}

export interface PortfolioStats {
  /** Playbooks currently active (available + partial). */
  livePlaybooks: number;
  totalPlaybooks: number;
  /** VIPs with ≥1 open case. */
  vipsTriggered: number;
  openCases: number;
  /** Treated / (open + treated) — 0–1, or null when no data yet (dismissed excluded). */
  attainmentRate: number | null;
  slaBreaches: number;
}

export type CareLoadStatus = 'idle' | 'loading' | 'success' | 'error';

export interface CarePlaybooksState {
  status: CareLoadStatus;
  playbooks: ResolvedPlaybook[];
  counts: RegistryCounts;
  casesByPlaybook: Map<string, PlaybookCaseAgg>;
  portfolio: PortfolioStats;
  error: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Index the count-only aggregate by playbook id for the grid's per-row stats.
 *  A playbook with zero cases has NO entry (the server GROUPs by playbook_id) —
 *  the grid must treat an absent key as 0 open / 0 treated / 0 breached. */
function casesByPlaybookFrom(agg: CaseAggregateResponse): Map<string, PlaybookCaseAgg> {
  const map = new Map<string, PlaybookCaseAgg>();
  for (const p of agg.byPlaybook) {
    map.set(p.playbookId, {
      playbookId: p.playbookId,
      open: p.open,
      treated: p.treated,
      slaBreached: p.slaBreached,
    });
  }
  return map;
}

/** Derive top-level portfolio stats from registry counts + the case aggregate. */
function buildPortfolio(counts: RegistryCounts, agg: CaseAggregateResponse): PortfolioStats {
  const livePlaybooks = counts.available + counts.partial;
  const total = agg.openCases + agg.treatedCases;
  const attainmentRate = total > 0 ? agg.treatedCases / total : null;
  const slaBreaches = agg.byPlaybook.reduce((n, p) => n + p.slaBreached, 0);
  return {
    livePlaybooks,
    totalPlaybooks: counts.total,
    vipsTriggered: agg.vipsTriggered,
    openCases: agg.openCases,
    attainmentRate,
    slaBreaches,
  };
}

const EMPTY_AGGREGATE: CaseAggregateResponse = {
  byPlaybook: [],
  openCases: 0,
  treatedCases: 0,
  vipsTriggered: 0,
};

const EMPTY_COUNTS: RegistryCounts = { total: 0, available: 0, partial: 0, unavailable: 0 };
const EMPTY_PORTFOLIO: PortfolioStats = {
  livePlaybooks: 0,
  totalPlaybooks: 0,
  vipsTriggered: 0,
  openCases: 0,
  attainmentRate: null,
  slaBreaches: 0,
};

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetches playbook registry + case list for `gameId`.
 * Returns derived aggregates for the portfolio strip and the grid.
 * On gameId change, cancels the previous request and re-fetches.
 *
 * NOTE: This hook deliberately fires NO Cube cohort queries.
 * Population counts (if needed) would be a separate hook — not in scope for Phase 2.
 */
export function useCarePlaybooks(gameId: string): CarePlaybooksState {
  const [state, setState] = useState<CarePlaybooksState>({
    status: 'idle',
    playbooks: [],
    counts: EMPTY_COUNTS,
    casesByPlaybook: new Map(),
    portfolio: EMPTY_PORTFOLIO,
    error: null,
  });

  // Abort controller ref so game switches cancel in-flight fetches.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!gameId) return;

    // Cancel any in-flight request from the previous game.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    async function load() {
      try {
        // Fetch registry + count-only case aggregate in parallel. The aggregate
        // is a few hundred bytes (server-side GROUP BY) instead of the full case
        // list, so the monitor stays fast on games with tens of thousands of
        // cases. A missing aggregate (no sweep yet / endpoint error) renders 0.
        const [registry, agg] = await Promise.all([
          apiFetch<PlaybooksResponse>('/api/care/playbooks', {
            query: { game: gameId },
            signal: controller.signal,
          }),
          apiFetch<CaseAggregateResponse>('/api/care/cases/aggregate', {
            query: { game: gameId },
            signal: controller.signal,
          }).catch(() => EMPTY_AGGREGATE),
        ]);

        const casesByPlaybook = casesByPlaybookFrom(agg);
        const portfolio = buildPortfolio(registry.counts, agg);

        setState({
          status: 'success',
          playbooks: registry.playbooks,
          counts: registry.counts,
          casesByPlaybook,
          portfolio,
          error: null,
        });
      } catch (err: unknown) {
        // AbortError = intentional cancel — don't set error state.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState((prev) => ({ ...prev, status: 'error', error: message }));
      }
    }

    load();

    return () => {
      controller.abort();
    };
  }, [gameId]);

  return state;
}
