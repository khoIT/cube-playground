/**
 * Case sweep driver — the "worker integration" for the ledger.
 *
 * For each cohort-queryable (membership) playbook of a game, it materializes the
 * current VIP cohort and feeds it to the engine (open entered, flag exited).
 * The cohort fetch is injectable so the membership logic is unit-testable
 * without Cube; the default fetcher reuses the predicate→Cube path.
 *
 * Trigger playbooks (ratio rules — spend/session drop) need per-member baseline
 * comparison and are evaluated by a later extension; the sweep logs them as
 * pending rather than guessing a cohort.
 */

import { v4 as uuidv4 } from 'uuid';
import { loadWithCtx, type WorkspaceCtx } from '../services/cube-client.js';
import { mapWithConcurrency } from '../services/bounded-concurrency.js';
import { treeToCubeFilters } from '../services/translator.js';
import { anniversaryMilestoneForDate } from '../services/expand-relative-date-range.js';
import { resolveIdentityField } from '../services/resolve-identity-field.js';
import { resolveDataAnchor, findWindowedDateMember } from './resolve-data-anchor.js';
import { mergePlaybooks, type ResolvedPlaybook } from './playbook-merge.js';
import { getGameMembers } from './availability.js';
import { applyMembershipResult, type SweepResult } from './care-case-engine.js';
import type { CalibrationResult } from './threshold-rule.js';
import type { GroupNode, PredicateNode } from '../types/predicate-tree.js';

/** Floor for "is a VIP" — only paying members enter the program (₫1M cumulative). */
const VIP_LTV_FLOOR = 1_000_000;
/** The VIP-base gate member — exported so the preview-count route reports the
 *  same `gated` flag the sweep actually applies (one source of truth). */
export const VIP_LTV_MEMBER = 'mf_users.ltv_total_vnd';
const COHORT_CAP = 50_000;
/**
 * Max cohort queries in flight during one sweep. Each playbook's open/lapse work
 * is independent (scoped to its own playbookId) and the only awaited step is the
 * slow Cube cohort query, so overlapping a bounded number of them collapses the
 * wall-time of N cold-warehouse round-trips from ~sum toward ~max. Bounded so a
 * 21-playbook game doesn't fire 21 simultaneous Trino queries and stampede the
 * warehouse (or a still-warming pre-aggregation).
 */
export const SWEEP_CONCURRENCY = 6;

/** AND the playbook predicate with the VIP-base gate so non-VIPs never enter. */
function gateWithVipBase(predicate: PredicateNode, members: Set<string>): PredicateNode {
  if (!members.has(VIP_LTV_MEMBER)) return predicate; // base member absent — don't fabricate a gate
  const base: PredicateNode = {
    kind: 'leaf',
    id: uuidv4(),
    member: VIP_LTV_MEMBER,
    type: 'number',
    op: 'gte',
    values: [VIP_LTV_FLOOR],
  };
  const group: GroupNode = { kind: 'group', id: uuidv4(), op: 'AND', children: [base, predicate] };
  return group;
}

/** Per-uid match attribution for an anniversary playbook. */
export interface CohortMatch {
  /** Anniversary milestone the member hit, in days (one of ANNIVERSARY_OFFSET_DAYS). */
  milestoneDays: number;
  /** The member's first-seen date that matched (raw warehouse value). */
  date: string;
}

export interface CohortFetchResult {
  /** Current cohort uids for the playbook. */
  uids: string[];
  /**
   * Per-uid milestone attribution — populated only for the anniversary playbook,
   * where the cohort spans 5 milestone days and CS needs to know which one each
   * member hit (a 1-year gift ≠ a 30-day gift). Absent for every other playbook.
   */
  matchByUid?: Map<string, CohortMatch>;
}

export interface SweepDeps {
  /** Returns the current cohort uids (+ optional per-uid attribution) for a resolved playbook. */
  fetchCohortUids: (pb: ResolvedPlaybook) => Promise<CohortFetchResult>;
}

