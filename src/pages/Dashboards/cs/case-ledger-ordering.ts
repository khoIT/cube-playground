/**
 * Multi-playbook promotion ordering for the By-Playbook lens.
 *
 * When more than one playbook is selected, a VIP whose open cases span several of
 * them carries multiple concurrent problems and is the highest-value triage
 * target — so those rows float to the top. Within equal overlap a VIP's rows
 * cluster together and rank by the VIP's most-urgent priority, then by recency.
 *
 * Pure + page-scoped (operates on the rows already fetched for the current page),
 * so it stays in lock-step with the on-page status counts.
 */

import type { CareCase } from './use-care-cases';

type Prio = 'cao' | 'tb' | 'thap';

const PRIO_RANK: Record<Prio, number> = { cao: 0, tb: 1, thap: 2 };

function prioOf(p: number | string | undefined): Prio {
  const s = String(p ?? 'tb');
  if (s === 'cao' || Number(p) <= 2) return 'cao';
  if (s === 'tb' || Number(p) <= 4) return 'tb';
  return 'thap';
}

const rankOf = (c: CareCase): number => PRIO_RANK[prioOf(c.playbook_priority)];

function openedMs(c: CareCase): number {
  const t = new Date(c.opened_at ?? c.created_at ?? 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** One playbook a VIP matched on the page — drives the column's sibling chips. */
export interface MatchedPlaybook {
  id: string;
  name: string;
  priority: number | string | undefined;
}

export interface MultiMatchOrdering {
  /** Cases sorted with multi-match VIPs promoted (or input order when !multi). */
  ordered: CareCase[];
  /** Per-uid count of distinct playbooks matched on this page (drives the badge). */
  matchCountByUid: Map<string, number>;
  /**
   * Per-uid list of the distinct playbooks matched on this page, priority-first.
   * Lets the Matched-Playbook column show *all* of a multi-match VIP's playbooks
   * (the row's own as primary, the rest as sibling chips) so the promotion that
   * floated the VIP to the top is legible right in the column.
   */
  matchedPlaybooksByUid: Map<string, MatchedPlaybook[]>;
}

/**
 * Orders the page's cases. When `multi` is false the input order is preserved
 * (server already ranks a single playbook); the per-uid match counts are still
 * returned so callers can decide whether to show the multi-match badge.
 */
export function orderByMultiMatch(cases: CareCase[], multi: boolean): MultiMatchOrdering {
  const matchByUid = new Map<string, Map<string, MatchedPlaybook>>();
  for (const c of cases) {
    if (!matchByUid.has(c.uid)) matchByUid.set(c.uid, new Map());
    const pbs = matchByUid.get(c.uid)!;
    if (!pbs.has(c.playbook_id)) {
      pbs.set(c.playbook_id, {
        id: c.playbook_id,
        name: c.playbook_name ?? c.playbook_id,
        priority: c.playbook_priority,
      });
    }
  }
  const matchCountByUid = new Map<string, number>();
  const matchedPlaybooksByUid = new Map<string, MatchedPlaybook[]>();
  for (const [uid, pbs] of matchByUid) {
    matchCountByUid.set(uid, pbs.size);
    // Priority-first so the most-urgent matched playbook leads the chip list.
    matchedPlaybooksByUid.set(
      uid,
      [...pbs.values()].sort((a, b) => PRIO_RANK[prioOf(a.priority)] - PRIO_RANK[prioOf(b.priority)]),
    );
  }

  if (!multi) return { ordered: cases, matchCountByUid, matchedPlaybooksByUid };

  // Per-VIP best priority + latest open → groups stay together and sort by the
  // VIP's most-urgent, most-recent case.
  const uidRank = new Map<string, number>();
  const uidLatest = new Map<string, number>();
  for (const c of cases) {
    uidRank.set(c.uid, Math.min(uidRank.get(c.uid) ?? 99, rankOf(c)));
    uidLatest.set(c.uid, Math.max(uidLatest.get(c.uid) ?? 0, openedMs(c)));
  }
  const overlap = (uid: string) => matchCountByUid.get(uid) ?? 0;

  const ordered = [...cases].sort((a, b) => {
    const ov = overlap(b.uid) - overlap(a.uid); // more matched playbooks first
    if (ov) return ov;
    if (a.uid !== b.uid) {                       // different VIPs → rank the groups
      const pr = uidRank.get(a.uid)! - uidRank.get(b.uid)!;
      if (pr) return pr;
      const rc = uidLatest.get(b.uid)! - uidLatest.get(a.uid)!;
      if (rc) return rc;
      return a.uid < b.uid ? -1 : 1;             // stable tiebreak
    }
    const pr = rankOf(a) - rankOf(b);            // same VIP → priority then recency
    if (pr) return pr;
    return openedMs(b) - openedMs(a);
  });

  return { ordered, matchCountByUid, matchedPlaybooksByUid };
}
