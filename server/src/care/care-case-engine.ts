/**
 * Case engine — turns a playbook's current cohort (membership) or matched-user
 * set (trigger) into ledger writes, idempotently.
 *
 * Pure of I/O beyond the case store: the caller (sweep driver) supplies the
 * already-computed uid set + per-uid stats snapshot, so this module is unit-
 * testable without Cube. Membership playbooks track a cohort, so exits matter
 * (flag condition_lapsed, keep open); trigger playbooks are events with no exit.
 */

import {
  openCase,
  findOpenCase,
  patchCase,
  listCases,
  type CareCase,
  type CaseSource,
} from './care-case-store.js';

export interface MembershipDiff {
  entered: string[];
  exited: string[];
}

/** Set difference of the current cohort vs the previously-open uids. */
export function membershipDiff(prevUids: string[], currUids: string[]): MembershipDiff {
  const prev = new Set(prevUids);
  const curr = new Set(currUids);
  return {
    entered: currUids.filter((u) => !prev.has(u)),
    exited: prevUids.filter((u) => !curr.has(u)),
  };
}

export interface SweepContext {
  gameId: string;
  workspace: string;
  playbookId: string;
  kpiTarget?: string | null;
  /** Per-uid deciding stats captured into the case at open time. */
  snapshotFor?: (uid: string) => unknown;
}

export interface SweepResult {
  opened: number;
  lapsed: number;
  alreadyOpen: number;
}

/** uids of currently-open cases for a playbook — the "previous cohort". */
export function openUidsForPlaybook(gameId: string, playbookId: string): string[] {
  return listCases({ gameId, playbookId })
    .filter((c) => c.status !== 'resolved' && c.status !== 'dismissed')
    .map((c) => c.uid);
}

function openForUids(uids: string[], source: CaseSource, ctx: SweepContext): { opened: number; alreadyOpen: number } {
  let opened = 0;
  let alreadyOpen = 0;
  for (const uid of uids) {
    const { created } = openCase({
      gameId: ctx.gameId,
      workspace: ctx.workspace,
      playbookId: ctx.playbookId,
      uid,
      source,
      statsSnapshot: ctx.snapshotFor?.(uid),
      kpiTarget: ctx.kpiTarget ?? null,
    });
    if (created) opened++;
    else alreadyOpen++;
  }
  return { opened, alreadyOpen };
}

/**
 * Membership sweep: open cases for entered users; flag (keep open) cases for
 * users who left before treatment. Auto-dismiss of lapsed cases is deferred to
 * the governance grace window (Phase 5), so CS still sees who slipped.
 */
export function applyMembershipResult(currentUids: string[], ctx: SweepContext): SweepResult {
  const prevUids = openUidsForPlaybook(ctx.gameId, ctx.playbookId);
  const { entered, exited } = membershipDiff(prevUids, currentUids);

  const { opened, alreadyOpen } = openForUids(entered, 'membership', ctx);

  let lapsed = 0;
  for (const uid of exited) {
    const open = findOpenCase(ctx.gameId, ctx.playbookId, uid);
    // Only flag pre-treatment cases; a treated case that exits is a success, not a lapse.
    if (open && open.condition_lapsed === 0 && open.status !== 'treated') {
      patchCase(open.id, { conditionLapsed: true });
      lapsed++;
    }
  }
  return { opened, lapsed, alreadyOpen };
}

/** Trigger sweep: open a case per matched user. No exit/lapse semantics. */
export function applyTriggerResult(matchedUids: string[], ctx: SweepContext): SweepResult {
  const { opened, alreadyOpen } = openForUids(matchedUids, 'trigger', ctx);
  return { opened, lapsed: 0, alreadyOpen };
}

// ── By-VIP aggregation (action queue) ───────────────────────────────────────

export interface VipCaseGroup {
  uid: string;
  caseCount: number;
  playbookIds: string[];
  cases: CareCase[];
  /** Most recent treated_at across the user's cases (fatigue input, Phase 5). */
  lastTreatedAt: string | null;
}

/**
 * Group open cases by uid so a VIP matching N playbooks appears once.
 * Priority ranking + fatigue are layered by the route/Phase-5 (registry priority
 * isn't known here).
 */
export function groupCasesByVip(cases: CareCase[]): VipCaseGroup[] {
  const byUid = new Map<string, CareCase[]>();
  for (const c of cases) {
    const list = byUid.get(c.uid) ?? [];
    list.push(c);
    byUid.set(c.uid, list);
  }
  const groups: VipCaseGroup[] = [];
  for (const [uid, list] of byUid) {
    const treatedTimes = list.map((c) => c.treated_at).filter((t): t is string => t != null).sort();
    groups.push({
      uid,
      caseCount: list.length,
      playbookIds: [...new Set(list.map((c) => c.playbook_id))],
      cases: list,
      lastTreatedAt: treatedTimes.length ? treatedTimes[treatedTimes.length - 1] : null,
    });
  }
  // Most cases first; ties broken by uid for stable ordering.
  groups.sort((a, b) => b.caseCount - a.caseCount || a.uid.localeCompare(b.uid));
  return groups;
}