export interface PlaybookSweepSummary extends SweepResult {
  playbookId: string;
  cohortSize: number;
  skipped?: 'trigger-eval-pending' | 'unavailable' | 'disabled' | 'no-predicate' | 'query-failed';
  /**
   * Matched cohort uids — populated for non-skipped playbooks only, so the sweep
   * route can snapshot per-uid membership. Server-internal; not sent to the FE.
   */
  uids?: string[];
}

/**
 * Live progress sink — lets a caller observe per-playbook sweep state as it runs
 * (which playbooks are in scope, when each starts, and its settled counts) so a
 * reconnecting UI can render a live breakdown instead of just elapsed time. The
 * sweep proceeds identically whether or not a sink is attached.
 */
export interface SweepProgressSink {
  /** Called once with the full in-scope playbook list before any cohort fetch. */
  init(playbooks: { playbookId: string; label: string }[]): void;
  /** Called when a worker picks up a playbook (concurrency means several may be running at once). */
  start(playbookId: string): void;
  /** Called when a playbook settles (swept or skipped), carrying its summary. */
  settle(summary: PlaybookSweepSummary): void;
}

/**
 * Sweep one game's playbooks. `members` + `deps` are injected for testability.
 * `onlyPlaybookId` scopes the sweep to a single playbook (per-segment manual
 * sweep from the builder); omitted/undefined sweeps the whole game as before.
 * `progress` (optional) receives live per-playbook events for a reconnecting UI.
 */
export async function runCaseSweep(
  gameId: string,
  workspace: string,
  members: Set<string>,
  deps: SweepDeps,
  calibration: Record<string, CalibrationResult> = {},
  onlyPlaybookId?: string,
  progress?: SweepProgressSink,
): Promise<PlaybookSweepSummary[]> {
  const merged = mergePlaybooks(gameId, members, undefined, { calibration });
  const playbooks = onlyPlaybookId ? merged.filter((p) => p.id === onlyPlaybookId) : merged;

  progress?.init(playbooks.map((pb) => ({ playbookId: pb.id, label: pb.name })));

  // The cohort query is the slow, awaited step and each playbook is independent
  // (scoped to its own playbookId, and better-sqlite3 writes run synchronously
  // once a worker starts applying), so run a bounded number concurrently. The
  // pool preserves order, keeping summaries and the recorded run deterministic.
  return mapWithConcurrency(playbooks, SWEEP_CONCURRENCY, async (pb) => {
    progress?.start(pb.id);
    const summary = await sweepOnePlaybook(pb, gameId, workspace, deps, onlyPlaybookId);
    progress?.settle(summary);
    return summary;
  });
}

/** Sweep a single playbook: gate on availability, fetch its cohort, apply the
 *  membership diff. Returns a summary (with a `skipped` reason when not swept).
 *  A failure here is isolated to this playbook — it never aborts the sweep. */
