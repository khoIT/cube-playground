/**
 * Answer-quality scorer (Phase 03). Reads an aq-snapshot.json emitted by
 * answer-quality-runner.ts and rolls up the four scoring dimensions into a
 * per-game scorecard plus a worst-cells worklist (where the product silently
 * fails the user).
 *
 *   npx tsx test/eval/answer-quality-scorer.ts test/eval/cfm_vn-aq-snapshot.json
 *   npx tsx test/eval/answer-quality-scorer.ts <snapshot> --json
 *
 * Dimensions:
 *   answered    — turn emitted an artifact (status 'ok'), not refuse/error
 *   resolution  — emitted ref == expectedRef (only over cases WITH a golden ref)
 *   nonEmpty    — an emitted query returned rows
 *   trustGuard  — a trust caveat surfaced (informational; not pass/fail alone)
 */
import { readFileSync } from 'node:fs';

interface AqResult {
  caseId: string; question: string; curationGroup: string;
  expectedRef: string | null; status: string; resolvedRef: string | null;
  nonEmpty: boolean; trustGuardSeen: boolean;
}
interface Snapshot { gameId: string; capturedAt: string; results: AqResult[]; }

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((100 * n) / d).toFixed(0)}%`;
}

function scoreGroup(rows: AqResult[]) {
  const answered = rows.filter((r) => r.status === 'ok').length;
  const golden = rows.filter((r) => r.expectedRef);
  const resolved = golden.filter((r) => r.resolvedRef === r.expectedRef).length;
  const nonEmpty = rows.filter((r) => r.nonEmpty).length;
  return { total: rows.length, answered, goldenN: golden.length, resolved, nonEmpty };
}

function main(): void {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('usage: answer-quality-scorer.ts <snapshot.json> [--json]'); process.exit(1); }

  const snap = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
  const groups = [...new Set(snap.results.map((r) => r.curationGroup))].sort();

  const perGroup = groups.map((g) => ({ group: g, ...scoreGroup(snap.results.filter((r) => r.curationGroup === g)) }));
  const overall = scoreGroup(snap.results);

  // Worst cells: golden cases that resolved to the wrong ref, or cases that
  // didn't answer / returned empty. These are the actionable worklist.
  const worklist = snap.results
    .filter((r) => r.status !== 'ok' || (r.expectedRef && r.resolvedRef !== r.expectedRef) || !r.nonEmpty)
    .map((r) => ({
      caseId: r.caseId, group: r.curationGroup, question: r.question,
      issue: r.status !== 'ok' ? `not-answered (${r.status})`
        : r.expectedRef && r.resolvedRef !== r.expectedRef
          ? `wrong-ref: got ${r.resolvedRef ?? '(none)'} want ${r.expectedRef}`
          : 'empty-range',
    }));

  if (jsonOut) {
    console.log(JSON.stringify({ gameId: snap.gameId, capturedAt: snap.capturedAt, overall, perGroup, worklist }, null, 2));
    return;
  }

  console.log(`\nAnswer-quality scorecard — ${snap.gameId}  (${snap.capturedAt})`);
  console.log('─'.repeat(78));
  console.log('group'.padEnd(28) + 'n'.padStart(5) + 'answered'.padStart(11) + 'resolution'.padStart(13) + 'non-empty'.padStart(12));
  for (const g of perGroup) {
    console.log(g.group.padEnd(28) + String(g.total).padStart(5) +
      pct(g.answered, g.total).padStart(11) +
      `${pct(g.resolved, g.goldenN)} (${g.resolved}/${g.goldenN})`.padStart(13) +
      pct(g.nonEmpty, g.total).padStart(12));
  }
  console.log('─'.repeat(78));
  console.log('OVERALL'.padEnd(28) + String(overall.total).padStart(5) +
    pct(overall.answered, overall.total).padStart(11) +
    `${pct(overall.resolved, overall.goldenN)} (${overall.resolved}/${overall.goldenN})`.padStart(13) +
    pct(overall.nonEmpty, overall.total).padStart(12));
  console.log(`\nWorklist: ${worklist.length} cells need attention. Top 15:`);
  for (const w of worklist.slice(0, 15)) console.log(`  · [${w.group}] ${w.issue} — "${w.question.slice(0, 50)}"`);
}

main();
