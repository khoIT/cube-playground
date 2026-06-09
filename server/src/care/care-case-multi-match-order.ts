/**
 * Server-side multi-playbook promotion for the By-Playbook lens.
 *
 * When more than one playbook is selected, a VIP whose open cases span several of
 * them carries multiple concurrent problems and is the highest-value triage
 * target. The client also reorders, but only the rows it already has — so this
 * must run over the FULL result set *before* pagination, or the overlap VIPs
 * never make it onto the first page (they're scattered by `opened_at DESC`).
 *
 * Ordering: more matched playbooks first; then a VIP's rows cluster together and
 * rank by the VIP's most-urgent priority, then recency; stable uid tiebreak.
 */

export interface OrderableCase {
  uid: string;
  playbook_id: string;
  opened_at?: string | null;
  created_at?: string | null;
}

function openedMs(c: OrderableCase): number {
  const t = new Date(c.opened_at ?? c.created_at ?? 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Reorders cases so multi-match VIPs lead. `rankOf` maps a case to a priority
 * rank (lower = more urgent) — pass a registry-backed lookup so the tiebreak
 * matches the rest of the console. Pure; returns a new array.
 */
export function promoteMultiMatchCases<T extends OrderableCase>(
  cases: T[],
  rankOf: (c: T) => number,
): T[] {
  const overlap = new Map<string, Set<string>>();
  const uidRank = new Map<string, number>();
  const uidLatest = new Map<string, number>();
  for (const c of cases) {
    if (!overlap.has(c.uid)) overlap.set(c.uid, new Set());
    overlap.get(c.uid)!.add(c.playbook_id);
    uidRank.set(c.uid, Math.min(uidRank.get(c.uid) ?? 99, rankOf(c)));
    uidLatest.set(c.uid, Math.max(uidLatest.get(c.uid) ?? 0, openedMs(c)));
  }
  const ov = (uid: string) => overlap.get(uid)?.size ?? 0;

  return [...cases].sort((a, b) => {
    const d = ov(b.uid) - ov(a.uid); // more matched playbooks first
    if (d) return d;
    if (a.uid !== b.uid) {            // different VIPs → rank the groups
      const pr = uidRank.get(a.uid)! - uidRank.get(b.uid)!;
      if (pr) return pr;
      const rc = uidLatest.get(b.uid)! - uidLatest.get(a.uid)!;
      if (rc) return rc;
      return a.uid < b.uid ? -1 : 1; // stable tiebreak
    }
    const pr = rankOf(a) - rankOf(b); // same VIP → priority then recency
    if (pr) return pr;
    return openedMs(b) - openedMs(a);
  });
}
