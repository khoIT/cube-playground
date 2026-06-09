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
import { treeToCubeFilters } from '../services/translator.js';
import { resolveIdentityField } from '../services/resolve-identity-field.js';
import { mergePlaybooks, type ResolvedPlaybook } from './playbook-merge.js';
import { getGameMembers } from './availability.js';
import { applyMembershipResult, type SweepResult } from './care-case-engine.js';
import type { CalibrationResult } from './threshold-rule.js';
import type { GroupNode, PredicateNode } from '../types/predicate-tree.js';

/** Floor for "is a VIP" — only paying members enter the program (₫1M cumulative). */
const VIP_LTV_FLOOR = 1_000_000;
const VIP_LTV_MEMBER = 'mf_users.ltv_total_vnd';
const COHORT_CAP = 50_000;

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

export interface SweepDeps {
  /** Returns the current cohort uids for a resolved playbook. */
  fetchCohortUids: (pb: ResolvedPlaybook) => Promise<string[]>;
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

/** Sweep one game's playbooks. `members` + `deps` are injected for testability. */
export async function runCaseSweep(
  gameId: string,
  workspace: string,
  members: Set<string>,
  deps: SweepDeps,
  calibration: Record<string, CalibrationResult> = {},
): Promise<PlaybookSweepSummary[]> {
  const playbooks = mergePlaybooks(gameId, members, undefined, { calibration });
  const summaries: PlaybookSweepSummary[] = [];

  for (const pb of playbooks) {
    if (!pb.enabled) {
      summaries.push({ playbookId: pb.id, cohortSize: 0, opened: 0, lapsed: 0, alreadyOpen: 0, skipped: 'disabled' });
      continue;
    }
    if (pb.availability === 'unavailable') {
      summaries.push({ playbookId: pb.id, cohortSize: 0, opened: 0, lapsed: 0, alreadyOpen: 0, skipped: 'unavailable' });
      continue;
    }
    if (pb.evalMode === 'trigger') {
      summaries.push({ playbookId: pb.id, cohortSize: 0, opened: 0, lapsed: 0, alreadyOpen: 0, skipped: 'trigger-eval-pending' });
      continue;
    }
    if (!pb.predicate) {
      summaries.push({ playbookId: pb.id, cohortSize: 0, opened: 0, lapsed: 0, alreadyOpen: 0, skipped: 'no-predicate' });
      continue;
    }
    // Fail-closed: a membership predicate that compiles to NO Cube filter — e.g.
    // an unsupported relative-date window the translator dropped to avoid a 400 —
    // would otherwise match the entire VIP base (the VIP-base gate is the only
    // surviving filter), opening a case for every VIP. That's never the intent, so
    // skip rather than fabricate a full-cohort match.
    if (treeToCubeFilters(pb.predicate).length === 0) {
      console.warn(`[care] sweep skipping playbook ${pb.id} (${gameId}): predicate compiled to an empty filter (unsupported/malformed condition).`);
      summaries.push({ playbookId: pb.id, cohortSize: 0, opened: 0, lapsed: 0, alreadyOpen: 0, skipped: 'no-predicate' });
      continue;
    }

    // A single playbook's cohort query failing (e.g. its cube is absent from
    // this game's live model despite passing the availability probe) must not
    // abort the whole sweep — skip it, surface the reason, keep the rest going.
    let uids: string[];
    try {
      uids = await deps.fetchCohortUids(pb);
    } catch (err) {
      console.warn(`[care] sweep cohort query failed for playbook ${pb.id} (${gameId}):`, err instanceof Error ? err.message : err);
      summaries.push({ playbookId: pb.id, cohortSize: 0, opened: 0, lapsed: 0, alreadyOpen: 0, skipped: 'query-failed' });
      continue;
    }
    const result = applyMembershipResult(uids, {
      gameId,
      workspace,
      playbookId: pb.id,
      kpiTarget: pb.watchedMetric.kpiTarget ?? null,
      snapshotFor: () => ({ matched_at: new Date().toISOString(), threshold: pb.condition }),
    });
    summaries.push({ playbookId: pb.id, cohortSize: uids.length, uids, ...result });
  }
  return summaries;
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
  return async (pb: ResolvedPlaybook): Promise<string[]> => {
    const cube = pb.dataRequirements[0]?.split('.')[0];
    if (!cube || !pb.predicate) return [];
    const identity = await resolveIdentityField(cube, gameId, { workspaceId: workspace });
    if (!identity) return [];

    const gated = gateWithVipBase(pb.predicate, members);
    const filters = treeToCubeFilters(gated);
    const res = (await loadWithCtx(
      { dimensions: [identity], filters, limit: COHORT_CAP },
      ctx,
    )) as { data?: Record<string, unknown>[] };
    const rows = res.data ?? [];
    const seen = new Set<string>();
    for (const r of rows) {
      const v = r[identity];
      if (v != null) seen.add(String(v));
    }
    return [...seen];
  };
}
