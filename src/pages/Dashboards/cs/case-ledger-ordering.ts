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

export interface MultiMatchOrdering {
  /** Cases sorted with multi-match VIPs promoted (or input order when !multi). */
  ordered: CareCase[];
  /** Per-uid count of distinct playbooks matched on this page (drives the badge). */
  matchCountByUid: Map<string, number>;
}

/**
 * Orders the page's cases. When `multi` is false the input order is preserved
 * (server already ranks a single playbook); the per-uid match counts are still
 * returned so callers can decide whether to show the multi-match badge.
 */
export function orderByMultiMatch(cases: CareCase[], multi: boolean): MultiMatchOrdering {
  const matchByUid = new Map<string, Set<string>>();
  for (const c of cases) {
    if (!matchByUid.has(c.uid)) matchByUid.set(c.uid, new Set());
    matchByUid.get(c.uid)!.add(c.playbook_id);
  }
  const matchCountByUid = new Map<string, number>();
  for (const [uid, set] of matchByUid) matchCountByUid.set(uid, set.size);

  if (!multi) return { ordered: cases, matchCountByUid };

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

  return { ordered, matchCountByUid };
}
