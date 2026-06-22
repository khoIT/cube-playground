/**
 * Answer-quality report writer (Phase 03). Turns an aq-snapshot.json into a
 * human-readable Markdown report: every case documented (went-well / fell-short
 * / missing) plus a consolidated "where to improve next" section.
 *
 *   npx tsx test/eval/answer-quality-report.ts test/eval/cfm_vn-glossary-aq-snapshot.json
 *   npx tsx test/eval/answer-quality-report.ts <snapshot> --out <path.md> [--corpus <bank.json>]
 *
 * Distinct from answer-quality-scorer.ts (terse stdout rollup): this emits the
 * durable document a human reads to decide the next round of fixes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface AqResult {
  caseId: string; question: string; curationGroup: string;
  expectedRef: string | null; status: string; httpStatus?: number;
  resolvedRef: string | null; resolvedCube: string | null;
  nonEmpty: boolean; trustGuardSeen: boolean; errorDetail?: string;
  answerText?: string | null; artifactTitle?: string | null;
  toolCalls?: string[]; latencyMs?: number; costUsd?: number | null;
  outputTokens?: number | null;
}
interface Snapshot { gameId: string; capturedAt: string; workspace?: string; results: AqResult[]; }

type Verdict = 'went-well' | 'wrong-ref' | 'empty' | 'not-answered' | 'unverified';

/** Classify a case into one readable bucket. */
function verdict(r: AqResult): Verdict {
  if (r.status !== 'ok') return 'not-answered';
  if (!r.nonEmpty) return 'empty';
  if (r.expectedRef && r.resolvedRef !== r.expectedRef) return 'wrong-ref';
  if (!r.expectedRef) return 'unverified'; // answered + rows, but no golden to check routing
  return 'went-well';
}

const LABEL: Record<Verdict, string> = {
  'went-well': '✅ went well',
  'wrong-ref': '⚠️ wrong ref',
  'empty': '⬜ empty result',
  'not-answered': '❌ not answered',
  'unverified': '◽ answered (no golden ref)',
};