async function sweepOnePlaybook(
  pb: ResolvedPlaybook,
  gameId: string,
  workspace: string,
  deps: SweepDeps,
  onlyPlaybookId: string | undefined,
): Promise<PlaybookSweepSummary> {
  const skip = (reason: NonNullable<PlaybookSweepSummary['skipped']>): PlaybookSweepSummary => ({
    playbookId: pb.id, cohortSize: 0, opened: 0, lapsed: 0, alreadyOpen: 0, skipped: reason,
  });

  if (!pb.enabled) return skip('disabled');
  if (pb.availability === 'unavailable') return skip('unavailable');
  if (pb.evalMode === 'trigger') return skip('trigger-eval-pending');
  if (!pb.predicate) return skip('no-predicate');
  // Fail-closed: a membership predicate that compiles to NO Cube filter — e.g.
  // an unsupported relative-date window the translator dropped to avoid a 400 —
  // would otherwise match the entire VIP base (the VIP-base gate is the only
  // surviving filter), opening a case for every VIP. That's never the intent, so
  // skip rather than fabricate a full-cohort match.
  if (treeToCubeFilters(pb.predicate).length === 0) {
    console.warn(`[care] sweep skipping playbook ${pb.id} (${gameId}): predicate compiled to an empty filter (unsupported/malformed condition).`);
    return skip('no-predicate');
  }

  // A single playbook's cohort query failing (e.g. its cube is absent from this
  // game's live model despite passing the availability probe) must not abort the
  // whole sweep — skip it, surface the reason, keep the rest going.
  let cohort: CohortFetchResult;
  try {
    cohort = await deps.fetchCohortUids(pb);
  } catch (err) {
    console.warn(`[care] sweep cohort query failed for playbook ${pb.id} (${gameId}):`, err instanceof Error ? err.message : err);
    return skip('query-failed');
  }
  const uids = cohort.uids;
  const result = applyMembershipResult(uids, {
    gameId,
    workspace,
    playbookId: pb.id,
    kpiTarget: pb.watchedMetric.kpiTarget ?? null,
    // Anniversary cases also record which milestone (30/90/180/365/730) the
    // member hit + their first-seen date, so the action is milestone-aware.
    snapshotFor: (uid) => {
      const match = cohort.matchByUid?.get(uid);
      return {
        matched_at: new Date().toISOString(),
        threshold: pb.condition,
        ...(match ? { milestone_days: match.milestoneDays, anniversary_date: match.date } : {}),
      };
    },
    // A single-playbook (manual) sweep is an ad-hoc retune: drop cases that no
    // longer match so the segment count is honest. The full scheduled sweep
    // keeps the flag-and-keep behaviour.
    pruneLapsed: onlyPlaybookId !== undefined,
  });
  return { playbookId: pb.id, cohortSize: uids.length, uids, ...result };
}

/**
 * Default cohort fetcher — predicate→Cube via the same path segments use.
 * VIP-base-gated, identity-deduped, single bounded page (VIP cohorts are small).
 */
export function makeCubeCohortFetcher(
  ctx: WorkspaceCtx,
  gameId: string,
  workspace: string,
  members: Set<string>,
): SweepDeps['fetchCohortUids'] {
  return async (pb: ResolvedPlaybook): Promise<CohortFetchResult> => {
    const cube = pb.dataRequirements[0]?.split('.')[0];
    if (!cube || !pb.predicate) return { uids: [] };
    const identity = await resolveIdentityField(cube, gameId, { workspaceId: workspace });
    if (!identity) return { uids: [] };

    const gated = gateWithVipBase(pb.predicate, members);
    // Anchor relative-date windows on the freshest day the windowed member has
    // (warehouse data lags real time), so `last N days` binds to where the data
    // ends rather than an empty future range. No window → no probe, no anchor.
    const dateMember = findWindowedDateMember(pb.predicate);
    const anchorDate = dateMember
      ? await resolveDataAnchor(ctx, dateMember, gameId, `${workspace}:${gameId}`)
      : undefined;
    const filters = treeToCubeFilters(gated, { anchorDate });

    // Anniversary's cohort spans 5 milestone days at once. Select the windowed
    // date member alongside identity so each member's first-seen date is in the
    // row, and we can attribute which milestone they hit for the case snapshot.
    const isAnniversary =
      pb.condition.kind === 'event' && pb.condition.window === 'anniversary' && dateMember != null;
    const dimensions = isAnniversary ? [identity, dateMember!] : [identity];

    const res = (await loadWithCtx(
      { dimensions, filters, limit: COHORT_CAP },
      ctx,
    )) as { data?: Record<string, unknown>[] };
    const rows = res.data ?? [];
    const seen = new Set<string>();
    const matchByUid = isAnniversary ? new Map<string, CohortMatch>() : undefined;
    for (const r of rows) {
      const v = r[identity];
      if (v == null) continue;
      const uid = String(v);
      seen.add(uid);
      // First row wins per uid (mf_users is one row/user); skip uids whose date
      // matches no milestone within tolerance rather than fabricating one.
      if (matchByUid && !matchByUid.has(uid) && anchorDate) {
        const raw = r[dateMember!];
        if (raw != null) {
          const milestone = anniversaryMilestoneForDate(new Date(String(raw)), anchorDate);
          if (milestone != null) matchByUid.set(uid, { milestoneDays: milestone, date: String(raw) });
        }
      }
    }
    return { uids: [...seen], matchByUid };
  };
}
