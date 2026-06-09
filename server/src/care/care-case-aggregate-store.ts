/**
 * Count-only aggregates over the `care_cases` ledger.
 *
 * The CS Monitor needs per-playbook open/treated/SLA-breach counts and the
 * distinct triggered-VIP count — not the cases themselves. Listing every row to
 * derive those numbers does not scale (a mature game has tens of thousands of
 * cases → a multi-MB payload the client then re-aggregates). These GROUP BY
 * queries compute the same numbers in SQLite and return a few hundred bytes.
 *
 * Lives apart from care-case-store.ts (CRUD) so the read-aggregate path stays a
 * focused, side-effect-free unit.
 */

import { getDb } from '../db/sqlite.js';

export interface PlaybookCaseCounts {
  playbookId: string;
  open: number;
  treated: number;
  slaBreached: number;
}

export interface CaseAggregate {
  byPlaybook: PlaybookCaseCounts[];
  /** Σ open across playbooks (status new|in_review). */
  openCases: number;
  /** Σ treated across playbooks (status treated|resolved) — the attainment numerator. */
  treatedCases: number;
  /** Distinct VIPs with ≥1 open case (a VIP open in N playbooks counts once). */
  vipsTriggered: number;
  /** Resolved cases with outcome = 'kpi_met'. Numerator for kpiMetRate. */
  kpiMet: number;
  /**
   * Resolved cases with outcome ∈ {kpi_met, kpi_missed}. Denominator for kpiMetRate.
   * 'na' and null outcomes are excluded — only definitive human-closed outcomes count.
   */
  kpiClosed: number;
}

/**
 * Aggregate case counts for a game. `slaCutoffByPlaybook` maps each playbook to
 * the ISO timestamp before which an open case is past its SLA — derived by the
 * caller from the registry's per-playbook SLA window, so the breach count uses
 * each playbook's own threshold. A playbook absent from the map contributes 0
 * breaches.
 */
export function aggregateCaseCounts(
  gameId: string,
  slaCutoffByPlaybook: Map<string, string>,
): CaseAggregate {
  const db = getDb();

  // Per-playbook open/treated counts in one grouped scan.
  const countRows = db
    .prepare(
      `SELECT playbook_id,
              SUM(CASE WHEN status IN ('new','in_review') THEN 1 ELSE 0 END) AS open_n,
              SUM(CASE WHEN status IN ('treated','resolved') THEN 1 ELSE 0 END) AS treated_n
         FROM care_cases
        WHERE game_id = ?
        GROUP BY playbook_id`,
    )
    .all(gameId) as Array<{ playbook_id: string; open_n: number; treated_n: number }>;

  // Per-playbook SLA breaches: open cases older than that playbook's cutoff.
  // A VALUES-list CTE keeps this one indexed scan regardless of playbook count.
  const breachByPlaybook = new Map<string, number>();
  if (slaCutoffByPlaybook.size > 0) {
    const entries = [...slaCutoffByPlaybook.entries()];
    const values = entries.map(() => '(?,?)').join(',');
    const params: unknown[] = [];
    for (const [pid, cutoff] of entries) params.push(pid, cutoff);
    const breachRows = db
      .prepare(
        `WITH sla(pid, cutoff) AS (VALUES ${values})
         SELECT c.playbook_id AS playbook_id, COUNT(*) AS breached
           FROM care_cases c
           JOIN sla ON sla.pid = c.playbook_id
          WHERE c.game_id = ?
            AND c.status IN ('new','in_review')
            AND c.opened_at < sla.cutoff
          GROUP BY c.playbook_id`,
      )
      .all(...params, gameId) as Array<{ playbook_id: string; breached: number }>;
    for (const r of breachRows) breachByPlaybook.set(r.playbook_id, r.breached);
  }

  const byPlaybook: PlaybookCaseCounts[] = countRows.map((r) => ({
    playbookId: r.playbook_id,
    open: r.open_n,
    treated: r.treated_n,
    slaBreached: breachByPlaybook.get(r.playbook_id) ?? 0,
  }));

  const openCases = byPlaybook.reduce((n, p) => n + p.open, 0);
  const treatedCases = byPlaybook.reduce((n, p) => n + p.treated, 0);

  const vipsTriggered = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT uid) AS n
           FROM care_cases
          WHERE game_id = ? AND status IN ('new','in_review')`,
      )
      .get(gameId) as { n: number }
  ).n;

  // Outcome counts for kpiMetRate — resolved cases with a definitive human-assigned
  // outcome ('na' and null are excluded from the denominator so in-progress treatments
  // don't dilute the rate before the agent closes the loop).
  const outcomeRow = db
    .prepare(
      `SELECT
         SUM(CASE WHEN outcome = 'kpi_met' THEN 1 ELSE 0 END) AS kpi_met_n,
         SUM(CASE WHEN outcome IN ('kpi_met','kpi_missed') THEN 1 ELSE 0 END) AS kpi_closed_n
         FROM care_cases
        WHERE game_id = ? AND status = 'resolved'`,
    )
    .get(gameId) as { kpi_met_n: number | null; kpi_closed_n: number | null };

  const kpiMet = outcomeRow.kpi_met_n ?? 0;
  const kpiClosed = outcomeRow.kpi_closed_n ?? 0;

  return { byPlaybook, openCases, treatedCases, vipsTriggered, kpiMet, kpiClosed };
}