function pct(n: number, d: number): string { return d === 0 ? '—' : `${((100 * n) / d).toFixed(0)}%`; }
function trunc(s: string | null | undefined, n: number): string {
  if (!s) return '';
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

function main(): void {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('usage: answer-quality-report.ts <snapshot.json> [--out path.md] [--corpus bank.json]'); process.exit(1); }
  // Guard the --out lookup: indexOf returns -1 when absent, and -1 + 1 === 0
  // would resolve to args[0] — the input snapshot — silently overwriting it
  // with markdown. Only honour --out when the flag is actually present.
  const outFlag = args.indexOf('--out');
  const outArg = outFlag >= 0 ? args[outFlag + 1] : undefined;
  const snap = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
  const rows = snap.results;

  // Bucket each case.
  const tagged = rows.map((r) => ({ r, v: verdict(r) }));
  const byVerdict = (v: Verdict) => tagged.filter((t) => t.v === v).map((t) => t.r);
  const counts = (['went-well', 'wrong-ref', 'empty', 'not-answered', 'unverified'] as Verdict[])
    .map((v) => ({ v, n: byVerdict(v).length }));

  const golden = rows.filter((r) => r.expectedRef);
  const resolved = golden.filter((r) => r.resolvedRef === r.expectedRef).length;
  const answered = rows.filter((r) => r.status === 'ok').length;
  const nonEmpty = rows.filter((r) => r.nonEmpty).length;

  // Consolidated signals.
  // 1) Systematic misroutes: cluster wrong-ref by (expected → got).
  const misroute = new Map<string, { expected: string; got: string; qs: string[] }>();
  for (const r of byVerdict('wrong-ref')) {
    const key = `${r.expectedRef} → ${r.resolvedRef ?? '(none)'}`;
    const e = misroute.get(key) ?? { expected: r.expectedRef!, got: r.resolvedRef ?? '(none)', qs: [] };
    e.qs.push(r.question); misroute.set(key, e);
  }
  // 2) Empty-result cubes (data coverage gaps).
  const emptyCubes = new Map<string, number>();
  for (const r of byVerdict('empty')) {
    const c = r.resolvedCube ?? '(unresolved)';
    emptyCubes.set(c, (emptyCubes.get(c) ?? 0) + 1);
  }
  // 3) Latency + cost.
  const lat = rows.map((r) => r.latencyMs ?? 0).filter((n) => n > 0).sort((a, b) => b - a);
  const totalCost = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const p50 = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
  const slowest = [...rows].filter((r) => r.latencyMs).sort((a, b) => (b.latencyMs! - a.latencyMs!)).slice(0, 5);

  const L: string[] = [];
  const date = snap.capturedAt?.slice(0, 10) ?? '';
  L.push(`# Answer-quality report — ${snap.gameId} (${date})`, '');
  L.push(`Source: \`${file.split('/').pop()}\` · ${rows.length} cases · ws=${snap.workspace ?? '?'}`, '');

  // Scorecard
  L.push('## Scorecard', '');
  L.push('| dimension | value |', '|---|---|');
  L.push(`| answered (artifact emitted) | ${pct(answered, rows.length)} (${answered}/${rows.length}) |`);
  L.push(`| resolution (ref == golden) | ${pct(resolved, golden.length)} (${resolved}/${golden.length}) |`);
  L.push(`| non-empty (rows returned) | ${pct(nonEmpty, rows.length)} (${nonEmpty}/${rows.length}) |`);
  L.push(`| turn latency p50 / max | ${(p50 / 1000).toFixed(1)}s / ${((lat[0] ?? 0) / 1000).toFixed(1)}s |`);
  L.push(`| total LLM cost | $${totalCost.toFixed(2)} |`, '');
  L.push('### Outcome mix', '');
  L.push('| verdict | n | share |', '|---|---|---|');
  for (const c of counts) L.push(`| ${LABEL[c.v]} | ${c.n} | ${pct(c.n, rows.length)} |`);
  L.push('');

  // Consolidated improvement section (the "where to improve next").
  L.push('## Where to improve next', '');
  if (misroute.size) {
    L.push('### 1. Systematic misroutes (wrong measure) — highest value', '');
    L.push('| expected → got | # | example question |', '|---|---|---|');
    for (const e of [...misroute.values()].sort((a, b) => b.qs.length - a.qs.length)) {
      L.push(`| \`${e.expected}\` → \`${e.got}\` | ${e.qs.length} | ${trunc(e.qs[0], 50)} |`);
    }
    L.push('');
  }
  if (emptyCubes.size) {
    L.push('### 2. Empty results (routing OK, data missing)', '');
    L.push('| cube | empty cases | likely cause |', '|---|---|---|');
    for (const [c, n] of [...emptyCubes.entries()].sort((a, b) => b[1] - a[1])) {
      L.push(`| \`${c}\` | ${n} | date window with no landed data, or measure unpopulated |`);
    }
    L.push('');
  }
  const notAnswered = byVerdict('not-answered');
  if (notAnswered.length) {
    L.push('### 3. Not answered (errors / timeouts / refusals)', '');
    L.push('| question | status | detail |', '|---|---|---|');
    for (const r of notAnswered) L.push(`| ${trunc(r.question, 44)} | ${r.status} | ${trunc(r.errorDetail, 60) || '—'} |`);
    L.push('');
  }
  const unverified = byVerdict('unverified').length;
  if (unverified) {
    L.push('### 4. Coverage gap in the question bank', '');
    L.push(`${unverified} answered case(s) have **no golden \`expectedRef\`**, so routing correctness can't be auto-verified — these came from mined-asked traffic. Adding golden refs (or sampling for manual spot-check) closes the blind spot.`, '');
  }
  if (slowest.length) {
    L.push('### 5. Latency outliers (slow turns to optimise)', '');
    L.push('| question | latency | tools |', '|---|---|---|');
    for (const r of slowest) L.push(`| ${trunc(r.question, 40)} | ${((r.latencyMs ?? 0) / 1000).toFixed(1)}s | ${(r.toolCalls?.length ?? 0)} |`);
    L.push('');
  }

  // Per-case appendix — every case documented.
  L.push('## Per-case detail (all cases)', '');
  L.push('| # | verdict | question | got | want | rows | ans-snippet |', '|---|---|---|---|---|---|---|');
  tagged.forEach((t, i) => {
    const r = t.r;
    L.push(`| ${i + 1} | ${LABEL[t.v]} | ${trunc(r.question, 38)} | \`${r.resolvedRef ?? '—'}\` | ${r.expectedRef ? `\`${r.expectedRef}\`` : '—'} | ${r.nonEmpty ? '✓' : '·'} | ${trunc(r.answerText, 60)} |`);
  });
  L.push('');
  L.push('---', `_Generated by answer-quality-report.ts from ${file.split('/').pop()}._`);

  const __dir = dirname(fileURLToPath(import.meta.url));
  const out = outArg ?? join(__dir, `${snap.gameId}-aq-report.md`);
  // Never write the report over the snapshot we just read — that destroys the
  // (expensive, subscription-lane) run data with no recovery.
  if (resolve(out) === resolve(file)) {
    console.error(`[report] refusing to overwrite input snapshot "${file}". Pass a distinct --out path.`);
    process.exit(1);
  }
  writeFileSync(out, L.join('\n'), 'utf8');
  console.log(`[report] ${rows.length} cases → ${out}`);
  console.log(`  answered ${pct(answered, rows.length)} · resolution ${pct(resolved, golden.length)} (${resolved}/${golden.length}) · non-empty ${pct(nonEmpty, rows.length)}`);
  console.log(`  went-well ${byVerdict('went-well').length} · wrong-ref ${byVerdict('wrong-ref').length} · empty ${byVerdict('empty').length} · not-answered ${notAnswered.length} · unverified ${unverified}`);
}

main();
